"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Bell,
  Check,
  ChevronDown,
  CircleHelp,
  Coins,
  Flame,
  Globe,
  Hash,
  LayoutGrid,
  LockKeyhole,
  LogOut,
  MessageCircle,
  Plus,
  Radio,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Sparkles,
  Trophy,
  Users,
  Wallet,
  X,
} from "lucide-react";
import {
  createPropSchema,
  marketShare,
  sports,
  type Entry,
  type Prop,
  type Proposal,
  type Side,
  type Transaction,
} from "@overcall/core";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/lib/supabase";
import { demoCommand, seed, type DemoState } from "@/lib/demo";
import { SportsScoreboard } from "@/components/sports-scoreboard";
import { BroadcastPanel } from "@/components/broadcast-panel";
type Section =
  | "Match room"
  | "My groups"
  | "Explore"
  | "Leaderboard"
  | "Wallet";
const names: Record<string, string> = {
  you: "You",
  arjun: "Arjun",
  maya: "Maya",
  dev: "Dev",
};
export function Overcall() {
  const [state, setState] = useState<DemoState>(seed);
  const [section, setSection] = useState<Section>("Match room");
  const [sport, setSport] = useState<Prop["sport"]>("Cricket");
  const [roomStream, setRoomStream] = useState<MediaStream | null>(null);
  const [tab, setTab] = useState("All props");
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<
    "create" | "auth" | "settings" | "group" | null
  >(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [user, setUser] = useState<string | null>(null);
  const [groupId, setGroupId] = useState("demo");
  const [groups, setGroups] = useState<
    { id: string; name: string; owner_id: string }[]
  >([]);
  const [message, setMessage] = useState("");
  const [feed, setFeed] = useState<
    { id: string; body: string; user_id: string }[]
  >([]);
  const [members, setMembers] = useState<
    { id: string; display_name: string; balance: number }[]
  >([]);
  const [ready, setReady] = useState(false);
  const isLive = !!supabase && !!user;
  const uid = isLive ? user! : "you";
  const toast = (text: string) => {
    setNotice(text);
  };
  useEffect(() => {
    if (notice) {
      const t = setTimeout(() => setNotice(""), 6000);
      return () => clearTimeout(t);
    }
  }, [notice]);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("overcall-demo-v1");
      if (saved) setState(JSON.parse(saved));
    } catch {}
    setReady(true);
    if (!supabase) return;
    void supabase.auth
      .getSession()
      .then(({ data }) => setUser(data.session?.user.id ?? null));
    const { data } = supabase.auth.onAuthStateChange((_e, s) =>
      setUser(s?.user.id ?? null),
    );
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (ready && !isLive)
      localStorage.setItem("overcall-demo-v1", JSON.stringify(state));
  }, [state, ready, isLive]);
  const refresh = useCallback(async () => {
    if (!supabase || !user) return;
    const gs = await supabase.from("groups").select("*");
    if (gs.error) {
      toast(gs.error.message);
      return;
    }
    setGroups(gs.data ?? []);
    const gid = gs.data?.some((g) => g.id === groupId)
      ? groupId
      : gs.data?.[0]?.id;
    if (gid && gid !== groupId) {
      setGroupId(gid);
      return;
    }
    const [profile, props, ledger, chats, posts] = await Promise.all([
      supabase.from("profiles").select("*"),
      supabase
        .from("custom_props")
        .select("*")
        .eq("group_id", gid ?? "00000000-0000-0000-0000-000000000000")
        .order("created_at", { ascending: false }),
      supabase
        .from("token_transactions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("chat_messages")
        .select("*")
        .eq("group_id", gid ?? "00000000-0000-0000-0000-000000000000")
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("feed_posts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(30),
    ]);
    const err = [profile, props, ledger, chats, posts].find(
      (r) => r.error,
    )?.error;
    if (err) {
      toast(err.message);
      return;
    }
    const ids = (props.data ?? []).map((p) => p.id);
    const [entries, proposals] = ids.length
      ? await Promise.all([
          supabase.from("custom_prop_entries").select("*").in("prop_id", ids),
          supabase
            .from("custom_prop_proposals")
            .select("*")
            .in("prop_id", ids)
            .order("created_at"),
        ])
      : [{ data: [] }, { data: [] }];
    setMembers(profile.data ?? []);
    setFeed(posts.data ?? []);
    setState((s) => ({
      ...s,
      props: props.data as Prop[],
      entries: (entries.data as Entry[]) ?? [],
      proposals: (proposals.data as Proposal[]) ?? [],
      balance: profile.data?.find((p) => p.id === user)?.balance ?? 0,
      ledger: (ledger.data as Transaction[]) ?? [],
      chat: [...(chats.data ?? [])].reverse().map((c) => ({
        id: c.id,
        name:
          profile.data?.find((p) => p.id === c.user_id)?.display_name ??
          "Friend",
        body: c.body,
      })),
    }));
  }, [user, groupId]);
  useEffect(() => {
    if (!isLive) return;
    void refresh();
    const channel = supabase!.channel(`room-${groupId}`);
    for (const table of [
      "custom_props",
      "custom_prop_entries",
      "custom_prop_votes",
      "chat_messages",
      "token_transactions",
      "feed_posts",
    ])
      channel.on(
        "postgres_changes",
        { event: "*", schema: "public", table },
        () => void refresh(),
      );
    channel.subscribe();
    return () => {
      void supabase!.removeChannel(channel);
    };
  }, [isLive, groupId, refresh]);
  async function command(action: string, payload: Record<string, unknown>) {
    setBusy(true);
    try {
      if (isLive) {
        const { error } = await supabase!.rpc("prop_command", {
          action,
          payload: { ...payload, group_id: groupId },
        });
        if (error) throw error;
        await refresh();
      } else setState(demoCommand(state, action, payload));
      toast(
        action === "join"
          ? "You’re in. Make it count."
          : action === "vote"
            ? "Your vote has been recorded."
            : "Done. Your room is up to date.",
      );
      return true;
    } catch (e) {
      toast(
        e instanceof Error ? e.message : (e as { message: string }).message,
      );
      return false;
    } finally {
      setBusy(false);
    }
  }
  const active = state.props.find((p) => p.id === selected);
  const filtered = state.props.filter(
    (p) =>
      (section === "Explore" || p.sport === sport) &&
      p.title.toLowerCase().includes(search.toLowerCase()) &&
      (tab === "All props" ||
        (tab === "Open" && p.status === "open") ||
        (tab === "My calls" &&
          state.entries.some((e) => e.prop_id === p.id && e.user_id === uid)) ||
        (tab === "To confirm" &&
          ["proposed", "confirmed", "awaiting_result", "locked"].includes(
            p.status,
          ))),
  );
  const displayName = (id: string) =>
    id === uid
      ? "You"
      : (members.find((m) => m.id === id)?.display_name ??
        names[id] ??
        "Friend");
  async function sendChat(e: React.FormEvent) {
    e.preventDefault();
    if (!message.trim()) return;
    if (isLive) {
      const { error } = await supabase!
        .from("chat_messages")
        .insert({ group_id: groupId, user_id: user, body: message.trim() });
      if (error) {
        toast(error.message);
        return;
      }
      await refresh();
    } else
      setState((s) => ({
        ...s,
        chat: [
          ...s.chat,
          { id: crypto.randomUUID(), name: "You", body: message.trim() },
        ],
      }));
    setMessage("");
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Overcall home">
          <img src="/logo.svg" width="34" height="34" alt="" />
          overcall<span>®</span>
        </a>
        <div className="space-label">YOUR PLAYBOOK</div>
        <nav>
          {(
            [
              { name: "Match room", icon: LayoutGrid },
              { name: "My groups", icon: Users },
              { name: "Explore", icon: Globe },
              { name: "Leaderboard", icon: Trophy },
              { name: "Wallet", icon: Wallet },
            ] as const
          ).map(({ name, icon: Icon }) => (
            <button
              key={name}
              className={`nav-item ${section === name ? "active" : ""}`}
              onClick={() => setSection(name)}
            >
              <Icon size={18} />
              {name}
              {name === "Match room" && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-rule" />
        <div className="space-label label-row">
          YOUR GROUPS
          <button aria-label="Create group" onClick={() => setModal("group")}>
            <Plus size={15} />
          </button>
        </div>
        {(isLive
          ? groups
          : [{ id: "demo", name: "The Pavilion", owner_id: "you" }]
        ).map((g) => (
          <button
            className={`group-link ${groupId === g.id ? "chosen" : ""}`}
            key={g.id}
            onClick={() => {
              setGroupId(g.id);
              setSection("Match room");
            }}
          >
            <span className="group-icon">{g.name.slice(0, 1)}</span>
            <span>
              {g.name}
              <small>
                {isLive ? "Private group" : "6 friends · Demo room"}
              </small>
            </span>
          </button>
        ))}
        <div className="sidebar-bottom">
          <div className="token-note">
            <Coins size={20} />
            <strong>Big calls. Zero real money.</strong>
            <p>Just virtual tokens and bragging rights.</p>
          </div>
          <button className="nav-item" onClick={() => setModal("settings")}>
            <Settings size={17} />
            Settings & help
          </button>
          <button className="profile" onClick={() => setModal("auth")}>
            <span className="avatar orange">{isLive ? "U" : "YK"}</span>
            <span>
              {isLive ? displayName(uid) : "Your corner"}
              <small>
                {isLive ? "Connected account" : "Try the demo · Sign in"}
              </small>
            </span>
            <ChevronDown size={14} />
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            Your playbook <span>/</span>
            <strong>{section}</strong>
          </div>
          <div className="top-actions">
            <span className="demo-badge">
              {isLive ? "CONNECTED" : "DEMO EXPERIENCE"}
            </span>
            <button
              className="balance-chip"
              onClick={() => setSection("Wallet")}
            >
              <Coins size={16} />
              {state.balance.toLocaleString()} <span>tokens</span>
            </button>
            <button
              className="icon-button"
              aria-label="Notifications"
              onClick={() =>
                toast(
                  "You’re all caught up. Props awaiting review appear in “To confirm”.",
                )
              }
            >
              <Bell size={18} />
            </button>
            <span className="avatar small">{isLive ? "U" : "YK"}</span>
          </div>
        </header>
        <main>
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                <span />
                THE GAME IS BETTER TOGETHER
              </div>
              <h1>
                {section === "Match room"
                  ? "Make the call."
                  : section === "Wallet"
                    ? "Your token wallet."
                    : section === "Leaderboard"
                      ? "Bragging rights."
                      : section === "My groups"
                        ? "Your inner circle."
                        : "Around the grounds."}
              </h1>
              <p>
                {section === "Match room"
                  ? "A little instinct. A little rivalry. All your people."
                  : section === "Wallet"
                    ? "Every call accounted for. Virtual tokens, always."
                    : section === "Leaderboard"
                      ? "Good instincts deserve a little recognition."
                      : section === "My groups"
                        ? "Small groups. Big match energy."
                        : "Discover calls and conversations from the community."}
              </p>
            </div>
            <Button
              onClick={() =>
                setModal(section === "My groups" ? "group" : "create")
              }
            >
              <Plus size={17} />
              {section === "My groups" ? "Create a group" : "Create a prop"}
            </Button>
          </div>
          {section === "Match room" || section === "Explore" ? (
            <>
              <div className="sport-tabs">
                {sports.map((s, i) => (
                  <button
                    key={s}
                    onClick={() => {
                      setSport(s);
                      setSection("Match room");
                    }}
                    className={sport === s ? "selected" : ""}
                  >
                    <span>{["◉", "◌", "◇", "◎", "◈", "⌁"][i]}</span>
                    {s}
                    {s === "Cricket" && <b>3</b>}
                  </button>
                ))}
              </div>
              <div className="room-layout">
                <section className="room-main">
                  <SportsScoreboard sport={sport} />
                  <div className="room-title">
                    <div>
                      <span className="group-icon">P</span>
                      <h2>
                        {groups.find((g) => g.id === groupId)?.name ??
                          "The Pavilion"}
                      </h2>
                      <LockKeyhole size={13} />
                      <span className="private-tag">PRIVATE ROOM</span>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => setModal("group")}
                    >
                      Invite friends <ArrowUpRight size={14} />
                    </button>
                  </div>
                  <div className="filter-row">
                    <div className="prop-tabs">
                      {["All props", "Open", "My calls", "To confirm"].map(
                        (t) => (
                          <button
                            className={tab === t ? "selected" : ""}
                            key={t}
                            onClick={() => setTab(t)}
                          >
                            {t}
                            {t === "To confirm" && (
                              <span>
                                {
                                  state.props.filter(
                                    (p) => p.status === "proposed",
                                  ).length
                                }
                              </span>
                            )}
                          </button>
                        ),
                      )}
                    </div>
                    <div className="search">
                      <Search size={15} />
                      <input
                        aria-label="Search props"
                        placeholder="Find a call"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="props-list">
                    {filtered.map((p, i) => {
                      const es = state.entries.filter(
                        (e) => e.prop_id === p.id,
                      );
                      const yes = es
                        .filter((e) => e.side === "yes")
                        .reduce((a, e) => a + e.stake, 0);
                      const no = es
                        .filter((e) => e.side === "no")
                        .reduce((a, e) => a + e.stake, 0);
                      const share = marketShare(yes, no);
                      const mine = es.find((e) => e.user_id === uid);
                      return (
                        <article
                          className={`prop-card ${p.status === "proposed" ? "review-card" : ""}`}
                          key={p.id}
                        >
                          <div className="prop-meta">
                            <span className={`avatar tiny c${i % 3}`}>
                              {displayName(p.creator_id)
                                .slice(0, 2)
                                .toUpperCase()}
                            </span>
                            <strong>{displayName(p.creator_id)}</strong>
                            <span>made a call</span>
                            <span
                              className={`status ${p.status === "open" ? "status-open" : ""}`}
                            >
                              {p.status === "open" ? (
                                <>
                                  <span />
                                  OPEN
                                </>
                              ) : (
                                p.status.replace("_", " ").toUpperCase()
                              )}
                            </span>
                          </div>
                          <button
                            className="prop-title"
                            onClick={() => setSelected(p.id)}
                          >
                            {p.title}
                          </button>
                          <div className="prop-detail">
                            <span>
                              <Coins size={13} />
                              {p.entry_type === "free"
                                ? "Your choice of stake"
                                : `${p.entry_type === "match" ? p.initial_stake : p.entry_amount} token entry`}
                            </span>
                            <span>·</span>
                            <span>{es.length} calls placed</span>
                            <span className="lock-detail">
                              <LockKeyhole size={12} />
                              {p.lock_type === "timer"
                                ? "Timer lock"
                                : "Host locks"}
                            </span>
                          </div>
                          <div className="split-track">
                            <span style={{ width: `${share}%` }} />
                          </div>
                          <div className="split-label">
                            <span>
                              YES <b>{share}%</b>
                            </span>
                            <span>
                              <b>{100 - share}%</b> NO
                            </span>
                          </div>
                          <div className="prop-footer">
                            <span className="pot">
                              <Coins size={16} />
                              <strong>{yes + no}</strong> in the pot
                            </span>
                            {p.status === "open" ? (
                              <div className="call-buttons">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={!!mine || busy}
                                  onClick={() =>
                                    p.entry_type === "free"
                                      ? setSelected(p.id)
                                      : void command("join", {
                                          prop_id: p.id,
                                          side: "yes",
                                          stake:
                                            p.entry_type === "match"
                                              ? p.initial_stake
                                              : p.entry_type === "fixed"
                                                ? p.entry_amount
                                                : 20,
                                        })
                                  }
                                >
                                  Yes <ArrowUpRight size={13} />
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  disabled={!!mine || busy}
                                  onClick={() =>
                                    p.entry_type === "free"
                                      ? setSelected(p.id)
                                      : void command("join", {
                                          prop_id: p.id,
                                          side: "no",
                                          stake:
                                            p.entry_type === "match"
                                              ? p.initial_stake
                                              : p.entry_type === "fixed"
                                                ? p.entry_amount
                                                : 20,
                                        })
                                  }
                                >
                                  No <ArrowUpRight size={13} />
                                </Button>
                              </div>
                            ) : (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setSelected(p.id)}
                              >
                                {p.status === "proposed" ? (
                                  <>
                                    <ShieldCheck size={14} />
                                    Review result
                                  </>
                                ) : (
                                  "View call"
                                )}
                                <ArrowRight size={14} />
                              </Button>
                            )}
                          </div>
                          {mine && (
                            <div className="your-call">
                              <Check size={12} />
                              You called {mine.side.toUpperCase()} ·{" "}
                              {mine.stake} tokens
                            </div>
                          )}
                        </article>
                      );
                    })}
                    {!filtered.length && (
                      <div className="empty">
                        <Hash size={28} />
                        <h3>No calls here. Yet.</h3>
                        <p>Start the conversation with a prediction.</p>
                        <Button onClick={() => setModal("create")}>
                          Make the first call
                        </Button>
                      </div>
                    )}
                  </div>
                  <p className="bottom-note">
                    <ShieldCheck size={13} />
                    Virtual tokens only. No deposits, withdrawals, or cash
                    value.
                  </p>
                  {section === "Explore" && (
                    <div className="panel">
                      <h2>Community feed</h2>
                      {isLive ? (
                        feed.map((p) => <p key={p.id}>{p.body}</p>)
                      ) : (
                        <p>
                          Sign in to publish and follow community predictions.
                          Your private group calls stay private.
                        </p>
                      )}
                      <form
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const f = new FormData(e.currentTarget);
                          const body = String(f.get("post") ?? "").trim();
                          if (!isLive) {
                            setModal("auth");
                            return;
                          }
                          const { error } = await supabase!
                            .from("feed_posts")
                            .insert({ user_id: user, body });
                          if (error) toast(error.message);
                          else {
                            await refresh();
                            (e.target as HTMLFormElement).reset();
                          }
                        }}
                      >
                        <input
                          name="post"
                          required
                          maxLength={1000}
                          placeholder="Share a public prediction"
                        />
                        <Button type="submit">Post</Button>
                      </form>
                    </div>
                  )}
                </section>
                <aside className="room-aside">
                  <div className="panel leaderboard-mini">
                    <div className="panel-heading">
                      <h3>
                        <Trophy size={16} />
                        Room leaderboard
                      </h3>
                      <span>ALL TIME</span>
                    </div>
                    <p className="panel-subtitle">
                      The calls. The glory. The group chat.
                    </p>
                    {(isLive
                      ? members.map((m) => ({
                          name: m.display_name,
                          balance: m.balance,
                          id: m.id,
                        }))
                      : [
                          { name: "Arjun", balance: 1240, id: "arjun" },
                          { name: "Maya", balance: 1120, id: "maya" },
                          { name: "You", balance: state.balance, id: "you" },
                          { name: "Dev", balance: 940, id: "dev" },
                        ]
                    )
                      .sort((a, b) => b.balance - a.balance)
                      .slice(0, 4)
                      .map((m, i) => (
                        <div
                          className={`rank-row ${m.id === uid ? "is-you" : ""}`}
                          key={m.id}
                        >
                          <span className={`rank r${i}`}>
                            {String(i + 1).padStart(2, "0")}
                          </span>
                          <span className={`avatar tiny c${i % 3}`}>
                            {m.name.slice(0, 2).toUpperCase()}
                          </span>
                          <strong>{m.name}</strong>
                          <span>
                            {m.balance.toLocaleString()} <small>tk</small>
                          </span>
                        </div>
                      ))}
                    <button
                      className="panel-link"
                      onClick={() => setSection("Leaderboard")}
                    >
                      View leaderboard <ArrowRight size={14} />
                    </button>
                  </div>
                  <BroadcastPanel
                    key={groupId}
                    groupId={groupId}
                    userId={isLive ? user : null}
                    onStream={setRoomStream}
                  />
                  <div className="panel chat-panel">
                    <div className="panel-heading">
                      <h3>
                        <MessageCircle size={16} />
                        The sidelines
                      </h3>
                      <span className="online-dot" />
                    </div>
                    <div className="chat-messages" aria-live="polite">
                      {state.chat.map((m, i) => (
                        <div className="chat-message" key={m.id}>
                          <span className={`avatar tiny c${i % 3}`}>
                            {m.name.slice(0, 1)}
                          </span>
                          <div>
                            <strong>
                              {m.name}
                              <small>match chat</small>
                            </strong>
                            <p>{m.body}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                    <form className="chat-form" onSubmit={sendChat}>
                      <input
                        aria-label="Chat message"
                        placeholder="Talk a little game…"
                        value={message}
                        maxLength={2000}
                        onChange={(e) => setMessage(e.target.value)}
                      />
                      <button aria-label="Send message" type="submit">
                        <Send size={16} />
                      </button>
                    </form>
                  </div>
                  <div className="vision-note">
                    <span className="vision-icon">
                      <Sparkles size={20} />
                    </span>
                    <div>
                      <strong>AI watches. You decide.</strong>
                      <p>
                        Scoreboard vision suggests results. Your group makes the
                        final call.
                      </p>
                      <button onClick={() => setModal("settings")}>
                        How settlement works <ArrowUpRight size={13} />
                      </button>
                    </div>
                  </div>
                </aside>
              </div>
            </>
          ) : section === "Wallet" ? (
            <div className="wallet-layout">
              <div className="wallet-hero">
                <Coins size={30} />
                <span>YOUR VIRTUAL BALANCE</span>
                <h2>
                  {state.balance.toLocaleString()}
                  <small> tokens</small>
                </h2>
                <p>No cash value. Plenty of bragging rights.</p>
                <Button
                  onClick={() => void command("daily", {})}
                  disabled={busy}
                >
                  Claim daily 50 tokens <Plus size={16} />
                </Button>
              </div>
              <div className="panel">
                <h2>Transaction history</h2>
                {state.ledger.map((t) => (
                  <div className="ledger-row" key={t.id}>
                    {t.amount > 0 ? (
                      <ArrowDownLeft size={18} />
                    ) : (
                      <ArrowUpRight size={18} />
                    )}
                    <div>
                      <strong>{t.kind}</strong>
                      <small>
                        {new Date(t.created_at).toLocaleDateString()}
                      </small>
                    </div>
                    <b>
                      {t.amount > 0 ? "+" : ""}
                      {t.amount} tk
                    </b>
                  </div>
                ))}
              </div>
            </div>
          ) : section === "Leaderboard" ? (
            <div className="panel full-board">
              <h2>
                <Trophy /> Room standings
              </h2>
              <p>
                Ranked by current virtual balance. Includes starting tokens and
                rewards.
              </p>
              {(isLive
                ? members
                : [
                    { id: "arjun", display_name: "Arjun", balance: 1240 },
                    { id: "maya", display_name: "Maya", balance: 1120 },
                    { id: "you", display_name: "You", balance: state.balance },
                    { id: "dev", display_name: "Dev", balance: 940 },
                  ]
              )
                .sort((a, b) => b.balance - a.balance)
                .map((m, i) => (
                  <div className="rank-row" key={m.id}>
                    <span className="rank">{i + 1}</span>
                    <span className="avatar tiny">
                      {m.display_name.slice(0, 1)}
                    </span>
                    <strong>{m.display_name}</strong>
                    <span>{m.balance.toLocaleString()} tokens</span>
                  </div>
                ))}
              <p className="muted">
                Global ranking requires an opt-in public profile and is not
                enabled in this release.
              </p>
            </div>
          ) : (
            <div className="groups-grid">
              {(isLive
                ? groups
                : [{ id: "demo", name: "The Pavilion", owner_id: "you" }]
              ).map((g) => (
                <div className="panel group-card" key={g.id}>
                  <span className="group-icon">{g.name.slice(0, 1)}</span>
                  <h2>{g.name}</h2>
                  <p>Private room · Human-confirmed results</p>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setGroupId(g.id);
                      setSection("Match room");
                    }}
                  >
                    Enter room <ArrowRight size={16} />
                  </Button>
                </div>
              ))}
              <button
                className="panel new-group"
                onClick={() => setModal("group")}
              >
                <Plus size={28} />
                <h3>Make room for your people</h3>
                <p>Create a private watch party</p>
              </button>
            </div>
          )}
        </main>
        <footer>
          <a href="/">overcall</a>
          <span>Good calls. Better company.</span>
          <span>VIRTUAL TOKENS. REAL RIVALRIES.</span>
        </footer>
      </div>
      <Dialog
        open={modal !== null}
        onOpenChange={(open) => !open && setModal(null)}
      >
        <DialogContent>
          {modal === "create" ? (
            <CreateForm
              busy={busy}
              onCreate={async (payload) => {
                if (isLive && groups.length === 0) {
                  toast("Create a group first");
                  setModal("group");
                  return;
                }
                if (await command("create", payload)) setModal(null);
              }}
            />
          ) : modal === "auth" ? (
            <Auth
              live={isLive}
              onMessage={toast}
              onClose={() => setModal(null)}
            />
          ) : modal === "group" ? (
            <GroupForm
              live={isLive}
              groupId={groupId}
              onCreate={async (name) => {
                if (!isLive) {
                  toast(
                    "Sign in with Supabase configured to create a private group.",
                  );
                  setModal("auth");
                  return;
                }
                if (await command("create_group", { name })) setModal(null);
              }}
              onMessage={toast}
              refresh={refresh}
            />
          ) : (
            <>
              <DialogTitle className="dialog-title">
                A fair call, every time.
              </DialogTitle>
              <DialogDescription className="muted">
                Made for friends, with human judgment at the center.
              </DialogDescription>
              <div className="help-steps">
                <p>
                  <b>01 · Call it.</b> Create a clear Yes/No prediction and
                  choose your stake.
                </p>
                <p>
                  <b>02 · Lock it.</b> Entry closes permanently before the
                  result.
                </p>
                <p>
                  <b>03 · Review it.</b> Share a scoreboard or submit evidence.
                  OpenRouter vision can suggest an outcome.
                </p>
                <p>
                  <b>04 · Confirm it.</b> Participants vote. The group’s rule
                  determines confirmation.
                </p>
                <p>
                  <b>05 · Settle it.</b> The pot is split proportionally. Voids
                  refund all stakes.
                </p>
              </div>
              <p className="muted">
                Demo uses an admin confirmation simulation. Connected groups
                default to participant majority. Screenshare captures selected
                frames locally. Room broadcasting uses WebRTC; restrictive
                networks need a configured TURN relay.
              </p>
              <Button
                variant="outline"
                onClick={() => {
                  localStorage.removeItem("overcall-demo-v1");
                  setState(structuredClone(seed));
                  toast("Demo reset");
                  setModal(null);
                }}
              >
                Reset demo
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!active}
        onOpenChange={(open) => !open && setSelected(null)}
      >
        <DialogContent>
          {active && (
            <ResultFlow
              key={active.id}
              prop={active}
              sharedStream={roomStream}
              entries={state.entries.filter((e) => e.prop_id === active.id)}
              proposal={state.proposals
                .filter((q) => q.prop_id === active.id)
                .at(-1)}
              live={isLive}
              busy={busy}
              command={command}
              onMessage={toast}
              refresh={refresh}
            />
          )}
        </DialogContent>
      </Dialog>
      {notice && (
        <div className="toast" role="status">
          <Activity size={16} />
          {notice}
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
function CreateForm({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (p: Record<string, unknown>) => Promise<void>;
}) {
  const [error, setError] = useState("");
  return (
    <>
      <span className="modal-eyebrow">
        <Flame size={16} /> TRUST YOUR INSTINCT
      </span>
      <DialogTitle className="dialog-title">What’s your call?</DialogTitle>
      <DialogDescription className="muted">
        Keep it clear, measurable, and tied to a specific moment.
      </DialogDescription>
      <form
        className="stack-form"
        onSubmit={async (e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const parsed = createPropSchema.safeParse({
            title: f.get("title"),
            sport: f.get("sport"),
            side: f.get("side"),
            stake: Number(f.get("stake")),
            entry_type: f.get("entry_type"),
            entry_amount: Number(f.get("entry_amount")),
            minutes: Number(f.get("minutes")),
            lock_type: f.get("lock_type"),
          });
          if (!parsed.success) {
            setError(parsed.error.issues[0].message);
            return;
          }
          setError("");
          await onCreate(parsed.data);
        }}
      >
        <label>
          Your prediction
          <textarea
            name="title"
            required
            minLength={10}
            maxLength={240}
            placeholder="Kohli to hit 2 sixes in over 16?"
          />
        </label>
        <div className="form-grid">
          <label>
            Sport
            <select name="sport">
              {sports.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Your side
            <select name="side">
              <option value="yes">Yes, calling it</option>
              <option value="no">No, not happening</option>
            </select>
          </label>
          <label>
            Your stake
            <input
              type="number"
              name="stake"
              min={1}
              max={100000}
              defaultValue={20}
              required
            />
          </label>
          <label>
            Entry rule
            <select name="entry_type">
              <option value="fixed">Fixed stake</option>
              <option value="free">Choose any stake</option>
              <option value="match">Match my stake</option>
            </select>
          </label>
          <label>
            Fixed entry amount
            <input
              type="number"
              name="entry_amount"
              min={1}
              max={100000}
              defaultValue={20}
              required
            />
          </label>
          <label>
            Lock after (minutes)
            <input
              type="number"
              name="minutes"
              min={1}
              max={1440}
              defaultValue={5}
              required
            />
          </label>
          <label>
            Lock condition
            <select name="lock_type">
              <option value="timer">Timer</option>
              <option value="manual">Host manually locks</option>
              <option value="event">Host marks event start</option>
            </select>
          </label>
        </div>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <p className="muted">
          “Choose any stake” has no fixed buy-in. Every call still stakes at
          least one virtual token. Event locks require the host to mark the
          event.
        </p>
        <Button type="submit" disabled={busy}>
          {busy ? "Creating…" : "Put it to the room"}
          <ArrowRight size={16} />
        </Button>
      </form>
    </>
  );
}
function Auth({
  live,
  onMessage,
  onClose,
}: {
  live: boolean;
  onMessage: (s: string) => void;
  onClose: () => void;
}) {
  return (
    <>
      <DialogTitle className="dialog-title">
        Your people are waiting.
      </DialogTitle>
      <DialogDescription className="muted">
        Sign in with a secure email link.
      </DialogDescription>
      {live ? (
        <Button
          variant="outline"
          onClick={async () => {
            await supabase!.auth.signOut();
            window.location.reload();
          }}
        >
          <LogOut size={16} />
          Sign out
        </Button>
      ) : (
        <form
          className="stack-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!supabase) {
              onMessage(
                "Demo mode: add Supabase URL and publishable key to enable sign-in.",
              );
              return;
            }
            const email = String(new FormData(e.currentTarget).get("email"));
            const { error } = await supabase.auth.signInWithOtp({
              email,
              options: { emailRedirectTo: window.location.origin },
            });
            onMessage(
              error ? error.message : "Check your email for a sign-in link.",
            );
            if (!error) onClose();
          }}
        >
          <label>
            Email
            <input
              name="email"
              type="email"
              required
              placeholder="you@example.com"
            />
          </label>
          <Button type="submit">
            Send sign-in link
            <ArrowRight size={16} />
          </Button>
          <p className="muted">
            No real-money betting. Tokens cannot be bought or redeemed.
          </p>
        </form>
      )}
    </>
  );
}
function GroupForm({
  live,
  groupId,
  onCreate,
  onMessage,
  refresh,
}: {
  live: boolean;
  groupId: string;
  onCreate: (s: string) => void;
  onMessage: (s: string) => void;
  refresh: () => Promise<void>;
}) {
  const [settings, setSettings] = useState<{
    strict_mode: boolean;
    confirmation_rule: string;
    who_can_create_props: string;
    ai_confidence_threshold: number;
  } | null>(null);
  const [account, setAccount] = useState("");
  useEffect(() => {
    if (!live) return;
    void supabase!.auth
      .getUser()
      .then(({ data }) => setAccount(data.user?.id ?? ""));
    void supabase!
      .from("group_settings")
      .select("*")
      .eq("group_id", groupId)
      .single()
      .then(({ data }) => {
        if (data) setSettings(data);
      });
  }, [live, groupId]);
  return (
    <>
      <DialogTitle className="dialog-title">
        Bring your inner circle.
      </DialogTitle>
      <DialogDescription className="muted">
        Create a group or invite a friend by their account ID.
      </DialogDescription>
      {live && (
        <p className="muted">
          Your account ID: <code className="break-all">{account}</code>
        </p>
      )}
      <form
        className="stack-form"
        onSubmit={(e) => {
          e.preventDefault();
          onCreate(String(new FormData(e.currentTarget).get("name")));
        }}
      >
        <label>
          New group name
          <input
            name="name"
            required
            maxLength={80}
            placeholder="The Pavilion"
          />
        </label>
        <Button type="submit">Create private group</Button>
      </form>
      {live && (
        <form
          className="stack-form"
          onSubmit={async (e) => {
            e.preventDefault();
            const { error } = await supabase!.rpc("manage_group", {
              gid: groupId,
              action: "invite",
              payload: {
                user_id: new FormData(e.currentTarget).get("user_id"),
              },
            });
            onMessage(error ? error.message : "Friend added to the room");
            if (!error) await refresh();
          }}
        >
          <label>
            Friend’s user ID
            <input
              name="user_id"
              required
              placeholder="Account UUID (friend must sign in first)"
            />
          </label>
          <Button type="submit" variant="outline">
            Add friend (admin only)
          </Button>
          <p className="muted">Group ID: {groupId}</p>
        </form>
      )}
      {live && settings && (
        <details className="void-details">
          <summary>Group settings (admin only)</summary>
          <form
            className="stack-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const { error } = await supabase!.rpc("manage_group", {
                gid: groupId,
                action: "settings",
                payload: settings,
              });
              onMessage(
                error
                  ? error.message
                  : "Settings saved. Existing props keep their original confirmation rule.",
              );
            }}
          >
            <label>
              Confirmation rule
              <select
                value={settings.confirmation_rule}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    confirmation_rule: e.target.value,
                  })
                }
              >
                <option value="majority">Participant majority</option>
                <option value="initiator_plus_one">
                  Initiator plus one participant
                </option>
                <option value="admin">Group admin</option>
              </select>
            </label>
            <label>
              Who can create props
              <select
                value={settings.who_can_create_props}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    who_can_create_props: e.target.value,
                  })
                }
              >
                <option value="members">All members</option>
                <option value="admin">Admin only</option>
              </select>
            </label>
            <label>
              Participation tracking
              <select
                value={String(settings.strict_mode)}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    strict_mode: e.target.value === "true",
                  })
                }
              >
                <option value="false">Relaxed</option>
                <option value="true">Strict — flag missed calls</option>
              </select>
            </label>
            <label>
              Minimum AI confidence (0–1)
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                value={settings.ai_confidence_threshold}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    ai_confidence_threshold: Number(e.target.value),
                  })
                }
              />
            </label>
            <Button type="submit" variant="outline">
              Save group settings
            </Button>
          </form>
        </details>
      )}
    </>
  );
}
function ResultFlow({
  sharedStream,
  prop,
  entries,
  proposal,
  live,
  busy,
  command,
  onMessage,
  refresh,
}: {
  sharedStream: MediaStream | null;
  prop: Prop;
  entries: Entry[];
  proposal?: Proposal;
  live: boolean;
  busy: boolean;
  command: (a: string, p: Record<string, unknown>) => Promise<boolean>;
  onMessage: (s: string) => void;
  refresh: () => Promise<void>;
}) {
  const [side, setSide] = useState<Side>("yes");
  const [joinStake, setJoinStake] = useState(20);
  const [evidence, setEvidence] = useState("");
  const [visionBusy, setVisionBusy] = useState(false);
  const [sharing, setSharing] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const inFlight = useRef(false);
  const run = (a: string, p: Record<string, unknown> = {}) =>
    command(a, { prop_id: prop.id, ...p });
  const stop = () => {
    if (timer.current) clearInterval(timer.current);
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setSharing(false);
  };
  useEffect(
    () => () => {
      if (timer.current) clearInterval(timer.current);
      stream.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );
  useEffect(() => {
    if (prop.status !== "awaiting_result") stop();
  }, [prop.status]);
  async function analyze(dataUrl: string, source: "screenshare" | "upload") {
    if (inFlight.current) return;
    inFlight.current = true;
    setVisionBusy(true);
    try {
      const { data, error } = await supabase!.functions.invoke("vision", {
        body: { prop_id: prop.id, image: dataUrl, source },
      });
      if (error) {
        const context = (error as { context?: Response }).context;
        if (context instanceof Response) {
          const info = await context.json().catch(() => null);
          throw Error(
            typeof info?.error === "string" ? info.error : error.message,
          );
        }
        throw error;
      }
      if (data.error) throw Error(data.error);
      onMessage(
        data.result.sufficient_evidence
          ? "Vision suggestion recorded. Human confirmation is still required."
          : "Frame recorded. More context is needed; no outcome proposed.",
      );
      await refresh();
    } catch (e) {
      onMessage(e instanceof Error ? e.message : "Vision analysis failed");
      stop();
    } finally {
      inFlight.current = false;
      setVisionBusy(false);
    }
  }
  async function screenshare() {
    if (!live) {
      onMessage(
        "Screenshare vision requires a connected account and server-side OpenRouter key.",
      );
      return;
    }
    try {
      stream.current = sharedStream
        ? sharedStream.clone()
        : await navigator.mediaDevices.getDisplayMedia({
            video: { frameRate: 1 },
            audio: false,
          });
      if (!(await run("vision_start"))) {
        stop();
        return;
      }
      setSharing(true);
      if (video.current) {
        video.current.srcObject = stream.current;
        await video.current.play();
      }
      const capture = () => {
        if (!video.current?.videoWidth) return;
        const canvas = document.createElement("canvas");
        canvas.width = Math.min(video.current.videoWidth, 1280);
        canvas.height = Math.round(
          (canvas.width * video.current.videoHeight) / video.current.videoWidth,
        );
        canvas
          .getContext("2d")!
          .drawImage(video.current, 0, 0, canvas.width, canvas.height);
        void analyze(canvas.toDataURL("image/jpeg", 0.7), "screenshare");
      };
      stream.current.getVideoTracks()[0].onended = () => {
        stop();
        void run("vision_stop");
      };
      capture();
      timer.current = setInterval(capture, 20000);
    } catch {
      stop();
      onMessage(
        "Screen sharing was cancelled or is unavailable. Upload a screenshot instead.",
      );
    }
  }
  return (
    <>
      <span className="modal-eyebrow">
        <ShieldCheck size={16} /> HUMAN-CONFIRMED RESULTS
      </span>
      <DialogTitle className="dialog-title">{prop.title}</DialogTitle>
      <DialogDescription className="muted">
        {prop.status.replace("_", " ")} · {entries.length} participants ·{" "}
        {entries.reduce((a, e) => a + e.stake, 0)} virtual tokens
      </DialogDescription>
      <div className="state-steps">
        {[
          "open",
          "locked",
          "awaiting_result",
          "proposed",
          "confirmed",
          "settled",
        ].map((s) => (
          <span key={s} className={prop.status === s ? "current" : ""}>
            {s.replace("_", " ")}
          </span>
        ))}
      </div>
      {prop.status === "open" && (
        <div className="stack-form">
          {prop.entry_type === "free" && (
            <>
              <label>
                Your chosen stake
                <input
                  type="number"
                  min={1}
                  max={100000}
                  value={joinStake}
                  onChange={(e) => setJoinStake(Number(e.target.value))}
                />
              </label>
              <div className="call-buttons">
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run("join", { side: "yes", stake: joinStake })
                  }
                >
                  Call Yes
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run("join", { side: "no", stake: joinStake })
                  }
                >
                  Call No
                </Button>
              </div>
            </>
          )}
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void run("lock")}
          >
            <LockKeyhole size={16} />
            Lock entries permanently
          </Button>
        </div>
      )}
      {prop.status === "locked" && (
        <Button disabled={busy} onClick={() => void run("await")}>
          Collect result evidence
          <ArrowRight size={16} />
        </Button>
      )}
      {prop.status === "awaiting_result" && (
        <div className="stack-form">
          <div className="vision-controls">
            <h3>
              <Sparkles size={17} /> Scoreboard vision
            </h3>
            <p className="muted">
              Share just the scoreboard. A frame is sent to OpenRouter every 20
              seconds while this dialog is open. Only start once the prop’s
              event window has finished.
            </p>
            <video
              ref={video}
              muted
              playsInline
              className={sharing ? "video-preview" : "hidden"}
            />
            <div className="call-buttons">
              <Button
                variant="outline"
                disabled={visionBusy}
                onClick={() => {
                  if (sharing) {
                    stop();
                    void run("vision_stop");
                  } else void screenshare();
                }}
              >
                {sharing
                  ? "Stop analysis"
                  : sharedStream
                    ? "Analyze room scoreboard"
                    : "Share scoreboard"}
              </Button>
              <label className="upload-button">
                {visionBusy ? "Reading…" : "Upload a frame"}
                <input
                  aria-label="Upload scoreboard image"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={visionBusy}
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (!live) {
                      onMessage(
                        "Vision requires a connected Supabase account and OpenRouter key.",
                      );
                      return;
                    }
                    if (file.size > 4 * 1024 * 1024) {
                      onMessage("Choose an image under 4 MB");
                      return;
                    }
                    if (!(await run("vision_start"))) return;
                    const reader = new FileReader();
                    reader.onload = () =>
                      void analyze(String(reader.result), "upload");
                    reader.readAsDataURL(file);
                  }}
                />
              </label>
            </div>
          </div>
          <label>
            Human proposal
            <select
              value={side}
              onChange={(e) => setSide(e.target.value as Side)}
            >
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
          <label>
            Evidence and reasoning
            <textarea
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
              maxLength={4000}
              placeholder="What happened, in which event window, and how do you know?"
            />
          </label>
          <Button
            disabled={busy || !evidence.trim()}
            onClick={() => void run("propose", { side, evidence })}
          >
            Submit for group review
          </Button>
        </div>
      )}
      {proposal &&
        ["proposed", "confirmed", "settled"].includes(prop.status) && (
          <div className="proposal-box">
            <span className="modal-eyebrow">
              {proposal.source === "ai" ? (
                <Sparkles size={16} />
              ) : (
                <Users size={16} />
              )}{" "}
              {proposal.source === "ai" ? "AI SUGGESTION" : "HUMAN PROPOSAL"}
            </span>
            <h3>Proposed outcome: {proposal.side.toUpperCase()}</h3>
            <p>{proposal.evidence}</p>
            {proposal.confidence !== null && (
              <p className="muted">
                Estimated confidence: {Math.round(proposal.confidence * 100)}%.
                This does not confirm the outcome.
              </p>
            )}
          </div>
        )}
      {prop.status === "proposed" && (
        <div className="stack-form">
          <p className="muted">
            {live
              ? "Your group’s confirmation rule is enforced on the server."
              : "Demo: you are simulating admin confirmation. Live groups default to participant majority."}
          </p>
          <div className="call-buttons">
            <Button
              disabled={busy}
              onClick={() => void run("vote", { approve: true })}
            >
              <Check size={16} />
              Confirm outcome
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void run("vote", { approve: false })}
            >
              Reject
            </Button>
          </div>
        </div>
      )}
      {prop.status === "confirmed" && (
        <Button disabled={busy} onClick={() => void run("settle")}>
          Settle & distribute tokens
          <Coins size={16} />
        </Button>
      )}
      {["settled", "voided"].includes(prop.status) ? (
        <p className="muted">
          This result is final. All token movements are recorded in the wallet
          ledger.
        </p>
      ) : (
        <details className="void-details">
          <summary>Void this prop (group admin)</summary>
          <p className="muted">
            Full refund for every participant. A reason is required.
          </p>
          <form
            className="stack-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run("void", {
                reason: new FormData(e.currentTarget).get("reason"),
              });
            }}
          >
            <input
              name="reason"
              required
              minLength={5}
              maxLength={500}
              aria-label="Void reason"
              placeholder="Abandoned event, ambiguous wording…"
            />
            <Button variant="outline" disabled={busy}>
              Void & refund all stakes
            </Button>
          </form>
        </details>
      )}
    </>
  );
}
