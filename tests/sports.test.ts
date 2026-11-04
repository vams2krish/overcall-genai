import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeEspn,
  normalizeCricket,
  normalizeCricketRss,
} from "../packages/core/src/sports";
test("cricket RSS preserves multi-innings scores and explicitly unknown match phase", () => {
  const { events, sourceUpdatedAt } = normalizeCricketRss(
    "<rss><channel><title>Cricinfo Live Scores</title><pubDate>Wed, 04 Nov 2026 07:12:01 +0000</pubDate><item><title>Assam 135/10 &amp; 41/4 * v Karnataka 577/6</title><link>http://www.cricinfo.com/ci/engine/match/1234567.html</link></item></channel></rss>",
  );
  assert.equal(events[0].teams[0].name, "Assam");
  assert.equal(events[0].teams[0].score, "135/10 & 41/4 *");
  assert.equal(events[0].state, "unknown");
  assert.equal(sourceUpdatedAt, "2026-11-04T07:12:01.000Z");
});
test("RSS rejects DTD/entity expansion payloads", () =>
  assert.throws(() =>
    normalizeCricketRss('<!DOCTYPE rss [<!ENTITY x "unsafe">]><rss/>'),
  ));
test("ESPN feed maps live status, explicit scores, source and teams", () => {
  const events = normalizeEspn(
    {
      leagues: [{ name: "NBA" }],
      events: [
        {
          id: "1",
          name: "Away at Home",
          date: "2026-11-04T00:00:00Z",
          status: { type: { state: "in", detail: "Q3 2:12" } },
          competitions: [
            {
              competitors: [
                {
                  team: { displayName: "Home", abbreviation: "HOM" },
                  score: "80",
                },
                {
                  team: { displayName: "Away", abbreviation: "AWY" },
                  score: "77",
                },
              ],
            },
          ],
        },
      ],
    },
    "NBA",
  );
  assert.equal(events[0].state, "live");
  assert.equal(events[0].teams[0].score, "80");
  assert.equal(events[0].source, "ESPN public scoreboard");
});
test("cricket innings are matched to the correct team, not response order", () => {
  const [e] = normalizeCricket({
    status: "success",
    data: [
      {
        id: "x",
        name: "India v Australia",
        matchType: "t20",
        matchStarted: true,
        matchEnded: false,
        status: "India batting",
        teams: ["Australia", "India"],
        score: [{ r: 142, w: 3, o: 14.2, inning: "India Inning 1" }],
      },
    ],
  });
  assert.equal(e.teams[0].score, "—");
  assert.equal(e.teams[1].score, "142/3 (14.2)");
  assert.equal(e.state, "live");
});
test("provider failure and malformed payloads cannot become invented match data", () => {
  assert.throws(() => normalizeCricket({ status: "failure", data: [] }));
  assert.throws(() =>
    normalizeEspn({ events: [{ id: "wrong-shape" }] }, "NFL"),
  );
});
