"use client";
import { useEffect, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RoomBroadcast, type BroadcastSession } from "@/lib/broadcast";
import { Button } from "@/components/ui/button";
/** Development fixture: real video and production peer code; database policies
 * are verified separately with the real migration and live SQL smoke test. */
function makeTransport() {
  let seq = 0;
  let session: BroadcastSession | null = null;
  let inbox: Record<string, unknown>[] = [];
  const listeners = new Map<string, (e: unknown) => void>();
  const db = (user: string) => ({
    channel() {
      let receiver = "";
      return {
        on(
          _kind: string,
          filter: { filter: string },
          callback: (e: unknown) => void,
        ) {
          receiver = filter.filter.split("eq.")[1];
          listeners.set(receiver, callback);
          return this;
        },
        subscribe(callback: (s: string) => void) {
          queueMicrotask(() => callback("SUBSCRIBED"));
          return this;
        },
        unsubscribe() {
          listeners.delete(receiver);
        },
      };
    },
    async removeChannel(channel: { unsubscribe: () => void }) {
      channel.unsubscribe();
    },
    from() {
      return {
        select() {
          let receiver = "";
          const query = {
            eq(_k: string, v: string) {
              receiver = v;
              return query;
            },
            order() {
              return query;
            },
            async limit() {
              return {
                data: inbox.filter((x) => x.receiver_client === receiver),
                error: null,
              };
            },
          };
          return query;
        },
        delete() {
          return {
            async eq(_k: string, id: number) {
              inbox = inbox.filter((x) => x.id !== id);
              return { error: null };
            },
          };
        },
      };
    },
    async rpc(name: string, p: Record<string, unknown>) {
      if (name === "broadcast_control") {
        if (p.action === "start")
          session = {
            id: crypto.randomUUID(),
            group_id: String(p.gid),
            host_id: user,
            host_client: String(p.client),
            expires_at: new Date(Date.now() + 90000).toISOString(),
            ended_at: null,
          };
        return { data: session, error: null };
      }
      if (name === "broadcast_signal") {
        const row = {
          id: ++seq,
          session_id: p.sid,
          sender_id: user,
          sender_client: p.client,
          receiver_client: p.recipient_client,
          payload: p.message,
        };
        inbox.push(row);
        queueMicrotask(() =>
          listeners.get(String(p.recipient_client))?.({ new: row }),
        );
        return { error: null };
      }
      return { error: null };
    },
  });
  return {
    host: db("host") as unknown as SupabaseClient,
    viewer: db("viewer") as unknown as SupabaseClient,
  };
}
export function WebRTCProbe() {
  const [status, setStatus] = useState("Ready");
  const [frames, setFrames] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const cleanup = useRef<() => void>(() => {});
  useEffect(() => () => cleanup.current(), []);
  async function run() {
    cleanup.current();
    setFrames(0);
    setStatus("Starting real WebRTC peers with synthetic scoreboard…");
    const transport = makeTransport();
    const ctx = canvas.current!.getContext("2d")!;
    let tick = 0;
    const draw = () => {
      ctx.fillStyle = "#211925";
      ctx.fillRect(0, 0, 640, 360);
      ctx.fillStyle = "#f18951";
      ctx.font = "bold 38px Arial";
      ctx.fillText("OVERCALL · VIDEO TEST", 30, 80);
      ctx.fillStyle = "#f1efea";
      ctx.font = "60px Arial";
      ctx.fillText(`IND ${142 + tick++}/3`, 30, 180);
      ctx.font = "22px Arial";
      ctx.fillText("Synthetic scoreboard — no screen capture", 30, 250);
    };
    draw();
    const paint = setInterval(draw, 200);
    const stream = canvas.current!.captureStream(5);
    const host = new RoomBroadcast(
      transport.host,
      "fixture",
      "host",
      [],
      () => {},
      () => {},
      () => {},
    );
    const viewer = new RoomBroadcast(
      transport.viewer,
      "fixture",
      "viewer",
      [],
      (remote) => {
        video.current!.srcObject = remote;
        void video.current!.play();
        const count = () => {
          if (!video.current || video.current.srcObject !== remote) return;
          setFrames((n) => n + 1);
          setStatus(
            "PASS — video frames received through production WebRTC peer code",
          );
          video.current.requestVideoFrameCallback(count);
        };
        video.current!.requestVideoFrameCallback(count);
      },
      setStatus,
      () => {},
    );
    cleanup.current = () => {
      clearInterval(paint);
      if (video.current) video.current.srcObject = null;
      void viewer.close();
      void host.close();
    };
    try {
      const session = await host.host(stream);
      await viewer.watch(session);
    } catch (e) {
      cleanup.current();
      setStatus(e instanceof Error ? e.message : "Failed");
    }
  }
  return (
    <main style={{ padding: 35, maxWidth: 900, margin: "auto" }}>
      <h1>WebRTC delivery verification</h1>
      <p className="muted">
        Development-only fixture: production RoomBroadcast code, real peer
        connections and video tracks, in-memory signaling. Database
        authorization is tested separately.
      </p>
      <Button onClick={() => void run()}>Run video delivery test</Button>
      <Button
        variant="outline"
        onClick={() => {
          cleanup.current();
          setStatus("Stopped");
        }}
      >
        Stop test
      </Button>
      <p role="status" style={{ margin: "20px 0" }}>
        {status}
      </p>
      <p>
        Received frames: <strong data-testid="received-frames">{frames}</strong>
      </p>
      <canvas
        ref={canvas}
        width={640}
        height={360}
        style={{ width: "45%", marginRight: "5%" }}
      />
      <video ref={video} autoPlay muted playsInline style={{ width: "45%" }} />
    </main>
  );
}
