"use client";
import { useEffect, useRef, useState } from "react";
import { MonitorUp, Radio, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/lib/supabase";
import { RoomBroadcast, type BroadcastSession } from "@/lib/broadcast";
export function BroadcastPanel({
  groupId,
  userId,
  onStream,
}: {
  groupId: string;
  userId: string | null;
  onStream: (s: MediaStream | null) => void;
}) {
  const [session, setSession] = useState<BroadcastSession | null>(null);
  const [status, setStatus] = useState(
    "Share just the scoreboard with your room.",
  );
  const [mode, setMode] = useState<"idle" | "host" | "viewer">("idle");
  const [viewers, setViewers] = useState(0);
  const [relay, setRelay] = useState(false);
  const [busy, setBusy] = useState(false);
  const controller = useRef<RoomBroadcast | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const incoming = useRef<MediaStream | null>(null);
  const streamCallback = useRef(onStream);
  streamCallback.current = onStream;
  useEffect(() => {
    if (!supabase || !userId) return;
    let active = true;
    const load = async () => {
      const { data, error } = await supabase!
        .from("broadcast_sessions")
        .select("*")
        .eq("group_id", groupId)
        .is("ended_at", null)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      if (active) {
        if (error) setStatus("Broadcast setup is not deployed yet.");
        else setSession(data);
      }
    };
    void load();
    const channel = supabase
      .channel(`broadcasts:${groupId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "broadcast_sessions",
          filter: `group_id=eq.${groupId}`,
        },
        () => void load(),
      )
      .subscribe();
    const interval = setInterval(() => void load(), 10000);
    return () => {
      active = false;
      clearInterval(interval);
      void supabase!.removeChannel(channel);
      void controller.current?.close();
      controller.current = null;
      incoming.current = null;
      streamCallback.current(null);
    };
  }, [groupId, userId]);
  const attach = (s: MediaStream) => {
    incoming.current = s;
    streamCallback.current(s);
    if (video.current) {
      video.current.srcObject = s;
      void video.current
        .play()
        .catch(() => setStatus("Press play to view the shared scoreboard."));
    }
  };
  useEffect(() => {
    if (!session && mode !== "idle") {
      void controller.current?.close();
      controller.current = null;
      incoming.current = null;
      onStream(null);
      setMode("idle");
      setStatus("The broadcaster has ended the stream.");
      if (video.current) video.current.srcObject = null;
    }
  }, [session, mode, onStream]);
  async function makeController() {
    const { data } = await supabase!.auth.getSession();
    const response = await fetch(
      `/api/rtc/ice?group=${encodeURIComponent(groupId)}`,
      { headers: { Authorization: `Bearer ${data.session?.access_token}` } },
    );
    const body = await response.json();
    if (!response.ok) throw Error(body.error ?? "Unable to configure WebRTC");
    setRelay(body.relayConfigured);
    return new RoomBroadcast(
      supabase!,
      groupId,
      userId!,
      body.iceServers,
      attach,
      setStatus,
      setViewers,
    );
  }
  async function stop() {
    setBusy(true);
    try {
      await controller.current?.close();
    } finally {
      controller.current = null;
      incoming.current = null;
      onStream(null);
      if (video.current) video.current.srcObject = null;
      setMode("idle");
      setSession(null);
      setStatus("Scoreboard sharing stopped.");
      setBusy(false);
    }
  }
  async function share() {
    if (!userId || !supabase) {
      setStatus("Sign in to share a scoreboard with your private room.");
      return;
    }
    setBusy(true);
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 5, width: { ideal: 1280 } },
        audio: false,
      });
      const rtc = await makeController();
      controller.current = rtc;
      const started = await rtc.host(stream);
      setSession(started);
      setMode("host");
      attach(stream);
      stream.getVideoTracks()[0].onended = () => void stop();
    } catch (e) {
      stream?.getTracks().forEach((t) => t.stop());
      await controller.current?.close();
      controller.current = null;
      setStatus(e instanceof Error ? e.message : "Screen sharing unavailable");
    } finally {
      setBusy(false);
    }
  }
  async function watch() {
    if (!session || !userId || !supabase) return;
    setBusy(true);
    try {
      const rtc = await makeController();
      controller.current = rtc;
      setMode("viewer");
      await rtc.watch(session);
    } catch (e) {
      await controller.current?.close();
      controller.current = null;
      setMode("idle");
      setStatus(e instanceof Error ? e.message : "Unable to join broadcast");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel broadcast-panel">
      <div className="panel-heading">
        <h3>
          <MonitorUp size={16} />
          Room scoreboard
        </h3>
        <span>
          {mode === "host"
            ? `${viewers} VIEWERS`
            : session
              ? "BROADCAST AVAILABLE"
              : "WEBRTC"}
        </span>
      </div>
      <p className="muted" role="status">
        {status}
      </p>
      <video
        ref={video}
        autoPlay
        playsInline
        muted
        controls
        className={mode === "idle" ? "hidden" : "broadcast-video"}
      />
      <div className="call-buttons">
        {mode === "idle" ? (
          session ? (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void watch()}
            >
              <Radio size={14} />
              Watch scoreboard
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => void share()}
            >
              <MonitorUp size={14} />
              Share scoreboard
            </Button>
          )
        ) : (
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void stop()}
          >
            {mode === "host" ? "Stop broadcast" : "Leave broadcast"}
          </Button>
        )}
      </div>
      {mode !== "idle" && !relay && (
        <p className="relay-note">
          Direct connection mode. Sharing may be unavailable on networks that
          block direct connections.
        </p>
      )}
      <p className="relay-note">
        <Users size={11} />
        Only this group can request the stream. Audio is off. Closing the room
        stops your stream.
      </p>
    </section>
  );
}
