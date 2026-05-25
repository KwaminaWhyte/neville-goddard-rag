import { StyleSheet, Text } from "react-native";
import type { Streak } from "../lib/types";
import { colors, font } from "../lib/theme";

export default function StreakBadge({ streak }: { streak: Streak }) {
  if (streak.current > 0) {
    return (
      <Text style={styles.text}>
        <Text style={styles.gold}>🔥 {streak.current}-day streak</Text>
        {streak.longest > streak.current ? (
          <Text style={styles.muted}> · best {streak.longest}</Text>
        ) : null}
      </Text>
    );
  }
  return <Text style={styles.muted}>Begin your streak — log today</Text>;
}

const styles = StyleSheet.create({
  text: { fontSize: font.sizes.sm },
  gold: { color: colors.gold, fontSize: font.sizes.sm, fontWeight: "600" },
  muted: { color: colors.muted, fontSize: font.sizes.sm },
});
