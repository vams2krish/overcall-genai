"use client";
import { useEffect, useState } from "react";
import { Radio, RefreshCw, ExternalLink } from "lucide-react";
import type { Sport } from "@overcall/core";
import type { SportsFeed } from "@overcall/core/sports";
export function SportsScoreboard({ sport }: { sport: Sport }) {
  const [feed, setFeed] = useState<SportsFeed | null>(null);
  const [eventId, setEventId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setFeed(null);
    setEventId("");
    const load = async () => {
      setLoading(true);
      try {
        const r = await fetch(
          `/api/sports?sport=${encodeURIComponent(sport)}`,
          { signal: controller.signal },
        );
        if (!r.ok) throw Error("Unable to load scores");
        const data = (await r.json()) as SportsFeed;
        if (active) {
          setFeed(data);
          setError("");
        }
      } catch (e) {
        if (active && !(e instanceof Error && e.name === "AbortError"))
          setError("Scores are unavailable. Retrying automatically.");
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(
      () => void load(),
      sport === "Cricket" ? 120000 : 30000,
    );
    return () => {
      active = false;
      controller.abort();
      clearInterval(timer);
    };
  }, [sport]);
  const event =
    feed?.events.find((e) => e.id === eventId) ??
    feed?.events.find((e) => e.state === "live") ??
    feed?.events[0];
  return (
    <div className="match-banner actual-scoreboard">
      <div className="match-top">
        <span className="live-label">
          <Radio size={12} />
          {event?.state === "live"
            ? "LIVE MATCH"
            : event?.state === "finished"
              ? "FINAL SCORE"
              : "SPORTS FEED"}
        </span>
        <span>{event?.league ?? sport}</span>
        <span className="match-format">
          {loading || !feed ? (
            <RefreshCw size={10} />
          ) : feed?.stale ? (
            "Unavailable / stale"
          ) : (
            "Provider data"
          )}
        </span>
      </div>
      {feed?.events.length ? (
        <label className="match-picker">
          <span className="sr-only">Choose match</span>
          <select
            aria-label="Choose match"
            value={event?.id ?? ""}
            onChange={(e) => setEventId(e.target.value)}
          >
            {feed.events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {event ? (
        <>
          <div className="match-score">
            {event.teams.slice(0, 2).map((t, i) => (
              <div className={`feed-team ${i ? "away" : ""}`} key={t.name}>
                <span className={`team-badge ${i ? "australia" : "india"}`}>
                  {t.abbreviation}
                </span>
                <div>
                  <strong>{t.name}</strong>
                  <span className="actual-score">{t.score}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="match-status">
            {event.detail}
            {event.state === "scheduled" && event.startsAt
              ? ` · ${new Date(event.startsAt).toLocaleString()}`
              : ""}
          </p>
        </>
      ) : (
        <div className="feed-empty">
          <strong>
            {loading
              ? "Loading match scores…"
              : sport === "Cricket"
                ? "Connect your cricket feed"
                : "No matches returned"}
          </strong>
          <p>{error || feed?.error || "Checking the provider’s scoreboard."}</p>
        </div>
      )}
      <div className="match-bottom">
        <span>
          {feed?.source ?? "Connecting to provider"}{" "}
          {feed?.fetchedAt &&
            `· updated ${new Date(feed.sourceUpdatedAt ?? feed.fetchedAt).toLocaleTimeString()}`}
        </span>
        {event && (
          <a href={event.sourceUrl} target="_blank" rel="noreferrer">
            Source <ExternalLink size={10} />
          </a>
        )}
      </div>
      {(error || feed?.error) && event && (
        <p className="feed-warning" role="status">
          {error || feed?.error}
        </p>
      )}
    </div>
  );
}
