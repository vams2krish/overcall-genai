import "server-only";
import {
  normalizeCricket,
  normalizeCricketRss,
  normalizeEspn,
  espnPaths,
  type SportsFeed,
} from "@overcall/core/sports";
import type { Sport } from "@overcall/core";
const cache = new Map<Sport, { feed: SportsFeed; expires: number }>();
const pending = new Map<Sport, Promise<SportsFeed>>();
export async function getSportsFeed(sport: Sport): Promise<SportsFeed> {
  const cached = cache.get(sport);
  if (cached && cached.expires > Date.now()) return cached.feed;
  const inflight = pending.get(sport);
  if (inflight) return inflight;
  const task = (async () => {
    const useRss = sport === "Cricket" && !process.env.CRICKETDATA_API_KEY;
    const source =
      sport === "Cricket"
        ? useRss
          ? "ESPNcricinfo RSS"
          : "CricketData.org"
        : "ESPN public scoreboard";
    try {
      const url = useRss
        ? "https://static.espncricinfo.com/rss/livescores.xml"
        : sport === "Cricket"
          ? `https://api.cricapi.com/v1/currentMatches?apikey=${encodeURIComponent(process.env.CRICKETDATA_API_KEY!)}&offset=0`
          : `https://site.api.espn.com/apis/site/v2/sports/${espnPaths[sport]}/scoreboard`;
      const response = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw Error("Provider unavailable");
      let sourceUpdatedAt: string | undefined;
      const events = useRss
        ? await (async () => {
            const parsed = normalizeCricketRss(await response.text());
            sourceUpdatedAt = parsed.sourceUpdatedAt;
            return parsed.events;
          })()
        : sport === "Cricket"
          ? normalizeCricket(await response.json())
          : normalizeEspn(await response.json(), sport);
      const stale =
        !!sourceUpdatedAt && Date.now() - Date.parse(sourceUpdatedAt) > 600000;
      const feed: SportsFeed = {
        events,
        source,
        fetchedAt: new Date().toISOString(),
        sourceUpdatedAt,
        stale,
        ...(stale
          ? { error: "The provider feed is more than 10 minutes old." }
          : {}),
      };
      cache.set(sport, {
        feed,
        expires: Date.now() + (sport === "Cricket" ? 120000 : 30000),
      });
      return feed;
    } catch {
      if (cached) {
        const feed = {
          ...cached.feed,
          stale: true,
          error: "Provider unavailable. Showing the last successful update.",
        };
        cache.set(sport, { feed, expires: Date.now() + 30000 });
        return feed;
      }
      const feed: SportsFeed = {
        events: [],
        source,
        fetchedAt: new Date().toISOString(),
        stale: true,
        error:
          "Scores are temporarily unavailable. No sample scores are being substituted.",
      };
      cache.set(sport, { feed, expires: Date.now() + 30000 });
      return feed;
    }
  })().finally(() => pending.delete(sport));
  pending.set(sport, task);
  return task;
}
