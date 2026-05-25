import { StyleSheet, Text, View } from "react-native";
import type { TrendPoint } from "../lib/types";
import { colors, font, radius, sentiment, space } from "../lib/theme";

const POSITIVE = [
  "assured", "confident", "calm", "peaceful", "joy", "grateful", "certain",
  "faith", "fulfilled", "natural", "knowing", "happy", "excited",
];
const NEGATIVE = [
  "doubt", "doubtful", "anxious", "fear", "afraid", "worried", "frustrated",
  "impatient", "lack", "struggling", "uncertain", "restless",
];

function score(state: string): -1 | 0 | 1 {
  const s = (state || "").toLowerCase();
  let pos = 0;
  let neg = 0;
  for (const w of POSITIVE) if (s.includes(w)) pos++;
  for (const w of NEGATIVE) if (s.includes(w)) neg++;
  if (pos > neg) return 1;
  if (neg > pos) return -1;
  return 0;
}

const TRACK = 56;
const HALF = TRACK / 2;

export default function Trends({ points }: { points: TrendPoint[] }) {
  if (points.length < 2) return null;

  const scores = points.map((p) => score(p.state));
  const positiveCount = scores.filter((s) => s === 1).length;
  const negativeCount = scores.filter((s) => s === -1).length;

  const mid = Math.floor(scores.length / 2);
  const firstHalf = scores.slice(0, mid);
  const secondHalf = scores.slice(mid);
  const avg = (arr: number[]) =>
    arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  const delta = avg(secondHalf) - avg(firstHalf);

  let summary = "steady";
  if (delta > 0.2) summary = "trending toward assurance";
  else if (delta < -0.2) summary = "more doubt lately";

  return (
    <View>
      <View style={styles.track}>
        {scores.map((s, i) => {
          if (s === 1) {
            return (
              <View key={i} style={styles.col}>
                <View style={styles.topHalf}>
                  <View style={[styles.barUp, { backgroundColor: sentiment.positive }]} />
                </View>
                <View style={styles.bottomHalf} />
              </View>
            );
          }
          if (s === -1) {
            return (
              <View key={i} style={styles.col}>
                <View style={styles.topHalf} />
                <View style={styles.bottomHalf}>
                  <View style={[styles.barDown, { backgroundColor: colors.dangerDim }]} />
                </View>
              </View>
            );
          }
          return (
            <View key={i} style={styles.col}>
              <View style={[styles.dot, { backgroundColor: sentiment.neutral }]} />
            </View>
          );
        })}
      </View>
      <Text style={styles.summary}>{summary}</Text>
      <Text style={styles.tally}>
        {points.length} entries · {positiveCount} assured · {negativeCount} doubtful
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    flexDirection: "row",
    alignItems: "center",
    height: TRACK,
    gap: 2,
  },
  col: {
    flex: 1,
    height: TRACK,
    justifyContent: "center",
    alignItems: "center",
  },
  topHalf: { height: HALF, width: "100%", justifyContent: "flex-end", alignItems: "center" },
  bottomHalf: { height: HALF, width: "100%", justifyContent: "flex-start", alignItems: "center" },
  barUp: { width: "70%", height: "85%", borderRadius: 2 },
  barDown: { width: "70%", height: "85%", borderRadius: 2 },
  dot: { width: 6, height: 6, borderRadius: radius.pill },
  summary: {
    color: colors.gold,
    fontFamily: font.serif,
    fontSize: font.sizes.md,
    marginTop: space.md,
  },
  tally: { color: colors.muted, fontSize: font.sizes.xs, marginTop: space.xs },
});
