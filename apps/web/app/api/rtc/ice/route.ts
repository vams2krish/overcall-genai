import { createHmac } from "node:crypto";
import { authenticatedClient } from "@/lib/server-auth";
export async function GET(req: Request) {
  const auth = await authenticatedClient(req);
  if (!auth)
    return Response.json({ error: "Authentication required" }, { status: 401 });
  const gid = new URL(req.url).searchParams.get("group");
  if (!gid) return Response.json({ error: "Group required" }, { status: 400 });
  const { data } = await auth.client
    .from("group_members")
    .select("user_id")
    .eq("group_id", gid)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (!data)
    return Response.json(
      { error: "Group membership required" },
      { status: 403 },
    );
  const iceServers: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];
  const secret = process.env.TURN_SHARED_SECRET;
  const urls = process.env.TURN_URLS?.split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  if (secret && urls?.length) {
    const username = `${Math.floor(Date.now() / 1000) + 3600}:${auth.user.id}`;
    iceServers.push({
      urls,
      username,
      credential: createHmac("sha1", secret).update(username).digest("base64"),
    });
  }
  return Response.json(
    {
      iceServers,
      relayConfigured: !!secret && !!urls?.length,
      expiresIn: 3600,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
