// Create an account. On success the guard sends them home; we also replace("/").
import { useRouter } from "expo-router";
import { useState } from "react";
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Button, Field, Muted } from "../components/ui";
import { useAuth } from "../lib/auth";
import { colors, font, space } from "../lib/theme";

export default function Signup() {
  const router = useRouter();
  const { signUp } = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    setError(null);
    if (!email.trim()) {
      setError("Enter your email.");
      return;
    }
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      await signUp(email.trim(), password, name.trim() || undefined);
      router.replace("/");
    } catch (e: any) {
      setError(e?.message || "Could not create your account.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.inner}>
        <Image
          source={require("../assets/illustrations/auth.png")}
          style={styles.hero}
          resizeMode="cover"
        />
        <Text style={styles.title}>Begin your practice</Text>
        <Muted style={styles.sub}>Name your desire and assume the wish fulfilled.</Muted>

        <Field
          placeholder="Name (optional)"
          autoCapitalize="words"
          textContentType="name"
          value={name}
          onChangeText={setName}
          style={styles.field}
        />
        <Field
          placeholder="Email"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          textContentType="emailAddress"
          value={email}
          onChangeText={setEmail}
          style={styles.field}
        />
        <Field
          placeholder="Password (min 8 characters)"
          secureTextEntry
          textContentType="newPassword"
          value={password}
          onChangeText={setPassword}
          style={styles.field}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.field}>
          <Button title="Create" onPress={onSubmit} loading={busy} />
        </View>

        <Pressable onPress={() => router.replace("/login")} style={styles.link}>
          <Muted>
            Already practicing? <Text style={{ color: colors.gold }}>Welcome back</Text>
          </Muted>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.base },
  inner: { flex: 1, justifyContent: "center", padding: space.xl },
  hero: {
    width: "100%",
    height: 180,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    marginBottom: space.xl,
  },
  title: {
    color: colors.gold,
    fontFamily: font.serif,
    fontSize: font.sizes.xxl,
    marginBottom: space.xs,
  },
  sub: { marginBottom: space.xl },
  field: { marginBottom: space.md },
  error: { color: colors.danger, fontSize: font.sizes.sm, marginBottom: space.md },
  link: { marginTop: space.lg, alignItems: "center" },
});
