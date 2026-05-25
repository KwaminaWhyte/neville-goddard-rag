import { StyleSheet, Text, View } from "react-native";
import type { Sign } from "../lib/types";
import { Card, Muted, SectionTitle } from "./ui";
import { colors, font, radius, space } from "../lib/theme";

export default function SignsTimeline({ signs }: { signs: Sign[] }) {
  if (!signs || signs.length === 0) return null;

  return (
    <Card>
      <SectionTitle>Signs noticed</SectionTitle>
      <Muted style={styles.subtitle}>
        Bridges of incident — the world rearranging toward your assumption.
      </Muted>
      <View style={styles.timeline}>
        {signs.map((sign, i) => {
          const last = i === signs.length - 1;
          return (
            <View key={sign.id} style={styles.row}>
              <View style={styles.gutter}>
                <View style={styles.dot} />
                {!last ? <View style={styles.line} /> : null}
              </View>
              <View style={styles.body}>
                <Text style={styles.meta}>
                  <Text style={styles.time}>
                    {new Date(sign.created_at).toLocaleString()}
                  </Text>
                  {sign.state ? (
                    <Text style={styles.state}> · felt {sign.state}</Text>
                  ) : null}
                </Text>
                <Text style={styles.content}>{sign.content}</Text>
              </View>
            </View>
          );
        })}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  subtitle: { marginBottom: space.lg },
  timeline: {},
  row: { flexDirection: "row" },
  gutter: { width: 20, alignItems: "center" },
  dot: {
    width: 10,
    height: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.gold,
    marginTop: 4,
    shadowColor: colors.gold,
    shadowOpacity: 0.8,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  line: {
    flex: 1,
    width: 1,
    backgroundColor: colors.line,
    marginTop: 2,
  },
  body: { flex: 1, paddingLeft: space.md, paddingBottom: space.lg },
  meta: { fontSize: font.sizes.xs, marginBottom: 2 },
  time: { color: colors.muted, fontSize: font.sizes.xs },
  state: { color: colors.accent, fontSize: font.sizes.xs },
  content: { color: "#e7e2fb", fontSize: font.sizes.sm, lineHeight: 20 },
});
