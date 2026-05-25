// Surfaces backend health problems (Ollama / LightRAG / index drift) as an
// amber warning card. Renders nothing when everything is healthy.
import { StyleSheet, Text, View } from "react-native";
import { font, radius, space } from "../lib/theme";
import type { Health } from "../lib/types";

export default function HealthBanner({ health }: { health?: Health }) {
  if (!health) return null;

  const issues: string[] = [];
  if (!health.ollama.ok) issues.push(`⚠ Ollama unreachable — ${health.ollama.detail}`);
  if (!health.lightrag.ok) issues.push(`⚠ LightRAG unreachable — ${health.lightrag.detail}`);
  if (!health.drift.ok) issues.push(`⚠ ${health.drift.message}`);

  if (issues.length === 0) return null;

  return (
    <View style={styles.banner}>
      {issues.map((msg, i) => (
        <Text key={i} style={[styles.text, i > 0 && { marginTop: space.xs }]}>
          {msg}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.4)",
    backgroundColor: "rgba(245,158,11,0.1)",
    borderRadius: radius.md,
    padding: space.md,
    marginBottom: space.xl,
  },
  text: { color: "#fcd34d", fontSize: font.sizes.sm },
});
