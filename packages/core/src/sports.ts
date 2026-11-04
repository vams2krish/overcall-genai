import { z } from "zod";
import { XMLParser } from "fast-xml-parser";
import type { Sport } from "./index";
export function normalizeCricketRss(xml: string): {
  events: SportsEvent[];
  sourceUpdatedAt?: string;
} {
  if (xml.length > 1_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml))
    throw Error("Unexpected XML content");
  const raw = new XMLParser({
    ignoreAttributes: true,
    parseTagValue: false,
    trimValues: true,
    isArray: (name: string) => name === "item",
  }).parse(xml);
  const channel = z
    .object({
      title: z.string(),
      pubDate: z.string().optional(),
      item: z
        .array(
          z.object({
            title: z.string(),
            guid: z.string().optional(),
            link: z.string(),
          }),
        )
        .default([]),
    })
    .parse(raw.rss?.channel);
  const events = channel.item.flatMap((item) => {
    const id = (item.guid ?? item.link).match(/\/match\/(\d+)\.html/)?.[1];
    const parts = item.title.split(/\s+v\s+/);
    if (!id || parts.length !== 2) return [];
    const teams = parts.map((part) => {
      const match = part.trim().match(/^(.+?)\s+(\d[\d/\s&.*()-]*)$/);
      const name = match ? match[1] : part.replace(/\*/g, "").trim();
      return {
        name,
        abbreviation: name.slice(0, 3).toUpperCase(),
        score: match ? match[2].trim() : "—",
      };
    });
    return [
      {
        id: `cricinfo-rss:${id}`,
        sport: "Cricket" as const,
        name: teams.map((t) => t.name).join(" v "),
        league: "Cricket live-scores RSS",
        startsAt: "",
        state: "unknown" as const,
        detail:
          "Latest reported score. Match phase and player statistics are not supplied by this RSS feed.",
        teams,
        source: "ESPNcricinfo RSS",
        sourceUrl: `https://www.espncricinfo.com/ci/engine/match/${id}.html`,
      },
    ];
  });
  const parsedDate = channel.pubDate ? Date.parse(channel.pubDate) : NaN;
  return {
    events,
    sourceUpdatedAt: Number.isFinite(parsedDate)
      ? new Date(parsedDate).toISOString()
      : undefined,
  };
}
export const sportsEventSchema = z.object({
  id: z.string(),
  sport: z.enum(["Cricket", "NBA", "NFL", "Soccer", "MLB", "NHL"]),
  name: z.string(),
  league: z.string(),
  startsAt: z.string(),
  state: z.enum(["scheduled", "live", "finished", "unknown"]),
  detail: z.string(),
  teams: z.array(
    z.object({ name: z.string(), abbreviation: z.string(), score: z.string() }),
  ),
  source: z.string(),
  sourceUrl: z.string().url(),
});
export type SportsEvent = z.infer<typeof sportsEventSchema>;
export interface SportsFeed {
  events: SportsEvent[];
  source: string;
  fetchedAt: string;
  stale: boolean;
  error?: string;
  sourceUpdatedAt?: string;
}
const espnSchema = z.object({
  leagues: z.array(z.object({ name: z.string() })).optional(),
  events: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      date: z.string(),
      links: z.array(z.object({ href: z.string() })).optional(),
      status: z.object({
        type: z.object({ state: z.string(), detail: z.string().optional() }),
      }),
      competitions: z.array(
        z.object({
          competitors: z.array(
            z.object({
              team: z.object({
                displayName: z.string(),
                abbreviation: z.string().optional(),
              }),
              score: z.union([z.string(), z.number()]).optional(),
            }),
          ),
        }),
      ),
    }),
  ),
});
export const espnPaths: Partial<Record<Sport, string>> = {
  NBA: "basketball/nba",
  NFL: "football/nfl",
  MLB: "baseball/mlb",
  NHL: "hockey/nhl",
  Soccer: "soccer/eng.1",
};
export function normalizeEspn(raw: unknown, sport: Sport): SportsEvent[] {
  const body = espnSchema.parse(raw);
  return body.events.map((e) => ({
    id: `espn:${sport}:${e.id}`,
    sport,
    name: e.name,
    league: body.leagues?.[0]?.name ?? sport,
    startsAt: e.date,
    state:
      e.status.type.state === "in"
        ? "live"
        : e.status.type.state === "post"
          ? "finished"
          : "scheduled",
    detail: e.status.type.detail ?? "",
    teams:
      e.competitions[0]?.competitors.map((c) => ({
        name: c.team.displayName,
        abbreviation:
          c.team.abbreviation ?? c.team.displayName.slice(0, 3).toUpperCase(),
        score: c.score === undefined ? "—" : String(c.score),
      })) ?? [],
    source: "ESPN public scoreboard",
    sourceUrl:
      e.links?.find((l) => l.href.startsWith("https://www.espn.com/"))?.href ??
      "https://www.espn.com/",
  }));
}
const cricketSchema = z.object({
  status: z.literal("success"),
  data: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      dateTimeGMT: z.string().optional(),
      status: z.string(),
      matchType: z.string().optional(),
      matchStarted: z.boolean(),
      matchEnded: z.boolean(),
      teams: z.array(z.string()),
      score: z
        .array(
          z.object({
            r: z.number(),
            w: z.number(),
            o: z.number(),
            inning: z.string(),
          }),
        )
        .optional(),
    }),
  ),
});
export function normalizeCricket(raw: unknown): SportsEvent[] {
  return cricketSchema.parse(raw).data.map((e) => ({
    id: `cricketdata:${e.id}`,
    sport: "Cricket",
    name: e.name,
    league: e.matchType?.toUpperCase() ?? "Cricket",
    startsAt: e.dateTimeGMT
      ? e.dateTimeGMT.endsWith("Z")
        ? e.dateTimeGMT
        : `${e.dateTimeGMT}Z`
      : "",
    state: e.matchEnded ? "finished" : e.matchStarted ? "live" : "scheduled",
    detail: e.status,
    teams: e.teams.map((name) => {
      const score = e.score?.find((s) => s.inning.startsWith(name));
      return {
        name,
        abbreviation: name.slice(0, 3).toUpperCase(),
        score: score ? `${score.r}/${score.w} (${score.o})` : "—",
      };
    }),
    source: "CricketData.org",
    sourceUrl: "https://cricketdata.org/",
  }));
}
