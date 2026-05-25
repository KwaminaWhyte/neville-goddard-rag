// Home — name a new desire and browse existing ones.
import { useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Onboarding from "../components/Onboarding";
import { Button, Card, Field, Muted, Pill, SectionTitle } from "../components/ui";
import { createGoal, listGoals } from "../lib/api";
import { colors, font, radius, space } from "../lib/theme";
import type { Goal } from "../lib/types";

function statusColor(status: string): string {
  switch (status) {
    case "realised":
      return colors.gold;
    case "released":
      return colors.muted;
    default:
      return colors.accent; // active
  }
}

export default function Home() {
  const router = useRouter();

  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState(false);

  const [title, setTitle] = useState("");
  const [desire, setDesire] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await listGoals();
      setGoals(data);
      setLoadError(false);
    } catch {
      setLoadError(true);
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await load();
      setLoading(false);
    })();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const onBegin = useCallback(async () => {
    const t = title.trim();
    const d = desire.trim();
    if (!t || !d) {
      setFormError("Give your desire a name and describe it as already done.");
      return;
    }
    setFormError(null);
    setCreating(true);
    try {
      const goal = await createGoal(t, d);
      setTitle("");
      setDesire("");
      setGoals((prev) => [goal, ...prev]);
      router.push(`/goal/${goal.id}`);
    } catch {
      setFormError("Couldn't create the desire — is the server reachable?");
    } finally {
      setCreating(false);
    }
  }, [title, desire, router]);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.gold}
          />
        }
      >
        <Text style={styles.tagline}>
          Assume the feeling of the wish fulfilled. Name a desire — be guided, in
          Neville’s own teaching, until it is realised.
        </Text>

        <Card>
          <SectionTitle>Name a new desire</SectionTitle>
          <Field
            placeholder="Title"
            value={title}
            onChangeText={setTitle}
            style={styles.fieldSpacing}
          />
          <Field
            placeholder="Describe it as already done…"
            value={desire}
            onChangeText={setDesire}
            multiline
            style={styles.fieldSpacing}
          />
          {formError ? <Text style={styles.error}>{formError}</Text> : null}
          <Button title="Begin" onPress={onBegin} loading={creating} />
        </Card>

        <SectionTitle>Your desires</SectionTitle>

        {loading ? (
          <Muted>Loading…</Muted>
        ) : loadError ? (
          <Muted>
            Couldn’t reach the server — set EXPO_PUBLIC_API_URL to your machine’s
            LAN address.
          </Muted>
        ) : goals.length === 0 ? (
          <Onboarding />
        ) : (
          <View style={styles.list}>
            {goals.map((g) => (
              <Pressable
                key={g.id}
                onPress={() => router.push(`/goal/${g.id}`)}
                style={({ pressed }) => [styles.goalCard, pressed && { opacity: 0.7 }]}
              >
                <View style={styles.goalHeader}>
                  <Text style={styles.goalTitle} numberOfLines={1}>
                    {g.title}
                  </Text>
                  <Pill color={statusColor(g.status)}>{g.status}</Pill>
                </View>
                <Text style={styles.goalDesire} numberOfLines={2}>
                  {g.desire}
                </Text>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.base },
  content: { padding: space.xl, paddingBottom: space.xxl },
  tagline: {
    color: colors.muted,
    fontSize: font.sizes.sm,
    lineHeight: 20,
    marginBottom: space.xl,
  },
  fieldSpacing: { marginBottom: space.md },
  error: { color: colors.danger, fontSize: font.sizes.sm, marginBottom: space.md },
  list: { gap: space.md },
  goalCard: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.lg,
  },
  goalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: space.sm,
    gap: space.sm,
  },
  goalTitle: {
    fontFamily: font.serif,
    color: colors.ink,
    fontSize: font.sizes.lg,
    flex: 1,
  },
  goalDesire: { color: colors.muted, fontSize: font.sizes.sm, lineHeight: 19 },
});
