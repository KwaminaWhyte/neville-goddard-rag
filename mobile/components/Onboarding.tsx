// "How it works" primer shown on Home when the user has no desires yet.
import { Image, StyleSheet, Text, View } from "react-native";
import { colors, font, space } from "../lib/theme";
import { Card, Muted, SectionTitle } from "./ui";

const STEPS = [
  "Name a desire — the app composes a “living in the end” scene drawn from Neville’s corpus.",
  "Generate Today’s process each day — a state to assume, a SATS bedtime session, revision, mental-diet reminders, a sign to notice, and a concrete next step; every suggestion is cited to its source.",
  "Log sessions, felt states, and the signs you notice; a streak tracks your consistency.",
  "Ask the coach — it answers only from Neville’s teaching.",
  "Mark it realised when it comes to pass.",
];

export default function Onboarding() {
  return (
    <Card>
      <Image
        source={require("../assets/illustrations/hero.png")}
        style={styles.hero}
        resizeMode="cover"
      />
      <SectionTitle>How it works</SectionTitle>
      <Text style={styles.intro}>Assume the feeling of the wish fulfilled.</Text>

      <View style={styles.list}>
        {STEPS.map((step, i) => (
          <View key={i} style={styles.row}>
            <Text style={styles.num}>{i + 1}.</Text>
            <Text style={styles.step}>{step}</Text>
          </View>
        ))}
      </View>

      <Muted style={styles.tip}>
        A daily rhythm: read at night — SATS is a bedtime exercise — log in the
        morning, then generate a fresh process for the day.
      </Muted>
    </Card>
  );
}

const styles = StyleSheet.create({
  hero: {
    width: "100%",
    height: 160,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.line,
    marginBottom: space.md,
  },
  intro: {
    color: colors.ink,
    fontFamily: font.serif,
    fontSize: font.sizes.md,
    fontStyle: "italic",
    marginBottom: space.md,
  },
  list: { gap: space.sm },
  row: { flexDirection: "row", alignItems: "flex-start" },
  num: {
    color: colors.gold,
    fontSize: font.sizes.sm,
    fontWeight: "700",
    width: 22,
  },
  step: { color: colors.ink, fontSize: font.sizes.sm, flex: 1, lineHeight: 20 },
  tip: { marginTop: space.lg, lineHeight: 19 },
});
