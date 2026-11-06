import {
  payouts,
  createPropSchema,
  transition,
  type Prop,
  type Entry,
  type Proposal,
  type Transaction,
  type Side,
} from "@overcall/core";
export interface DemoState {
  props: Prop[];
  entries: Entry[];
  proposals: Proposal[];
  votes: Record<string, boolean>;
  balance: number;
  ledger: Transaction[];
  chat: { id: string; name: string; body: string }[];
  rewardDate: string | null;
}
const now = new Date().toISOString();
export const seed: DemoState = {
  balance: 1000,
  rewardDate: null,
  props: [
    {
      id: "p1",
      group_id: "demo",
      creator_id: "arjun",
      title: "Kohli to hit 2 sixes in the next over?",
      sport: "Cricket",
      status: "open",
      entry_type: "fixed",
      entry_amount: 20,
      initial_stake: 20,
      lock_at: new Date(Date.now() + 3600000).toISOString(),
      lock_type: "timer",
      result: null,
      created_at: now,
    },
    {
      id: "p2",
      group_id: "demo",
      creator_id: "maya",
      title: "India to score 180+ in this innings?",
      sport: "Cricket",
      status: "open",
      entry_type: "free",
      entry_amount: 20,
      initial_stake: 40,
      lock_at: new Date(Date.now() + 7200000).toISOString(),
      lock_type: "timer",
      result: null,
      created_at: now,
    },
    {
      id: "p3",
      group_id: "demo",
      creator_id: "you",
      title: "A wicket before the end of over 15?",
      sport: "Cricket",
      status: "proposed",
      entry_type: "fixed",
      entry_amount: 20,
      initial_stake: 20,
      lock_at: now,
      lock_type: "manual",
      result: null,
      created_at: now,
    },
  ],
  entries: [
    { id: "e1", prop_id: "p1", user_id: "arjun", side: "yes", stake: 20 },
    { id: "e2", prop_id: "p1", user_id: "maya", side: "no", stake: 20 },
    { id: "e3", prop_id: "p1", user_id: "dev", side: "yes", stake: 20 },
    { id: "e4", prop_id: "p2", user_id: "maya", side: "yes", stake: 40 },
    { id: "e5", prop_id: "p2", user_id: "dev", side: "no", stake: 30 },
    { id: "e6", prop_id: "p3", user_id: "you", side: "yes", stake: 20 },
    { id: "e7", prop_id: "p3", user_id: "arjun", side: "no", stake: 20 },
  ],
  proposals: [
    {
      id: "q1",
      prop_id: "p3",
      author_id: "arjun",
      side: "yes",
      source: "human",
      evidence:
        "Demo evidence: wicket recorded at 14.3. This is sample data, not a live result.",
      confidence: null,
    },
  ],
  votes: {},
  ledger: [
    {
      id: "t0",
      user_id: "you",
      prop_id: null,
      amount: 1000,
      kind: "grant",
      created_at: now,
    },
  ],
  chat: [
    { id: "m1", name: "Arjun", body: "That last over was unreal." },
    { id: "m2", name: "Maya", body: "Calling it. 180 is happening 👀" },
    { id: "m3", name: "Dev", body: "Someone put tokens on it then." },
  ],
};
export function demoCommand(
  state: DemoState,
  action: string,
  payload: Record<string, unknown>,
): DemoState {
  const s = structuredClone(state);
  const id = String(payload.prop_id);
  const p = s.props.find((p) => p.id === id);
  const log = (
    amount: number,
    kind: Transaction["kind"],
    pid: string | null,
  ) => {
    s.balance += amount;
    s.ledger.unshift({
      id: crypto.randomUUID(),
      user_id: "you",
      prop_id: pid,
      amount,
      kind,
      created_at: new Date().toISOString(),
    });
  };
  if (action === "daily") {
    const date = new Date().toISOString().slice(0, 10);
    if (s.rewardDate === date) throw Error("Already claimed today");
    s.rewardDate = date;
    log(50, "daily", null);
    return s;
  }
  if (action === "create") {
    payload = createPropSchema.parse(payload);
    const n = Number(payload.stake);
    if (n > s.balance) throw Error("Insufficient tokens");
    const pid = crypto.randomUUID();
    s.props.unshift({
      id: pid,
      group_id: "demo",
      creator_id: "you",
      title: String(payload.title),
      sport: payload.sport as Prop["sport"],
      status: "open",
      entry_type: payload.entry_type as Prop["entry_type"],
      entry_amount: Number(payload.entry_amount),
      initial_stake: n,
      lock_at: new Date(
        Date.now() + Number(payload.minutes) * 60000,
      ).toISOString(),
      lock_type: payload.lock_type as Prop["lock_type"],
      result: null,
      created_at: new Date().toISOString(),
    });
    s.entries.push({
      id: crypto.randomUUID(),
      prop_id: pid,
      user_id: "you",
      side: payload.side as Side,
      stake: n,
    });
    log(-n, "stake", pid);
    return s;
  }
  if (!p) throw Error("Prop not found");
  if (action === "join") {
    if (
      p.status !== "open" ||
      (p.lock_type === "timer" && Date.now() >= Date.parse(p.lock_at))
    )
      throw Error("Entries are closed");
    if (s.entries.some((e) => e.prop_id === id && e.user_id === "you"))
      throw Error("You already joined");
    const n = Number(payload.stake);
    if (!Number.isInteger(n) || n < 1 || n > s.balance)
      throw Error("Invalid stake or insufficient tokens");
    if (
      (p.entry_type === "fixed" && n !== p.entry_amount) ||
      (p.entry_type === "match" && n !== p.initial_stake)
    )
      throw Error("Stake does not meet the entry rule");
    s.entries.push({
      id: crypto.randomUUID(),
      prop_id: id,
      user_id: "you",
      side: payload.side as Side,
      stake: n,
    });
    log(-n, "stake", id);
  } else if (action === "lock") p.status = transition(p.status, "locked");
  else if (action === "await")
    p.status = transition(p.status, "awaiting_result");
  else if (action === "propose") {
    p.status = transition(p.status, "proposed");
    s.proposals.push({
      id: crypto.randomUUID(),
      prop_id: id,
      author_id: "you",
      side: payload.side as Side,
      source: "human",
      evidence: String(payload.evidence),
      confidence: null,
    });
  } else if (action === "vote") {
    if (p.status !== "proposed") throw Error("No active proposal");
    if (!s.entries.some((e) => e.prop_id === id && e.user_id === "you"))
      throw Error("Only participants can vote");
    s.votes[id] = Boolean(payload.approve);
    /* Demo simulates an admin confirmation policy; live groups use the database quorum. */ if (
      payload.approve
    ) {
      p.status = transition(p.status, "confirmed");
      p.result = s.proposals.filter((q) => q.prop_id === id).at(-1)!.side;
    } else p.status = transition(p.status, "awaiting_result");
  } else if (action === "settle") {
    if (p.status !== "confirmed") throw Error("Human confirmation required");
    const es = s.entries.filter((e) => e.prop_id === id);
    const amounts = payouts(es, p.result!);
    for (const e of es)
      if (e.user_id === "you" && amounts[e.id])
        log(amounts[e.id], "payout", id);
    p.status = transition(p.status, "settled");
  } else if (action === "void") {
    p.status = transition(p.status, "voided");
    for (const e of s.entries.filter(
      (e) => e.prop_id === id && e.user_id === "you",
    ))
      log(e.stake, "refund", id);
  } else throw Error("Unsupported demo action");
  return s;
}
