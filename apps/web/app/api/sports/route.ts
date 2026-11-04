import { sports } from "@overcall/core";
import { getSportsFeed } from "@/lib/sports-feed";
export async function GET(req: Request) {
  const sport = new URL(req.url).searchParams.get("sport");
  if (!sports.includes(sport as (typeof sports)[number]))
    return Response.json({ error: "Unsupported sport" }, { status: 400 });
  return Response.json(await getSportsFeed(sport as (typeof sports)[number]), {
    headers: { "Cache-Control": "no-store" },
  });
}
