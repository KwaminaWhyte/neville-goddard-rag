// Shared UI primitives — the mobile design system. Keep these stable; screens
// and feature components depend on these prop shapes.
import { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from "react-native";
import { colors, font, radius, space } from "../lib/theme";

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function SectionTitle({
  children,
  color = colors.gold,
}: {
  children: ReactNode;
  color?: string;
}) {
  return <Text style={[styles.sectionTitle, { color }]}>{children}</Text>;
}

export function Muted({ children, style }: { children: ReactNode; style?: object }) {
  return <Text style={[styles.muted, style]}>{children}</Text>;
}

export function Pill({ children, color = colors.muted }: { children: ReactNode; color?: string }) {
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <Text style={{ color, fontSize: font.sizes.xs, fontFamily: font.family.body }}>{children}</Text>
    </View>
  );
}

type ButtonProps = {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: "primary" | "outline" | "ghost" | "danger";
  small?: boolean;
};

export function Button({
  title,
  onPress,
  loading,
  disabled,
  variant = "primary",
  small,
}: ButtonProps) {
  const v = BTN[variant];
  const isOff = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={isOff}
      style={({ pressed }) => [
        styles.btn,
        small && styles.btnSmall,
        { backgroundColor: v.bg, borderColor: v.border },
        (pressed || isOff) && { opacity: 0.55 },
      ]}
    >
      {loading ? (
        <ActivityIndicator size="small" color={v.fg} />
      ) : (
        <Text style={{ color: v.fg, fontSize: small ? font.sizes.xs : font.sizes.sm, fontFamily: font.family.bodySemibold }}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

const BTN = {
  primary: { bg: colors.gold, border: colors.gold, fg: "#000" },
  outline: { bg: "transparent", border: colors.goldDim, fg: colors.gold },
  ghost: { bg: "transparent", border: colors.line, fg: colors.muted },
  danger: { bg: "transparent", border: colors.line, fg: colors.danger },
} as const;

export function Field(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={colors.muted}
      {...props}
      style={[styles.field, props.multiline && { minHeight: 64, textAlignVertical: "top" }, props.style]}
    />
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.panel,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.xl,
    marginBottom: space.xl,
  },
  sectionTitle: { fontFamily: font.serif, fontSize: font.sizes.lg, marginBottom: space.sm },
  muted: { color: colors.muted, fontSize: font.sizes.sm, fontFamily: font.family.body },
  pill: {
    borderWidth: 1,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
    alignSelf: "flex-start",
  },
  btn: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  btnSmall: { paddingHorizontal: space.md, paddingVertical: 6 },
  field: {
    color: colors.ink,
    backgroundColor: colors.base,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: 10,
    fontSize: font.sizes.sm,
    fontFamily: font.family.body,
  },
});
