// "Today's process" card — the day's personalized practice, composed from the
// end-scene, recent log, and Neville's teaching. Lets the user (re)generate it.
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { generateProcess } from "../lib/api";
import type { Process } from "../lib/types";
import { colors, space } from "../lib/theme";
import Markdown from "./Markdown";
import { Button, Card, Muted, SectionTitle } from "./ui";

export default function DailyProcess({
  goalId,
  day,
  process,
  onGenerated,
}: {
  goalId: number;
  day: number;
  process: Process | null;
  onGenerated?: () => void;
}) {
  const [loading, setLoading] = useState(false);

  async function generate() {
    setLoading(true);
    try {
      await generateProcess(goalId);
      onGenerated?.();
    } catch {
      // surfaced upstream via reload
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <View style={styles.header}>
        <SectionTitle color={colors.gold}>Today's process — Day {day}</SectionTitle>
        <Button
          title={loading ? "Drawing from the teaching…" : process ? "Regenerate" : "Generate"}
          onPress={generate}
          loading={loading}
          variant="outline"
          small
        />
      </View>

      {process ? (
        <Markdown>{process.content}</Markdown>
      ) : (
        <Muted>
          No process yet for today. Generate one — it is composed from your end-scene,
          your recent log, and Neville's teaching.
        </Muted>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: space.sm,
    gap: space.md,
  },
});
