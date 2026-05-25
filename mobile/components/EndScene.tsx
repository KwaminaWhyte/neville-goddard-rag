// "Live in the end" card — shows the current end-scene as italic prose, lets the
// user regenerate it, and reveals past versions under a collapsible toggle.
import { useState } from "react";
import { Image, Pressable, StyleSheet, Text, View } from "react-native";
import { regenerateEndScene } from "../lib/api";
import type { EndScene as EndSceneType } from "../lib/types";
import { colors, font, space } from "../lib/theme";
import { Button, Card, Muted, SectionTitle } from "./ui";

export default function EndScene({
  goalId,
  scene,
  endScenes,
  onRegenerated,
}: {
  goalId: number;
  scene: string | null;
  endScenes: EndSceneType[];
  onRegenerated?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [showPast, setShowPast] = useState(false);

  // endScenes is newest-first; the first IS the current scene.
  const past = endScenes.slice(1);

  async function regenerate() {
    setLoading(true);
    try {
      await regenerateEndScene(goalId);
      onRegenerated?.();
    } catch {
      // surfaced upstream via reload; keep the card stable on failure
    } finally {
      setLoading(false);
    }
  }

  return (
    <Card>
      <Image
        source={require("../assets/illustrations/endscene.png")}
        style={styles.banner}
        resizeMode="cover"
      />
      <View style={styles.header}>
        <SectionTitle color={colors.accent}>Live in the end</SectionTitle>
        <Button
          title="regenerate"
          onPress={regenerate}
          loading={loading}
          variant="outline"
          small
        />
      </View>

      {scene ? (
        <Text style={styles.scene}>{scene}</Text>
      ) : (
        <Muted>No end-scene yet. Regenerate to compose one.</Muted>
      )}

      <Muted style={styles.hint}>
        Replay this nightly in a drowsy state until it feels natural.
      </Muted>

      {past.length > 0 && (
        <View style={styles.pastWrap}>
          <Pressable onPress={() => setShowPast((s) => !s)}>
            <Text style={styles.toggle}>
              {showPast ? "▾" : "▸"} Past versions ({past.length})
            </Text>
          </Pressable>
          {showPast &&
            past.map((v) => (
              <View key={v.id} style={styles.pastItem}>
                <Muted style={styles.ts}>{formatTs(v.created_at)}</Muted>
                <Text style={styles.pastScene}>{v.scene}</Text>
              </View>
            ))}
        </View>
      )}
    </Card>
  );
}

function formatTs(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

const styles = StyleSheet.create({
  banner: {
    width: "100%",
    height: 120,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    marginBottom: space.md,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: space.sm,
  },
  scene: {
    color: "#e7e2fb",
    fontStyle: "italic",
    fontSize: font.sizes.md,
    lineHeight: 26,
  },
  hint: { marginTop: space.md },
  pastWrap: { marginTop: space.lg },
  toggle: {
    color: colors.accent,
    fontSize: font.sizes.sm,
    fontWeight: "600",
    marginBottom: space.sm,
  },
  pastItem: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: space.md,
    marginTop: space.sm,
  },
  ts: { fontSize: font.sizes.xs, marginBottom: space.xs },
  pastScene: {
    color: "#e7e2fb",
    fontStyle: "italic",
    fontSize: font.sizes.sm,
    lineHeight: 22,
  },
});
