import type { SupabaseClient, RealtimeChannel } from "@supabase/supabase-js";
export interface BroadcastSession {
  id: string;
  group_id: string;
  host_id: string;
  host_client: string;
  expires_at: string;
  ended_at: string | null;
}
interface Signal {
  id: number;
  session_id: string;
  sender_id: string;
  sender_client: string;
  receiver_client: string;
  payload: {
    type: "ready" | "offer" | "answer" | "candidate" | "leave";
    description?: RTCSessionDescriptionInit;
    candidate?: RTCIceCandidateInit;
  };
}
interface Peer {
  pc: RTCPeerConnection;
  userId: string;
  candidates: RTCIceCandidateInit[];
}
export class RoomBroadcast {
  readonly clientId = crypto.randomUUID();
  private session: BroadcastSession | null = null;
  private stream: MediaStream | null = null;
  private peers = new Map<string, Peer>();
  private channel: RealtimeChannel | null = null;
  private poll: ReturnType<typeof setInterval> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private chain = Promise.resolve();
  private seen = new Set<number>();
  private closed = false;
  constructor(
    private db: SupabaseClient,
    private groupId: string,
    private userId: string,
    private ice: RTCIceServer[],
    private onStream: (stream: MediaStream) => void,
    private onStatus: (text: string) => void,
    private onViewers: (n: number) => void,
  ) {}
  private async connect() {
    this.channel = this.db.channel(`signals:${this.clientId}`).on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "broadcast_signals",
        filter: `receiver_client=eq.${this.clientId}`,
      },
      ({ new: row }) => this.enqueue(row as Signal),
    );
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(Error("Signaling connection timed out")),
        12000,
      );
      this.channel!.subscribe((status) => {
        if (status === "SUBSCRIBED") {
          clearTimeout(timeout);
          resolve();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          clearTimeout(timeout);
          reject(Error("Signaling connection failed"));
        }
      });
    });
    this.poll = setInterval(() => void this.readInbox(), 10000);
    await this.readInbox();
  }
  private async readInbox() {
    if (this.closed) return;
    const { data, error } = await this.db
      .from("broadcast_signals")
      .select("*")
      .eq("receiver_client", this.clientId)
      .order("id")
      .limit(100);
    if (error) {
      this.onStatus("Signaling reconnecting…");
      return;
    }
    for (const row of data ?? []) this.enqueue(row as Signal);
  }
  private enqueue(signal: Signal) {
    if (this.seen.has(signal.id) || this.closed) return;
    this.seen.add(signal.id);
    this.chain = this.chain
      .then(async () => {
        if (!this.closed) await this.receive(signal);
        await this.db.from("broadcast_signals").delete().eq("id", signal.id);
      })
      .catch((e) =>
        this.onStatus(
          e instanceof Error ? e.message : "Connection negotiation failed",
        ),
      );
  }
  private async send(to: string, toClient: string, payload: Signal["payload"]) {
    if (!this.session || this.closed) return;
    const { error } = await this.db.rpc("broadcast_signal", {
      sid: this.session.id,
      client: this.clientId,
      recipient: to,
      recipient_client: toClient,
      message: payload,
    });
    if (error) throw Error(error.message);
  }
  private peer(userId: string, clientId: string) {
    const existing = this.peers.get(clientId);
    if (existing) return existing;
    const pc = new RTCPeerConnection({ iceServers: this.ice });
    const peer: Peer = { pc, userId, candidates: [] };
    this.peers.set(clientId, peer);
    pc.onicecandidate = (e) => {
      if (e.candidate)
        void this.send(userId, clientId, {
          type: "candidate",
          candidate: e.candidate.toJSON(),
        }).catch((e) => this.onStatus(e.message));
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      this.onStream(stream);
      this.onStatus("Receiving live scoreboard");
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") {
        this.onStatus(
          this.stream
            ? "Broadcasting live scoreboard"
            : "Receiving live scoreboard",
        );
        this.onViewers(
          [...this.peers.values()].filter(
            (p) => p.pc.connectionState === "connected",
          ).length,
        );
      } else if (pc.connectionState === "failed") {
        this.onStatus(
          "Connection failed. Check TURN relay configuration and rejoin.",
        );
        this.drop(clientId);
      } else if (pc.connectionState === "disconnected") {
        this.onStatus("Connection interrupted; waiting for network recovery…");
      }
    };
    return peer;
  }
  private drop(id: string) {
    const peer = this.peers.get(id);
    if (peer) {
      peer.pc.close();
      this.peers.delete(id);
      this.onViewers(
        [...this.peers.values()].filter(
          (p) => p.pc.connectionState === "connected",
        ).length,
      );
    }
  }
  private async receive(signal: Signal) {
    if (!this.session || signal.session_id !== this.session.id) return;
    const data = signal.payload;
    const host =
      this.session.host_id === this.userId &&
      this.session.host_client === this.clientId;
    if (data.type === "leave") {
      if (host) this.drop(signal.sender_client);
      return;
    }
    if (data.type === "ready") {
      if (!host || !this.stream) return;
      if (this.peers.size >= 9 && !this.peers.has(signal.sender_client)) {
        this.onStatus("Nine-viewer limit reached.");
        return;
      }
      this.drop(signal.sender_client);
      const p = this.peer(signal.sender_id, signal.sender_client);
      for (const t of this.stream.getTracks()) p.pc.addTrack(t, this.stream);
      const offer = await p.pc.createOffer();
      await p.pc.setLocalDescription(offer);
      await this.send(signal.sender_id, signal.sender_client, {
        type: "offer",
        description: p.pc.localDescription!.toJSON(),
      });
      return;
    }
    if (
      !host &&
      (signal.sender_id !== this.session.host_id ||
        signal.sender_client !== this.session.host_client)
    )
      return;
    const p = this.peer(signal.sender_id, signal.sender_client);
    if (data.type === "offer" && !host && data.description?.type === "offer") {
      await p.pc.setRemoteDescription(data.description);
      for (const c of p.candidates) await p.pc.addIceCandidate(c);
      p.candidates = [];
      await p.pc.setLocalDescription(await p.pc.createAnswer());
      await this.send(signal.sender_id, signal.sender_client, {
        type: "answer",
        description: p.pc.localDescription!.toJSON(),
      });
    } else if (
      data.type === "answer" &&
      host &&
      data.description?.type === "answer"
    ) {
      await p.pc.setRemoteDescription(data.description);
      for (const c of p.candidates) await p.pc.addIceCandidate(c);
      p.candidates = [];
    } else if (data.type === "candidate" && data.candidate) {
      if (p.pc.remoteDescription) await p.pc.addIceCandidate(data.candidate);
      else p.candidates.push(data.candidate);
    }
  }
  async host(stream: MediaStream) {
    this.stream = stream;
    const { data, error } = await this.db.rpc("broadcast_control", {
      action: "start",
      gid: this.groupId,
      client: this.clientId,
    });
    if (error) throw Error(error.message);
    this.session = data;
    await this.connect();
    this.heartbeat = setInterval(() => {
      void this.db
        .rpc("broadcast_control", {
          action: "heartbeat",
          gid: this.groupId,
          client: this.clientId,
          sid: this.session!.id,
        })
        .then(({ error }) => {
          if (error) {
            this.onStatus("Broadcast lease expired. Start sharing again.");
            void this.close();
          }
        });
    }, 20000);
    this.onStatus("Broadcasting — waiting for viewers");
    return this.session!;
  }
  async watch(session: BroadcastSession) {
    this.session = session;
    await this.connect();
    await this.send(session.host_id, session.host_client, { type: "ready" });
    this.onStatus("Connecting to broadcaster…");
  }
  async close() {
    if (this.closed) return;
    const s = this.session;
    try {
      if (s) {
        if (this.stream)
          await this.db.rpc("broadcast_control", {
            action: "stop",
            gid: this.groupId,
            client: this.clientId,
            sid: s.id,
          });
        else await this.send(s.host_id, s.host_client, { type: "leave" });
      }
    } catch {
      this.onStatus(
        "Disconnected. The server lease will clean up if the network is unavailable.",
      );
    } finally {
      this.closed = true;
      if (this.poll) clearInterval(this.poll);
      if (this.heartbeat) clearInterval(this.heartbeat);
      for (const p of this.peers.values()) p.pc.close();
      this.peers.clear();
      this.stream?.getTracks().forEach((t) => t.stop());
      if (this.channel) await this.db.removeChannel(this.channel);
      this.onViewers(0);
    }
  }
}
