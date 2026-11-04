import test from "node:test";
import assert from "node:assert/strict";
import {
  payouts,
  transition,
  visionSchema,
  createPropSchema,
} from "../packages/core/src/index";
test("locked props cannot reopen, and AI cannot skip human confirmation", () => {
  assert.throws(() => transition("locked", "open"));
  assert.throws(() => transition("proposed", "settled"));
  assert.equal(transition("proposed", "confirmed"), "confirmed");
  assert.throws(() => transition("settled", "voided"));
});
test("integer payouts conserve the entire pool with deterministic remainders", () => {
  const entries = [
    { id: "b", side: "yes" as const, stake: 1 },
    { id: "a", side: "yes" as const, stake: 1 },
    { id: "c", side: "no" as const, stake: 1 },
  ];
  assert.deepEqual(payouts(entries, "yes"), { a: 2, b: 1 });
  assert.equal(
    Object.values(payouts(entries, "yes")).reduce((a, b) => a + b),
    3,
  );
  assert.deepEqual(payouts([...entries].reverse(), "yes"), { a: 2, b: 1 });
});
test("one-sided pools require a refund", () =>
  assert.throws(() => payouts([{ id: "a", side: "yes", stake: 10 }], "yes")));
test("vision rejects invalid confidence and negative counts", () =>
  assert.equal(
    visionSchema.safeParse({
      player: null,
      over: null,
      sixes: -1,
      wickets: null,
      runs: null,
      confidence: 1.2,
      suggested_side: null,
      explanation: "Uncertain",
      sufficient_evidence: false,
    }).success,
    false,
  ));
test("creation validates wording, integer stakes and bounded lock duration", () =>
  assert.equal(
    createPropSchema.safeParse({
      title: "x",
      sport: "Cricket",
      side: "yes",
      stake: -1,
      entry_type: "fixed",
      entry_amount: 20,
      minutes: 0,
    }).success,
    false,
  ));
