import { useEffect, useState } from "react";
import { Alert, Image, Pressable, StyleSheet, Text, View } from "react-native";
import type { Entry } from "../lib/types";
import { ENTRY_KINDS } from "../lib/types";
import { addEntry, deleteEntry, listEntries, updateEntry } from "../lib/api";
import { Button, Card, Field, Muted, SectionTitle } from "./ui";
import { colors, font, radius, space } from "../lib/theme";

export default function JourneyLog({
  goalId,
  initialEntries,
  onChanged,
}: {
  goalId: number;
  initialEntries: Entry[];
  onChanged?: () => void;
}) {
  const [entries, setEntries] = useState<Entry[]>(initialEntries);
  const [error, setError] = useState<string | null>(null);

  // Add form
  const [kind, setKind] = useState<string>("checkin");
  const [state, setState] = useState("");
  const [content, setContent] = useState("");
  const [adding, setAdding] = useState(false);

  // Search / filter
  const [query, setQuery] = useState("");
  const [filterKind, setFilterKind] = useState<string>("");
  const [loading, setLoading] = useState(false);

  // Inline edit
  const [editId, setEditId] = useState<number | null>(null);
  const [editState, setEditState] = useState("");
  const [editContent, setEditContent] = useState("");
  const [savingEdit, setSavingEdit] = useState(false);

  const isFiltering = query.trim().length > 0 || filterKind !== "";

  async function reload(q = query, k = filterKind) {
    setLoading(true);
    setError(null);
    try {
      const fresh = await listEntries(goalId, q.trim(), k);
      setEntries(fresh);
    } catch (e: any) {
      setError(e?.message || "Could not load entries.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    reload("", "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goalId]);

  async function handleAdd() {
    if (!content.trim()) return;
    setAdding(true);
    setError(null);
    try {
      await addEntry(goalId, kind, content.trim(), state.trim() || undefined);
      setContent("");
      setState("");
      setKind("checkin");
      await reload(query, filterKind);
      onChanged?.();
    } catch (e: any) {
      setError(e?.message || "Could not log entry.");
    } finally {
      setAdding(false);
    }
  }

  function startEdit(entry: Entry) {
    setEditId(entry.id);
    setEditState(entry.state || "");
    setEditContent(entry.content);
  }

  function cancelEdit() {
    setEditId(null);
    setEditState("");
    setEditContent("");
  }

  async function saveEdit(entryId: number) {
    if (!editContent.trim()) return;
    setSavingEdit(true);
    setError(null);
    try {
      await updateEntry(goalId, entryId, editContent.trim(), editState.trim() || null);
      cancelEdit();
      await reload(query, filterKind);
      onChanged?.();
    } catch (e: any) {
      setError(e?.message || "Could not save entry.");
    } finally {
      setSavingEdit(false);
    }
  }

  function confirmDelete(entry: Entry) {
    Alert.alert("Delete entry", "Remove this entry from your journey log?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          setError(null);
          try {
            await deleteEntry(goalId, entry.id);
            await reload(query, filterKind);
            onChanged?.();
          } catch (e: any) {
            setError(e?.message || "Could not delete entry.");
          }
        },
      },
    ]);
  }

  function clearFilter() {
    setQuery("");
    setFilterKind("");
    reload("", "");
  }

  return (
    <Card>
      <SectionTitle>Journey log</SectionTitle>

      {/* Add form */}
      <View style={styles.section}>
        <View style={styles.kindRow}>
          {ENTRY_KINDS.map((k) => {
            const selected = kind === k.value;
            return (
              <Pressable
                key={k.value}
                onPress={() => setKind(k.value)}
                style={[styles.kindPill, selected && styles.kindPillOn]}
              >
                <Text style={[styles.kindPillText, selected && styles.kindPillTextOn]}>
                  {k.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Field
          placeholder="felt state (e.g. assured, doubtful)"
          value={state}
          onChangeText={setState}
          style={styles.gap}
        />
        <Field
          placeholder="What did you imagine, notice, or feel?"
          value={content}
          onChangeText={setContent}
          multiline
          style={styles.gap}
        />
        <View style={styles.gap}>
          <Button
            title={adding ? "Logging…" : "Log it"}
            onPress={handleAdd}
            loading={adding}
            disabled={!content.trim()}
          />
        </View>
      </View>

      {/* Search / filter */}
      <View style={styles.section}>
        <Field
          placeholder="search…"
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => reload(query, filterKind)}
          returnKeyType="search"
        />
        <View style={[styles.kindRow, styles.gap]}>
          <Pressable
            onPress={() => {
              setFilterKind("");
              reload(query, "");
            }}
            style={[styles.kindPill, filterKind === "" && styles.kindPillOn]}
          >
            <Text style={[styles.kindPillText, filterKind === "" && styles.kindPillTextOn]}>
              All
            </Text>
          </Pressable>
          {ENTRY_KINDS.map((k) => {
            const on = filterKind === k.value;
            return (
              <Pressable
                key={k.value}
                onPress={() => {
                  setFilterKind(k.value);
                  reload(query, k.value);
                }}
                style={[styles.kindPill, on && styles.kindPillOn]}
              >
                <Text style={[styles.kindPillText, on && styles.kindPillTextOn]}>
                  {k.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        {isFiltering ? (
          <View style={[styles.gap, styles.clearRow]}>
            <Button title="Clear" variant="ghost" small onPress={clearFilter} />
          </View>
        ) : null}
      </View>

      {error ? <Muted style={styles.error}>{error}</Muted> : null}

      {/* List */}
      {entries.length === 0 ? (
        <View style={styles.empty}>
          {!isFiltering && (
            <Image
              source={require("../assets/illustrations/empty.png")}
              style={styles.emptyImg}
              resizeMode="cover"
            />
          )}
          <Muted>{isFiltering ? "No entries match your filter." : "No entries yet."}</Muted>
        </View>
      ) : (
        entries.map((entry) => {
          const editing = editId === entry.id;
          return (
            <View key={entry.id} style={styles.entry}>
              <Text style={styles.header}>
                <Text style={styles.kindLabel}>{entry.kind.toUpperCase()}</Text>
                {entry.state ? <Text style={styles.metaText}> · {entry.state}</Text> : null}
                <Text style={styles.metaText}>
                  {" · "}
                  {new Date(entry.created_at).toLocaleString()}
                </Text>
              </Text>

              {editing ? (
                <View style={styles.gap}>
                  <Field
                    placeholder="felt state"
                    value={editState}
                    onChangeText={setEditState}
                  />
                  <Field
                    placeholder="content"
                    value={editContent}
                    onChangeText={setEditContent}
                    multiline
                    style={styles.gap}
                  />
                  <View style={[styles.actions, styles.gap]}>
                    <Button
                      title={savingEdit ? "Saving…" : "Save"}
                      small
                      onPress={() => saveEdit(entry.id)}
                      loading={savingEdit}
                      disabled={!editContent.trim()}
                    />
                    <Button title="Cancel" variant="ghost" small onPress={cancelEdit} />
                  </View>
                </View>
              ) : (
                <>
                  <Text style={styles.content}>{entry.content}</Text>
                  <View style={styles.actions}>
                    <Button title="edit" variant="ghost" small onPress={() => startEdit(entry)} />
                    <Button
                      title="delete"
                      variant="danger"
                      small
                      onPress={() => confirmDelete(entry)}
                    />
                  </View>
                </>
              )}
            </View>
          );
        })
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: space.lg },
  empty: { alignItems: "center", paddingVertical: space.md },
  emptyImg: {
    width: 120,
    height: 120,
    borderRadius: 14,
    opacity: 0.9,
    marginBottom: space.md,
  },
  gap: { marginTop: space.sm },
  kindRow: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  kindPill: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.pill,
    paddingHorizontal: space.md,
    paddingVertical: space.xs,
  },
  kindPillOn: { borderColor: colors.gold, backgroundColor: colors.panelAlt },
  kindPillText: { color: colors.muted, fontSize: font.sizes.xs },
  kindPillTextOn: { color: colors.gold },
  clearRow: { alignItems: "flex-start" },
  error: { color: colors.danger, marginBottom: space.md },
  entry: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: space.md,
    marginTop: space.md,
  },
  header: { fontSize: font.sizes.xs, marginBottom: space.xs },
  kindLabel: { color: colors.accent, fontSize: font.sizes.xs, fontWeight: "700" },
  metaText: { color: colors.muted, fontSize: font.sizes.xs },
  content: { color: "#ddd8ef", fontSize: font.sizes.sm, lineHeight: 20 },
  actions: { flexDirection: "row", gap: space.sm, marginTop: space.sm },
});
