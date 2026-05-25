// Goal-detail screen — the heart of the tracker. Loads the full goal bundle and
// composes the feature cards (end-scene, daily process, trends, journey log,
// signs, coach) plus status controls. Children mutate via the API then call
// reload() so the page reflects fresh server state.
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";

import { deleteGoal, getGoalBundle, setGoalStatus } from "../../lib/api";
import type { GoalBundle } from "../../lib/types";
import { colors, font, space } from "../../lib/theme";
import { Button, Card, Muted, Pill, SectionTitle } from "../../components/ui";

import HealthBanner from "../../components/HealthBanner";
import StreakBadge from "../../components/StreakBadge";
import Trends from "../../components/Trends";
import SignsTimeline from "../../components/SignsTimeline";
import JourneyLog from "../../components/JourneyLog";
import CoachChat from "../../components/CoachChat";
import EndScene from "../../components/EndScene";
import DailyProcess from "../../components/DailyProcess";

export default function GoalDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const goalId = Number(id);
  const router = useRouter();

  const [bundle, setBundle] = useState<GoalBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "realised" | "released" | "delete">(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const b = await getGoalBundle(goalId);
      setBundle(b);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load goal.");
    } finally {
      setLoading(false);
    }
  }, [goalId]);

  const reload = useCallback(() => {
    load();
  }, [load]);

  useEffect(() => {
    load();
  }, [load]);

  async function changeStatus(status: "realised" | "released") {
    setBusy(status);
    try {
      await setGoalStatus(goalId, status);
      await load();
    } catch {
      // leave state as-is on failure
    } finally {
      setBusy(null);
    }
  }

  function confirmDelete() {
    Alert.alert(
      "Delete goal",
      "This permanently removes the goal and its log. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            setBusy("delete");
            try {
              await deleteGoal(goalId);
              router.back();
            } catch {
              setBusy(null);
            }
          },
        },
      ]
    );
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.gold} />
      </View>
    );
  }

  if (error || !bundle) {
    return (
      <View style={styles.center}>
        <Muted>{error || "Goal not found."}</Muted>
      </View>
    );
  }

  const { goal, day, process, streak, endScenes, signs, trend, chats, health } = bundle;

  return (
    <View style={styles.safe}>
      <Stack.Screen options={{ title: goal.title }} />
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
      >
        {/* Native header shows the title; the page leads with the desire + meta. */}
        {!!goal.desire && <Muted style={styles.desire}>{goal.desire}</Muted>}
        <View style={styles.metaRow}>
          <Pill color={colors.gold}>
            Day {day} · {goal.status}
          </Pill>
          <StreakBadge streak={streak} />
        </View>

        <HealthBanner health={health} />

        <EndScene
          goalId={goal.id}
          scene={goal.end_scene}
          endScenes={endScenes}
          onRegenerated={reload}
        />

        <DailyProcess
          goalId={goal.id}
          day={day}
          process={process}
          onGenerated={reload}
        />

        {trend.length > 1 && (
          <Card>
            <SectionTitle color={colors.gold}>Felt-state trends</SectionTitle>
            <Muted style={styles.subtitle}>
              How your assumed state has moved over time.
            </Muted>
            <Trends points={trend} />
          </Card>
        )}

        <JourneyLog goalId={goal.id} initialEntries={[]} onChanged={reload} />

        <SignsTimeline signs={signs} />

        <Card>
          <SectionTitle color={colors.accent}>Ask the coach</SectionTitle>
          <CoachChat goalId={goal.id} initial={chats} />
        </Card>

        {/* Status controls */}
        <View style={styles.controls}>
          {goal.status !== "realised" && (
            <Button
              title="✦ Mark realised"
              onPress={() => changeStatus("realised")}
              loading={busy === "realised"}
              disabled={busy !== null}
              variant="primary"
            />
          )}
          {goal.status === "active" && (
            <Button
              title="Release"
              onPress={() => changeStatus("released")}
              loading={busy === "released"}
              disabled={busy !== null}
              variant="ghost"
            />
          )}
          <Button
            title="Delete"
            onPress={confirmDelete}
            loading={busy === "delete"}
            disabled={busy !== null}
            variant="danger"
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.base },
  center: {
    flex: 1,
    backgroundColor: colors.base,
    alignItems: "center",
    justifyContent: "center",
    padding: space.xl,
  },
  content: { padding: space.xl, paddingBottom: space.xxl },
  desire: { fontSize: font.sizes.md, marginBottom: space.md, lineHeight: 22 },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space.md,
    marginBottom: space.xl,
  },
  subtitle: { marginBottom: space.md },
  controls: { gap: space.md, marginTop: space.sm },
});
