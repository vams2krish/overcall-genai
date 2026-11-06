import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { sports } from "../packages/core/src/index";
const a = "00000000-0000-0000-0000-000000000001",
  b = "00000000-0000-0000-0000-000000000002",
  c = "00000000-0000-0000-0000-000000000003",
  outsider = "00000000-0000-0000-0000-000000000004";
test("migration, RLS, atomic token accounting and human confirmation", async (t) => {
  const db = new PGlite();
  await db.exec(
    `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create publication supabase_realtime;`,
  );
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261104034131_overcall_core.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.query(
    `insert into auth.users(id,email) values($1,'a@example.com'),($2,'b@example.com'),($3,'c@example.com'),($4,'d@example.com')`,
    [a, b, c, outsider],
  );
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261104065130_live_broadcasting.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  await db.exec(
    readFileSync(
      new URL(
        "../supabase/migrations/20261104070301_production_hardening.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const as = async (id: string) => {
    await db.exec("reset role");
    await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [id]);
    await db.exec("set role authenticated");
  };
  const cmd = async (action: string, payload: unknown) => {
    const r = await db.query<{ result: any }>(
      `select public.prop_command($1,$2::jsonb) as result`,
      [action, JSON.stringify(payload)],
    );
    return r.rows[0].result;
  };
  await as(a);
  const group = await cmd("create_group", { name: "The Pavilion" });
  const gid = group.id;
  for (const id of [b, c])
    await db.query(`select public.manage_group($1,'invite',$2::jsonb)`, [
      gid,
      JSON.stringify({ user_id: id }),
    ]);
  const create = async () =>
    cmd("create", {
      group_id: gid,
      title: "Two sixes in the next completed over?",
      sport: "Cricket",
      stake: 20,
      side: "yes",
      entry_type: "fixed",
      entry_amount: 20,
      minutes: 5,
      lock_type: "timer",
    });
  let pid: string;
  await t.test(
    "members only, immutable ledger and no direct balance writes",
    async () => {
      await as(outsider);
      assert.equal(
        (await db.query("select * from public.groups")).rows.length,
        0,
      );
      await assert.rejects(cmd("create", { group_id: gid }), /membership/);
      await assert.rejects(
        db.exec(
          `update public.profiles set balance=999999 where id='${outsider}'`,
        ),
        /permission denied/,
      );
      await as(a);
      pid = (await create()).id;
      assert.equal(
        (
          await db.query<{ balance: number }>(
            "select balance from profiles where id=$1",
            [a],
          )
        ).rows[0].balance,
        980,
      );
    },
  );
  await t.test(
    "fixed entry, duplicate entry and overspend rollback",
    async () => {
      await as(b);
      await assert.rejects(
        cmd("join", { prop_id: pid, side: "no", stake: 19 }),
        /entry rule/,
      );
      await cmd("join", { prop_id: pid, side: "no", stake: 20 });
      await assert.rejects(
        cmd("join", { prop_id: pid, side: "yes", stake: 20 }),
        /unique constraint/,
      );
      await as(c);
      await assert.rejects(
        cmd("create", {
          group_id: gid,
          title: "Will this stake exceed my entire balance?",
          sport: "Cricket",
          side: "yes",
          stake: 5000,
          entry_type: "free",
          entry_amount: 20,
          minutes: 5,
        }),
        /Insufficient/,
      );
      assert.equal(
        (await db.query("select * from custom_props")).rows.length,
        1,
      );
    },
  );
  await t.test("locking is final and settlement needs quorum", async () => {
    await as(a);
    await cmd("lock", { prop_id: pid });
    await as(c);
    await assert.rejects(
      cmd("join", { prop_id: pid, side: "yes", stake: 20 }),
      /closed/,
    );
    await as(a);
    await cmd("await", { prop_id: pid });
    await cmd("propose", {
      prop_id: pid,
      side: "yes",
      evidence: "Two sixes verified in the event window.",
    });
    await assert.rejects(cmd("settle", { prop_id: pid }), /Human confirmation/);
    await as(c);
    await assert.rejects(
      cmd("vote", { prop_id: pid, approve: true }),
      /eligible/,
    );
    await as(a);
    await cmd("vote", { prop_id: pid, approve: true });
    await assert.rejects(cmd("settle", { prop_id: pid }), /Human confirmation/);
    await as(b);
    await cmd("vote", { prop_id: pid, approve: true });
    await cmd("settle", { prop_id: pid });
    await assert.rejects(cmd("settle", { prop_id: pid }), /Human confirmation/);
  });
  await t.test(
    "payouts conserve tokens and duplicate calls cannot mint",
    async () => {
      await db.exec("reset role");
      const r = await db.query<{ total: number }>(
        `select sum(balance)::int as total from profiles`,
      );
      assert.equal(r.rows[0].total, 4000);
      const ledger = await db.query<{ net: number }>(
        `select sum(amount)::int as net from token_transactions where prop_id=$1`,
        [pid],
      );
      assert.equal(ledger.rows[0].net, 0);
      await as(a);
      assert.equal(
        (
          await db.query<{ balance: number }>(
            "select balance from profiles where id=$1",
            [a],
          )
        ).rows[0].balance,
        1020,
      );
    },
  );
  await t.test("void gives exact full refunds and checks admin", async () => {
    await as(a);
    const p = await create();
    await as(b);
    await cmd("join", { prop_id: p.id, side: "no", stake: 20 });
    await assert.rejects(
      cmd("void", { prop_id: p.id, reason: "Abandoned event" }),
      /admin/,
    );
    await as(a);
    await cmd("void", { prop_id: p.id, reason: "Abandoned event" });
    await assert.rejects(
      cmd("void", { prop_id: p.id, reason: "Abandoned event" }),
      /Already final/,
    );
    await db.exec("reset role");
    assert.equal(
      (
        await db.query<{ net: number }>(
          "select sum(amount)::int as net from token_transactions where prop_id=$1",
          [p.id],
        )
      ).rows[0].net,
      0,
    );
  });
  await t.test(
    "AI record endpoint is unavailable to participants",
    async () => {
      await as(a);
      await assert.rejects(
        db.query(`select record_vision($1,$2,'upload','{}')`, [pid, a]),
        /permission denied/,
      );
    },
  );
  await t.test(
    "expired timers reject joins and daily rewards are idempotent",
    async () => {
      await as(a);
      const p = await create();
      await db.exec("reset role");
      await db.query(
        `update custom_props set lock_at=now()-interval '1 minute' where id=$1`,
        [p.id],
      );
      await as(b);
      await assert.rejects(
        cmd("join", { prop_id: p.id, side: "no", stake: 20 }),
        /closed/,
      );
      await cmd("daily", {});
      await assert.rejects(cmd("daily", {}), /already claimed/);
    },
  );
  await t.test(
    "vision is throttled, audited, and never self-confirms",
    async () => {
      await as(a);
      const p = await create();
      await cmd("lock", { prop_id: p.id });
      await cmd("await", { prop_id: p.id });
      await cmd("vision_start", { prop_id: p.id });
      assert.equal(
        (
          await db.query<{ claim: boolean }>(
            "select claim_vision($1) as claim",
            [p.id],
          )
        ).rows[0].claim,
        true,
      );
      assert.equal(
        (
          await db.query<{ claim: boolean }>(
            "select claim_vision($1) as claim",
            [p.id],
          )
        ).rows[0].claim,
        false,
      );
      await assert.rejects(
        db.query("select begin_vision_attempt($1,$2,'upload')", [p.id, a]),
        /permission denied/,
      );
      await db.exec("reset role");
      const start = await db.query<{ id: string }>(
        "select begin_vision_attempt($1,$2,'upload') as id",
        [p.id, a],
      );
      await db.query("select fail_vision_attempt($1)", [start.rows[0].id]);
      assert.equal(
        (
          await db.query<{ status: string }>(
            "select raw_output->>'status' as status from prop_vision_logs where id=$1",
            [start.rows[0].id],
          )
        ).rows[0].status,
        "failed",
      );
      const extraction = {
        player: "Kohli",
        over: "16",
        sixes: 2,
        wickets: 0,
        runs: 18,
        confidence: 0.99,
        suggested_side: "yes",
        explanation: "Two sixes observed over the complete specified over.",
        sufficient_evidence: true,
      };
      await db.query("select record_vision($1,$2,'upload',$3::jsonb)", [
        p.id,
        a,
        JSON.stringify(extraction),
      ]);
      assert.equal(
        (
          await db.query<{ status: string }>(
            "select status from custom_props where id=$1",
            [p.id],
          )
        ).rows[0].status,
        "proposed",
      );
      await as(a);
      await assert.rejects(
        cmd("settle", { prop_id: p.id }),
        /Human confirmation/,
      );
    },
  );
  await t.test(
    "broadcasts enforce membership, one host, sender identity and private inboxes",
    async () => {
      const hostClient = "10000000-0000-0000-0000-000000000001",
        viewerClient = "10000000-0000-0000-0000-000000000002";
      await as(outsider);
      await assert.rejects(
        db.query("select broadcast_control('start',$1,$2)", [gid, hostClient]),
        /membership/,
      );
      await as(a);
      const session = (
        await db.query<{ s: { id: string } }>(
          "select broadcast_control('start',$1,$2) as s",
          [gid, hostClient],
        )
      ).rows[0].s;
      await as(b);
      await assert.rejects(
        db.query("select broadcast_control('start',$1,$2)", [
          gid,
          viewerClient,
        ]),
        /already broadcasting/,
      );
      await db.query("select broadcast_signal($1,$2,$3,$4,$5::jsonb)", [
        session.id,
        viewerClient,
        a,
        hostClient,
        JSON.stringify({ type: "ready" }),
      ]);
      await assert.rejects(
        db.query("select broadcast_signal($1,$2,$3,$4,$5::jsonb)", [
          session.id,
          viewerClient,
          c,
          hostClient,
          JSON.stringify({ type: "offer" }),
        ]),
        /only the broadcaster/,
      );
      assert.equal(
        (await db.query("select * from broadcast_signals")).rows.length,
        0,
      );
      await as(a);
      assert.equal(
        (await db.query("select * from broadcast_signals")).rows.length,
        1,
      );
      await as(c);
      assert.equal(
        (await db.query("select * from broadcast_signals")).rows.length,
        0,
      );
      await assert.rejects(
        db.query("select broadcast_control('stop',$1,$2,$3)", [
          gid,
          viewerClient,
          session.id,
        ]),
        /current broadcaster/,
      );
      await as(a);
      await db.query("select broadcast_control('stop',$1,$2,$3)", [
        gid,
        hostClient,
        session.id,
      ]);
      await as(b);
      await assert.rejects(
        db.query("select broadcast_signal($1,$2,$3,$4,$5::jsonb)", [
          session.id,
          viewerClient,
          a,
          hostClient,
          JSON.stringify({ type: "ready" }),
        ]),
        /Inactive/,
      );
    },
  );
  for (const sport of sports) {
    for (const entryType of ["fixed", "match", "free"] as const) {
      await t.test(
        `${sport}: ${entryType} entry through confirmed settlement and exact refunds`,
        async () => {
          await as(a);
          const balanceBefore = (
            await db.query<{ balance: number }>(
              "select balance from profiles where id=$1",
              [a],
            )
          ).rows[0].balance;
          const payload = {
            group_id: gid,
            title: `${sport}: home team wins the completed match?`,
            sport,
            side: "yes",
            stake: 7,
            entry_type: entryType,
            entry_amount: 7,
            minutes: 5,
            lock_type: "manual",
          };
          const p = await cmd("create", payload);
          assert.equal(p.sport, sport);
          await as(b);
          if (entryType !== "free")
            await assert.rejects(
              cmd("join", { prop_id: p.id, side: "no", stake: 8 }),
              /entry rule/,
            );
          await cmd("join", {
            prop_id: p.id,
            side: "no",
            stake: entryType === "free" ? 11 : 7,
          });
          await as(a);
          await cmd("lock", { prop_id: p.id });
          await cmd("await", { prop_id: p.id });
          await cmd("propose", {
            prop_id: p.id,
            side: "yes",
            evidence: `Synthetic ${sport} final-score evidence for this test only.`,
          });
          await assert.rejects(
            cmd("settle", { prop_id: p.id }),
            /Human confirmation/,
          );
          await cmd("vote", { prop_id: p.id, approve: true });
          await as(b);
          await cmd("vote", { prop_id: p.id, approve: true });
          const settled = await cmd("settle", { prop_id: p.id });
          assert.equal(settled.status, "settled");
          await assert.rejects(
            cmd("settle", { prop_id: p.id }),
            /Human confirmation/,
          );
          await as(a);
          const after = (
            await db.query<{ balance: number }>(
              "select balance from profiles where id=$1",
              [a],
            )
          ).rows[0].balance;
          assert.equal(after - balanceBefore, entryType === "free" ? 11 : 7);
          const refunded = await cmd("create", payload);
          await cmd("void", {
            prop_id: refunded.id,
            reason: "Synthetic abandoned match",
          });
          assert.equal(
            (
              await db.query<{ balance: number }>(
                "select balance from profiles where id=$1",
                [a],
              )
            ).rows[0].balance,
            after,
          );
          await db.exec("reset role");
          assert.equal(
            (
              await db.query<{ net: number }>(
                "select sum(amount)::int as net from token_transactions where prop_id=$1",
                [p.id],
              )
            ).rows[0].net,
            0,
          );
        },
      );
    }
  }
  await t.test(
    "chat, social feed, follows and wallet enforce caller identity and room isolation",
    async () => {
      await as(a);
      await db.query(
        "insert into chat_messages(group_id,user_id,body) values($1,$2,'Private test message')",
        [gid, a],
      );
      await assert.rejects(
        db.query(
          "insert into chat_messages(group_id,user_id,body) values($1,$2,'Impersonation')",
          [gid, b],
        ),
        /row-level security/,
      );
      await db.query(
        "insert into feed_posts(user_id,body) values($1,'Synthetic public feed post')",
        [a],
      );
      await assert.rejects(
        db.query(
          "insert into feed_posts(user_id,body) values($1,'Impersonation')",
          [b],
        ),
        /row-level security/,
      );
      await db.query(
        "insert into follows(follower_id,following_id) values($1,$2)",
        [a, b],
      );
      await as(outsider);
      assert.equal(
        (await db.query("select * from chat_messages")).rows.length,
        0,
      );
      assert.equal((await db.query("select * from follows")).rows.length, 0);
      assert.equal(
        (
          await db.query(
            "select * from token_transactions where user_id<>auth.uid()",
          )
        ).rows.length,
        0,
      );
      await assert.rejects(
        db.query(
          "insert into chat_messages(group_id,user_id,body) values($1,$2,'Outsider')",
          [gid, outsider],
        ),
        /row-level security/,
      );
      await as(a);
      await db.query(
        "delete from follows where follower_id=$1 and following_id=$2",
        [a, b],
      );
      assert.equal((await db.query("select * from follows")).rows.length, 0);
    },
  );
  await t.test(
    "group settings enforce admin rights, snapshot confirmation rules and track missed calls",
    async () => {
      const settings = {
        strict_mode: true,
        confirmation_rule: "initiator_plus_one",
        who_can_create_props: "admin",
        ai_confidence_threshold: 0.95,
      };
      await as(b);
      await assert.rejects(
        db.query("select manage_group($1,'settings',$2::jsonb)", [
          gid,
          JSON.stringify(settings),
        ]),
        /admin/,
      );
      await as(a);
      await db.query("select manage_group($1,'settings',$2::jsonb)", [
        gid,
        JSON.stringify(settings),
      ]);
      await as(b);
      await assert.rejects(create(), /admin/i);
      await as(a);
      const p = await create();
      await as(b);
      await cmd("join", { prop_id: p.id, side: "no", stake: 20 });
      await as(a);
      await cmd("lock", { prop_id: p.id });
      assert.ok(
        (
          await db.query<{ missed_props: number }>(
            "select missed_props from group_members where group_id=$1 and user_id=$2",
            [gid, c],
          )
        ).rows[0].missed_props > 0,
      );
      await db.query("select manage_group($1,'settings',$2::jsonb)", [
        gid,
        JSON.stringify({ ...settings, confirmation_rule: "admin" }),
      ]);
      await cmd("await", { prop_id: p.id });
      await cmd("propose", {
        prop_id: p.id,
        side: "yes",
        evidence: "Test evidence for immutable quorum policy",
      });
      await cmd("vote", { prop_id: p.id, approve: true });
      assert.equal(
        (
          await db.query<{ status: string }>(
            "select status from custom_props where id=$1",
            [p.id],
          )
        ).rows[0].status,
        "proposed",
      );
      await as(b);
      await cmd("vote", { prop_id: p.id, approve: true });
      await cmd("settle", { prop_id: p.id });
      await as(a);
      const oneSided = await create();
      await cmd("lock", { prop_id: oneSided.id });
      await cmd("await", { prop_id: oneSided.id });
      await cmd("propose", {
        prop_id: oneSided.id,
        side: "yes",
        evidence: "Synthetic single-sided pool result",
      });
      await cmd("vote", { prop_id: oneSided.id, approve: true });
      await assert.rejects(
        cmd("settle", { prop_id: oneSided.id }),
        /Both sides/,
      );
      await cmd("void", {
        prop_id: oneSided.id,
        reason: "Only one side participated",
      });
    },
  );
  await db.close();
});
