// Profile: edit name + avatar, change password, sign out.
import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { Button, Card, Field, Muted, SectionTitle } from "../components/ui";
import { changePassword, updateProfile } from "../lib/api";
import { useAuth } from "../lib/auth";
import { colors, font, space } from "../lib/theme";

export default function Profile() {
  const router = useRouter();
  const { user, refresh, signOut } = useAuth();

  const [name, setName] = useState(user?.name ?? "");
  const [avatar, setAvatar] = useState(user?.avatar ?? "");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [signingOut, setSigningOut] = useState(false);

  const onSaveProfile = async () => {
    setProfileMsg(null);
    setSavingProfile(true);
    try {
      await updateProfile({
        name: name.trim(),
        avatar: avatar.trim(),
      });
      await refresh();
      setProfileMsg({ ok: true, text: "Profile saved." });
    } catch (e: any) {
      setProfileMsg({ ok: false, text: e?.message || "Could not save profile." });
    } finally {
      setSavingProfile(false);
    }
  };

  const onChangePassword = async () => {
    setPwMsg(null);
    if (next.length < 8) {
      setPwMsg({ ok: false, text: "New password must be at least 8 characters." });
      return;
    }
    if (next !== confirm) {
      setPwMsg({ ok: false, text: "New passwords do not match." });
      return;
    }
    setSavingPw(true);
    try {
      await changePassword(current, next);
      setCurrent("");
      setNext("");
      setConfirm("");
      setPwMsg({ ok: true, text: "Password changed." });
    } catch (e: any) {
      setPwMsg({ ok: false, text: e?.message || "Could not change password." });
    } finally {
      setSavingPw(false);
    }
  };

  const onSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      router.replace("/login");
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
    >
      <Card>
        <SectionTitle>Account</SectionTitle>
        <Muted style={styles.label}>Email</Muted>
        <Text style={styles.readonly}>{user?.email ?? "—"}</Text>

        <Muted style={styles.label}>Name</Muted>
        <Field
          placeholder="Your name"
          autoCapitalize="words"
          value={name}
          onChangeText={setName}
          style={styles.input}
        />

        <Muted style={styles.label}>Avatar URL</Muted>
        <Field
          placeholder="https://…"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          value={avatar}
          onChangeText={setAvatar}
          style={styles.input}
        />

        {profileMsg ? (
          <Text style={[styles.msg, { color: profileMsg.ok ? colors.gold : colors.danger }]}>
            {profileMsg.text}
          </Text>
        ) : null}

        <Button title="Save" onPress={onSaveProfile} loading={savingProfile} />
      </Card>

      <Card>
        <SectionTitle>Change password</SectionTitle>
        <Field
          placeholder="Current password"
          secureTextEntry
          value={current}
          onChangeText={setCurrent}
          style={styles.input}
        />
        <Field
          placeholder="New password (min 8)"
          secureTextEntry
          value={next}
          onChangeText={setNext}
          style={styles.input}
        />
        <Field
          placeholder="Confirm new password"
          secureTextEntry
          value={confirm}
          onChangeText={setConfirm}
          style={styles.input}
        />

        {pwMsg ? (
          <Text style={[styles.msg, { color: pwMsg.ok ? colors.gold : colors.danger }]}>
            {pwMsg.text}
          </Text>
        ) : null}

        <Button title="Update password" onPress={onChangePassword} loading={savingPw} variant="outline" />
      </Card>

      <View style={styles.signout}>
        <Button title="Sign out" onPress={onSignOut} loading={signingOut} variant="danger" />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.base },
  content: { padding: space.xl },
  label: { marginTop: space.md, marginBottom: space.xs },
  readonly: {
    color: colors.ink,
    fontSize: font.sizes.md,
    marginBottom: space.sm,
  },
  input: { marginBottom: space.sm },
  msg: { fontSize: font.sizes.sm, marginBottom: space.md },
  signout: { marginBottom: space.xxl },
});
