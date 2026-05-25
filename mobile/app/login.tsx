// Sign in. The auth guard sends authed users home; we also replace("/") on success.
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

export default function Login() {
  const router = useRouter();
  const { signIn } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async () => {
    setError(null);
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      router.replace("/");
    } catch (e: any) {
      setError(e?.message || "Could not sign in.");
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
        <Text style={styles.title}>Welcome back</Text>
        <Muted style={styles.sub}>Return to your practice.</Muted>

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
          placeholder="Password"
          secureTextEntry
          textContentType="password"
          value={password}
          onChangeText={setPassword}
          style={styles.field}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.field}>
          <Button title="Enter" onPress={onSubmit} loading={busy} />
        </View>

        <Pressable onPress={() => router.replace("/signup")} style={styles.link}>
          <Muted>
            New here? <Text style={{ color: colors.gold }}>Begin your practice</Text>
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
