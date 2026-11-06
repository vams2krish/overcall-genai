import assert from "node:assert/strict";
import { sports } from "../packages/core/src/index";
import { sportsEventSchema } from "../packages/core/src/sports";

// Read-only HTTP checks. No authentication emails, transactions, or user data.
async function main() {
  const base = process.argv[2] ?? "http://127.0.0.1:3000";
  const results = await Promise.all(
    sports.map(async (sport) => {
      const response = await fetch(`${base}/api/sports?sport=${sport}`, {
        signal: AbortSignal.timeout(45000),
      });
      assert.equal(response.status, 200, sport);
      const feed = await response.json();
      assert.equal(typeof feed.stale, "boolean");
      assert.ok(Number.isFinite(Date.parse(feed.fetchedAt)));
      assert.ok(Array.isArray(feed.events));
      for (const event of feed.events) {
        sportsEventSchema.parse(event);
        assert.equal(event.sport, sport);
        assert.equal(event.teams.length, 2);
        assert.ok(
          event.teams.every((team: { name: string }) => team.name.trim()),
        );
      }
      if (feed.stale) assert.equal(typeof feed.error, "string");
      return {
        sport,
        status: response.status,
        events: feed.events.length,
        stale: feed.stale,
        source: feed.source,
      };
    }),
  );
  for (const value of ["Tennis", "", "cricket"]) {
    assert.equal(
      (await fetch(`${base}/api/sports?sport=${value}`)).status,
      400,
    );
  }
  for (const headers of [{}, { Authorization: "Bearer invalid-test-token" }]) {
    assert.equal(
      (await fetch(`${base}/api/rtc/ice?group=invalid`, { headers })).status,
      401,
    );
  }
  const home = await fetch(base);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /overcall/i);
  if (process.env.NEXT_PUBLIC_SUPABASE_URL) {
    const response = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/vision`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      },
    );
    assert.equal(response.status, 401);
  }
  console.log(
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        base,
        sports: results,
        invalidSports: "passed",
        unauthorizedIce: "passed",
        homepage: "passed",
        visionAuth: process.env.NEXT_PUBLIC_SUPABASE_URL
          ? "passed"
          : "not configured",
      },
      null,
      2,
    ),
  );
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Smoke test failed");
  process.exitCode = 1;
});
