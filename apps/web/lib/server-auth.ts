import "server-only";
import { createClient } from "@supabase/supabase-js";
export async function authenticatedClient(request: Request) {
  const bearer = request.headers.get("authorization");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL,
    key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || !bearer?.startsWith("Bearer ")) return null;
  const client = createClient(url, key, {
    global: { headers: { Authorization: bearer } },
    auth: { persistSession: false },
  });
  const { data, error } = await client.auth.getUser(bearer.slice(7));
  if (error || !data.user) return null;
  return { client, user: data.user };
}
