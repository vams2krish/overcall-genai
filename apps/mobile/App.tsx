import "react-native-url-polyfill/auto";
import React, { useCallback, useEffect, useState } from "react";
import {
  Alert,
  AppState,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import * as SecureStore from "expo-secure-store";
import { createClient } from "@supabase/supabase-js";
import { polyfillWebCrypto } from "expo-standard-web-crypto";
import { nativeCallbackParams, nativeRedirectUrl } from "./lib/auth-callback";
polyfillWebCrypto();
import {
  createPropSchema,
  type Prop,
  type Side,
} from "../../packages/core/src/index";
const url = process.env.EXPO_PUBLIC_SUPABASE_URL,
  key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const storage = {
  getItem: SecureStore.getItemAsync,
  setItem: SecureStore.setItemAsync,
  removeItem: SecureStore.deleteItemAsync,
};
const db =
  url && key
    ? createClient(url, key, {
        auth: {
          storage,
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
          flowType: "pkce",
        },
      })
    : null;
function Action({
  title,
  onPress,
  secondary = false,
}: {
  title: string;
  onPress: () => void;
  secondary?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.button, secondary && styles.secondary]}
    >
      <Text style={secondary ? styles.secondaryText : styles.buttonText}>
        {title}
      </Text>
    </Pressable>
  );
}
export default function App() {
  const [user, setUser] = useState<string | null>(null),
    [email, setEmail] = useState(""),
    [code, setCode] = useState(""),
    [sent, setSent] = useState(false),
    [props, setProps] = useState<Prop[]>([]),
    [group, setGroup] = useState<string | null>(null),
    [groups, setGroups] = useState<{ id: string; name: string }[]>([]),
    [balance, setBalance] = useState(0),
    [create, setCreate] = useState(false),
    [title, setTitle] = useState(""),
    [stake, setStake] = useState("20"),
    [side, setSide] = useState<Side>("yes"),
    [selected, setSelected] = useState<Prop | null>(null),
    [evidence, setEvidence] = useState(""),
    [proposal, setProposal] = useState<{ side: Side; evidence: string } | null>(
      null,
    );
  const load = useCallback(async () => {
    if (!db || !user) return;
    const [g, p] = await Promise.all([
      db.from("groups").select("id,name"),
      db.from("profiles").select("balance").eq("id", user).single(),
    ]);
    if (g.error || p.error) {
      Alert.alert("Could not load", g.error?.message ?? p.error?.message);
      return;
    }
    setGroups(g.data ?? []);
    setBalance(p.data?.balance ?? 0);
    const gid = group ?? g.data?.[0]?.id;
    if (!gid) return;
    if (gid !== group) {
      setGroup(gid);
      return;
    }
    const { data, error } = await db
      .from("custom_props")
      .select("*")
      .eq("group_id", gid)
      .order("created_at", { ascending: false });
    if (error) Alert.alert("Room unavailable", error.message);
    else {
      setProps(data as Prop[]);
      if (selected)
        setSelected((data?.find((p) => p.id === selected.id) as Prop) ?? null);
    }
  }, [group, user, selected?.id]);
  useEffect(() => {
    if (!db) return;
    let lastCode = "";
    const handleLink = async (input: string | null | undefined) => {
      if (!input) return;
      const callback = nativeCallbackParams(input);
      if (!callback) return;
      if (callback.error) {
        Alert.alert("Sign-in failed", callback.error);
        return;
      }
      if (!callback.code || callback.code === lastCode) return;
      lastCode = callback.code;
      const { error } = await db.auth.exchangeCodeForSession(
        callback.code,
        callback.flowId ? { flowId: callback.flowId } : undefined,
      );
      if (error) Alert.alert("Sign-in failed", error.message);
    };
    const links = Linking.addEventListener(
      "url",
      ({ url }) => void handleLink(url),
    );
    void Linking.getInitialURL()
      .then(handleLink)
      .catch(() =>
        Alert.alert(
          "Sign-in failed",
          "Could not open the sign-in link. Please request a new one.",
        ),
      );
    void db.auth
      .getSession()
      .then(({ data }) => setUser(data.session?.user.id ?? null));
    const { data } = db.auth.onAuthStateChange((_e, s) =>
      setUser(s?.user.id ?? null),
    );
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") db.auth.startAutoRefresh();
      else db.auth.stopAutoRefresh();
    });
    return () => {
      data.subscription.unsubscribe();
      sub.remove();
      links.remove();
    };
  }, []);
  useEffect(() => {
    void load();
    if (!db || !group) return;
    const c = db
      .channel(`mobile-${group}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public" },
        () => void load(),
      )
      .subscribe();
    return () => {
      void db.removeChannel(c);
    };
  }, [load, group]);
  useEffect(() => {
    if (!db || !selected) return;
    void db
      .from("custom_prop_proposals")
      .select("side,evidence")
      .eq("prop_id", selected.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .then(({ data }) =>
        setProposal((data?.[0] as { side: Side; evidence: string }) ?? null),
      );
  }, [selected?.id, selected?.status]);
  async function command(
    action: string,
    payload: Record<string, unknown> = {},
  ) {
    if (!db) return false;
    const { error } = await db.rpc("prop_command", {
      action,
      payload: { group_id: group, prop_id: selected?.id, ...payload },
    });
    if (error) {
      Alert.alert("Could not complete call", error.message);
      return false;
    }
    await load();
    return true;
  }
  if (!db)
    return (
      <View style={styles.center}>
        <StatusBar style="light" />
        <Text style={styles.brand}>overcall</Text>
        <Text style={styles.heading}>Your people. Your calls.</Text>
        <Text style={styles.muted}>
          Configure the Expo public Supabase URL and publishable key to connect
          this native client. Try the web demo to explore without an account.
        </Text>
      </View>
    );
  if (!user)
    return (
      <View style={styles.center}>
        <StatusBar style="light" />
        <Text style={styles.brand}>overcall</Text>
        <Text style={styles.heading}>Make the call.</Text>
        <Text style={styles.muted}>
          Get a secure sign-in link by email. Open it on this device to return
          to Overcall.
        </Text>
        <TextInput
          accessibilityLabel="Email"
          style={styles.input}
          placeholder="you@example.com"
          placeholderTextColor="#89778f"
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        {sent ? (
          <>
            <Text style={styles.muted}>
              Check your email and tap the sign-in link. If your email also
              includes a code, you can enter it below.
            </Text>
            <TextInput
              accessibilityLabel="Email verification code"
              style={styles.input}
              placeholder="Email code"
              placeholderTextColor="#89778f"
              keyboardType="number-pad"
              value={code}
              onChangeText={setCode}
            />
            <Action
              title="Verify code"
              onPress={async () => {
                const { error } = await db.auth.verifyOtp({
                  email,
                  token: code,
                  type: "email",
                });
                if (error) Alert.alert("Sign-in failed", error.message);
              }}
            />
          </>
        ) : (
          <Action
            title="Send sign-in link"
            onPress={async () => {
              const { error } = await db.auth.signInWithOtp({
                email,
                options: { emailRedirectTo: nativeRedirectUrl },
              });
              if (error) Alert.alert("Sign-in failed", error.message);
              else setSent(true);
            }}
          />
        )}
      </View>
    );
  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.row}>
          <Text style={styles.brand}>overcall</Text>
          <Text style={styles.pill}>{balance.toLocaleString()} tk</Text>
        </View>
        <Text style={styles.eyebrow}>YOUR INNER CIRCLE</Text>
        <Text style={styles.heading}>Make the call.</Text>
        <Text style={styles.muted}>Virtual tokens. Real rivalries.</Text>
        <ScrollView horizontal>
          {groups.map((g) => (
            <Action
              key={g.id}
              title={g.name}
              secondary={g.id !== group}
              onPress={() => setGroup(g.id)}
            />
          ))}
        </ScrollView>
        {!groups.length && (
          <>
            <Text style={styles.muted}>
              Create your first group below, then add friends from the web app.
            </Text>
            <Action
              title="Create The Pavilion"
              onPress={() =>
                void command("create_group", { name: "The Pavilion" })
              }
            />
          </>
        )}
        <Action title="+ Create a prop" onPress={() => setCreate(true)} />
        {props.map((p) => (
          <Pressable
            key={p.id}
            accessibilityRole="button"
            accessibilityLabel={`Review ${p.title}`}
            style={styles.card}
            onPress={() => setSelected(p)}
          >
            <View style={styles.row}>
              <Text style={styles.eyebrow}>{p.sport.toUpperCase()}</Text>
              <Text style={styles.status}>
                {p.status.replace("_", " ").toUpperCase()}
              </Text>
            </View>
            <Text style={styles.cardTitle}>{p.title}</Text>
            <Text style={styles.muted}>
              {p.entry_type === "free"
                ? "Choose your stake"
                : `${p.entry_type === "match" ? p.initial_stake : p.entry_amount} token entry`}
            </Text>
            {p.status === "open" && (
              <View style={styles.row}>
                <Action
                  title="Yes ↗"
                  onPress={() =>
                    void command("join", {
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
                />
                <Action
                  title="No ↗"
                  secondary
                  onPress={() =>
                    void command("join", {
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
                />
              </View>
            )}
          </Pressable>
        ))}
        <Text style={styles.muted}>
          AI suggests. Humans confirm. No cash value.
        </Text>
        <Action
          title="Claim daily 50 tokens"
          secondary
          onPress={() => void command("daily")}
        />
        <Action
          title="Sign out"
          secondary
          onPress={() => void db.auth.signOut()}
        />
      </ScrollView>
      <Modal
        visible={create}
        animationType="slide"
        onRequestClose={() => setCreate(false)}
      >
        <ScrollView contentContainerStyle={styles.modal}>
          <Text style={styles.heading}>What’s your call?</Text>
          <Text style={styles.muted}>
            Cricket · fixed entry · 5 minute timer
          </Text>
          <TextInput
            accessibilityLabel="Prediction"
            placeholder="Two sixes in over 16?"
            placeholderTextColor="#89778f"
            value={title}
            onChangeText={setTitle}
            style={styles.input}
            multiline
          />
          <TextInput
            accessibilityLabel="Stake"
            value={stake}
            onChangeText={setStake}
            keyboardType="number-pad"
            style={styles.input}
          />
          <View style={styles.row}>
            <Action
              title="Yes"
              secondary={side !== "yes"}
              onPress={() => setSide("yes")}
            />
            <Action
              title="No"
              secondary={side !== "no"}
              onPress={() => setSide("no")}
            />
          </View>
          <Action
            title="Put it to the room"
            onPress={async () => {
              const p = createPropSchema.safeParse({
                title,
                sport: "Cricket",
                stake: Number(stake),
                side,
                entry_type: "fixed",
                entry_amount: Number(stake),
                minutes: 5,
              });
              if (!p.success) {
                Alert.alert("Check your call", p.error.issues[0].message);
                return;
              }
              if (await command("create", p.data)) {
                setCreate(false);
                setTitle("");
              }
            }}
          />
          <Action title="Cancel" secondary onPress={() => setCreate(false)} />
        </ScrollView>
      </Modal>
      <Modal
        visible={!!selected}
        animationType="slide"
        onRequestClose={() => setSelected(null)}
      >
        <ScrollView contentContainerStyle={styles.modal}>
          <Text style={styles.eyebrow}>HUMAN-CONFIRMED RESULTS</Text>
          <Text style={styles.heading}>{selected?.title}</Text>
          <Text style={styles.muted}>{selected?.status.replace("_", " ")}</Text>
          {selected?.status === "open" && (
            <Action title="Lock entries" onPress={() => void command("lock")} />
          )}{" "}
          {selected?.status === "locked" && (
            <Action
              title="Collect result"
              onPress={() => void command("await")}
            />
          )}{" "}
          {selected?.status === "awaiting_result" && (
            <>
              <TextInput
                accessibilityLabel="Result evidence"
                placeholder="Describe observed result and event window"
                placeholderTextColor="#89778f"
                style={styles.input}
                multiline
                value={evidence}
                onChangeText={setEvidence}
              />
              <Action
                title="Propose YES"
                onPress={() =>
                  void command("propose", { side: "yes", evidence })
                }
              />
              <Action
                title="Propose NO"
                secondary
                onPress={() =>
                  void command("propose", { side: "no", evidence })
                }
              />
            </>
          )}
          {proposal && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>
                Proposed: {proposal.side.toUpperCase()}
              </Text>
              <Text style={styles.muted}>{proposal.evidence}</Text>
            </View>
          )}
          {selected?.status === "proposed" && (
            <>
              <Action
                title="Confirm outcome"
                onPress={() => void command("vote", { approve: true })}
              />
              <Action
                title="Reject proposal"
                secondary
                onPress={() => void command("vote", { approve: false })}
              />
            </>
          )}
          {selected?.status === "confirmed" && (
            <Action
              title="Settle and distribute"
              onPress={() => void command("settle")}
            />
          )}
          <Text style={styles.muted}>
            Scoreboard capture and admin void tools are available in the web
            client.
          </Text>
          <Action
            title="Back to room"
            secondary
            onPress={() => setSelected(null)}
          />
        </ScrollView>
      </Modal>
    </View>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#111112" },
  content: { padding: 22, paddingTop: 65, gap: 16, paddingBottom: 45 },
  center: {
    flex: 1,
    backgroundColor: "#111112",
    padding: 28,
    justifyContent: "center",
    gap: 20,
  },
  brand: {
    fontSize: 33,
    fontWeight: "800",
    letterSpacing: -1.5,
    color: "#f1efea",
  },
  heading: {
    fontSize: 34,
    fontWeight: "600",
    letterSpacing: -1,
    color: "#f1efea",
  },
  eyebrow: { fontSize: 10, letterSpacing: 1.5, color: "#d4a184" },
  muted: { fontSize: 13, color: "#a593af", lineHeight: 21 },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 10,
  },
  pill: {
    padding: 10,
    borderRadius: 7,
    color: "#f1b38a",
    backgroundColor: "#35271f",
    fontSize: 12,
  },
  button: {
    backgroundColor: "#f18951",
    padding: 15,
    borderRadius: 8,
    alignItems: "center",
    marginRight: 6,
    marginVertical: 3,
    minHeight: 48,
  },
  buttonText: { color: "#241811", fontSize: 13, fontWeight: "600" },
  secondary: {
    backgroundColor: "#2b2231",
    borderWidth: 1,
    borderColor: "#5e456c",
  },
  secondaryText: { color: "#d6bcdf", fontSize: 13 },
  input: {
    borderWidth: 1,
    borderColor: "#58425d",
    backgroundColor: "#211a26",
    borderRadius: 8,
    padding: 15,
    color: "#f1efea",
    fontSize: 15,
    minHeight: 48,
  },
  card: {
    backgroundColor: "#211b26",
    borderWidth: 1,
    borderColor: "#49354e",
    borderRadius: 12,
    padding: 19,
    gap: 15,
  },
  cardTitle: {
    fontSize: 20,
    fontWeight: "500",
    color: "#f1e7f4",
    lineHeight: 28,
  },
  status: { fontSize: 8, letterSpacing: 1, color: "#d6b08b" },
  modal: {
    flexGrow: 1,
    backgroundColor: "#18131c",
    padding: 26,
    paddingTop: 70,
    gap: 20,
  },
});
