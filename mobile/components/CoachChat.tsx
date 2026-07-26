// Streaming coach chat — mirrors the web CoachChat. Lives inside a parent
// ScrollView + "Ask the coach" Card, so this renders no Card/ScrollView itself.
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, font, radius, space } from "../lib/theme";
import type { ChatMsg } from "../lib/types";
import { clearChat, streamCoach } from "../lib/api";
import { Button, Field } from "./ui";
import Markdown from "./Markdown";

export default function CoachChat({
  goalId,
  initial = [],
}: {
  goalId: number;
  initial?: ChatMsg[];
}) {
  const [messages, setMessages] = useState<ChatMsg[]>(initial);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;

    setMessages((prev) => [
      ...prev,
      { role: "user", content: text },
      { role: "assistant", content: "" },
    ]);
    setInput("");
    setBusy(true);

    let acc = "";
    try {
      for await (const tok of streamCoach(goalId, text)) {
        acc += tok;
        const next = acc;
        setMessages((prev) => {
          const copy = prev.slice();
          copy[copy.length - 1] = { role: "assistant", content: next };
          return copy;
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setMessages((prev) => {
        const copy = prev.slice();
        copy[copy.length - 1] = { role: "assistant", content: `[error: ${msg}]` };
        return copy;
      });
    } finally {
      setBusy(false);
    }
  }

  async function onClear() {
    try {
      await clearChat(goalId);
    } catch {
      // best-effort
    }
    setMessages([]);
  }

  return (
    <View>
      {messages.length > 0 && (
        <Pressable
          onPress={onClear}
          style={styles.clearWrap}
          hitSlop={8}
        >
          {({ pressed }) => (
            <Text style={[styles.clearText, pressed && styles.clearTextPressed]}>
              Clear chat
            </Text>
          )}
        </Pressable>
      )}

      {messages.length > 0 && (
        <View style={styles.list}>
          {messages.map((m, i) =>
            m.role === "user" ? (
              <View key={i} style={styles.userRow}>
                <Text style={styles.userText}>{m.content}</Text>
              </View>
            ) : (
              <View key={i} style={styles.assistantRow}>
                {m.content ? (
                  <Markdown compact>{m.content}</Markdown>
                ) : (
                  <Text style={styles.thinking}>…</Text>
                )}
              </View>
            )
          )}
        </View>
      )}

      <Field
        value={input}
        onChangeText={setInput}
        placeholder="e.g. How do I stop doubting between sessions?"
        editable={!busy}
        multiline
        onSubmitEditing={send}
        style={styles.field}
      />
      <View style={styles.actions}>
        <Button title="Ask" onPress={send} loading={busy} disabled={busy} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  clearWrap: { alignSelf: "flex-end", marginBottom: space.sm },
  clearText: { color: colors.muted, fontSize: font.sizes.xs },
  clearTextPressed: { color: colors.gold },
  list: { marginBottom: space.md },
  userRow: {
    alignSelf: "flex-end",
    maxWidth: "90%",
    backgroundColor: colors.panelAlt,
    borderColor: colors.line,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    marginBottom: space.md,
  },
  userText: { color: colors.gold, fontSize: font.sizes.sm, lineHeight: 22 },
  assistantRow: { alignSelf: "stretch", marginBottom: space.md },
  thinking: { color: colors.muted, fontSize: font.sizes.lg },
  field: { marginBottom: space.sm },
  actions: { alignItems: "flex-end" },
});
