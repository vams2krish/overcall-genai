import test from "node:test";
import assert from "node:assert/strict";
import { sports } from "../packages/core/src/index";
import { demoCommand, seed } from "../apps/web/lib/demo";

for (const sport of sports) {
  test(`${sport}: demo create, lock, proposal, rejection and void preserve wallet`, () => {
    let state = demoCommand(seed, "create", {
      sport,
      title: `${sport} home team wins the completed match?`,
      side: "yes",
      stake: 20,
      entry_type: "fixed",
      entry_amount: 20,
      minutes: 5,
      lock_type: "manual",
    });
    const id = state.props[0].id;
    assert.equal(state.props[0].sport, sport);
    assert.equal(state.balance, seed.balance - 20);
    assert.throws(
      () => demoCommand(state, "join", { prop_id: id, side: "no", stake: 20 }),
      /already joined/,
    );
    state = demoCommand(state, "lock", { prop_id: id });
    assert.throws(
      () => demoCommand(state, "join", { prop_id: id, side: "no", stake: 20 }),
      /closed/,
    );
    state = demoCommand(state, "await", { prop_id: id });
    state = demoCommand(state, "propose", {
      prop_id: id,
      side: "yes",
      evidence: "Synthetic complete-match evidence",
    });
    assert.throws(
      () => demoCommand(state, "settle", { prop_id: id }),
      /confirmation/,
    );
    state = demoCommand(state, "vote", { prop_id: id, approve: false });
    assert.equal(state.props[0].status, "awaiting_result");
    state = demoCommand(state, "void", { prop_id: id });
    assert.equal(state.balance, seed.balance);
    assert.throws(() => demoCommand(state, "void", { prop_id: id }));
    assert.equal(seed.balance, 1000);
  });
}
test("demo daily reward is granted once and overspending is atomic", () => {
  const state = demoCommand(seed, "daily", {});
  assert.equal(state.balance, 1050);
  assert.throws(() => demoCommand(state, "daily", {}), /Already claimed/);
  assert.throws(
    () =>
      demoCommand(state, "join", { prop_id: "p1", side: "yes", stake: 2000 }),
    /insufficient/,
  );
  assert.equal(seed.balance, 1000);
});
test("invalid demo creation cannot mint tokens or bypass sport validation", () => {
  for (const change of [{ stake: -100 }, { sport: "Tennis" }, { stake: 1.5 }]) {
    assert.throws(() =>
      demoCommand(seed, "create", {
        sport: "NBA",
        title: "Home team wins the completed game?",
        side: "yes",
        stake: 20,
        entry_type: "fixed",
        entry_amount: 20,
        minutes: 5,
        lock_type: "manual",
        ...change,
      }),
    );
    assert.equal(seed.balance, 1000);
  }
});
