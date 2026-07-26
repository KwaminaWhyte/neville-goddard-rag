// Semantic search over the user's OWN journal (neville_entries).
//
// Corpus retrieval (LightRAG) answers "what did Neville teach about this?".
// This answers "when did I feel this before?" — the tracker half of the app.
// Vectors live in neville_entry_embeddings, keyed by entry, tagged with the
// model + dim that produced them.
//
// The whole module is gated on migration MIGRATION_ENTRY_EMBEDDINGS, which is
// optional because it needs pgvector. Without it every function here returns
// "nothing found" and callers fall back to their pre-existing behaviour — a
// journal write, a page load, or a daily process must never fail because of it.
//
// Env:
//   EMBED_MODEL       journal embedder (see ollama.server.ts)
//   EMBED_TIMEOUT_MS  per-call embedding budget
import {
  MIGRATION_ENTRY_EMBEDDINGS,
  entriesMissingEmbedding,
  migrationApplied,
  searchEntriesSemantic,
  upsertEntryEmbedding,
  type Entry,
  type SemanticEntry,
} from "./db.server";
import { EMBED_MODEL, embed, embedBatch } from "./ollama.server";
import { bestEffort, log } from "./logger.server";

const SCOPE = "journal";

// Ollama is a single local process: one batched request at a time, never a fan-out.
const BATCH_SIZE = 8;
// Ceiling per backfill invocation, so a goal with hundreds of old entries is
// indexed over several visits instead of one very long request.
const BACKFILL_LIMIT = 32;
// Per-goal cooldown between backfill sweeps in this process.
const BACKFILL_COOLDOWN_MS = 60_000;
// Inline (on-write) embedding deadline. Much tighter than EMBED_TIMEOUT_MS: a
// user logging their day waits on this. If it blows, the entry simply stays in
// entriesMissingEmbedding and the next backfill picks it up.
const INLINE_DEADLINE_MS = 4_000;

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------
// Migrations run once per process, so a `true` answer can be cached forever. A
// `false` is re-checked: the first call can lose to a DB that is still starting.
let enabledCache: { value: boolean; at: number } | null = null;
const DISABLED_RECHECK_MS = 30_000;

export async function journalSearchEnabled(): Promise<boolean> {
  if (enabledCache?.value) return true;
  if (enabledCache && Date.now() - enabledCache.at < DISABLED_RECHECK_MS) return false;
  const value = await bestEffort(
    SCOPE,
    "checking entry-embeddings migration",
    migrationApplied(MIGRATION_ENTRY_EMBEDDINGS),
    false
  );
  enabledCache = { value, at: Date.now() };
  if (!value) {
    log.info(SCOPE, "semantic journal search unavailable", {
      migration: MIGRATION_ENTRY_EMBEDDINGS,
      reason: "pgvector migration not applied",
    });
  }
  return value;
}

export type JournalSearchStatus = { available: boolean; reason: string | null; model: string };

// For the UI: whether to offer semantic search, and why not if not.
export async function journalSearchStatus(): Promise<JournalSearchStatus> {
  const available = await journalSearchEnabled();
  return {
    available,
    reason: available ? null : "pgvector is unavailable on this database — install it and restart.",
    model: EMBED_MODEL,
  };
}

// ---------------------------------------------------------------------------
// What actually gets embedded
// ---------------------------------------------------------------------------
// The felt state ("doubtful", "resistant") is often the most searchable part of
// an entry, so it goes into the vector alongside the content rather than being
// left as a filterable column only.
function embeddableText(e: Pick<Entry, "kind" | "content" | "state">): string {
  const state = e.state?.trim();
  return `${e.kind}${state ? ` — felt ${state}` : ""}\n${e.content}`.slice(0, 4000);
}

// ---------------------------------------------------------------------------
// Write path
// ---------------------------------------------------------------------------
// Best-effort by construction: returns false instead of throwing, and is bounded
// by INLINE_DEADLINE_MS so a wedged or cold model cannot hold up a journal write.
export async function indexEntry(entry: Entry): Promise<boolean> {
  if (!entry?.id || !(await journalSearchEnabled())) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), INLINE_DEADLINE_MS);
  try {
    const vec = await embed(embeddableText(entry), { signal: ctrl.signal });
    await upsertEntryEmbedding(entry.id, entry.goal_id, EMBED_MODEL, vec);
    log.debug(SCOPE, "entry embedded", { entryId: entry.id, dim: vec.length, model: EMBED_MODEL });
    return true;
  } catch (e) {
    // Deliberately not fatal, and deliberately not silent. No entry text logged.
    log.warn(SCOPE, "embedding entry failed; deferring to backfill", {
      entryId: entry.id,
      goalId: entry.goal_id,
      model: EMBED_MODEL,
      error: (e as Error).message,
    });
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Edits change the vector, so an update is just a re-index (upsert on entry_id).
// Deletes need nothing: neville_entry_embeddings.entry_id is
// `REFERENCES neville_entries(id) ON DELETE CASCADE` (migration 7, confirmed
// against the live schema), so removing the entry removes its vector.
export const reindexEntry = indexEntry;

// ---------------------------------------------------------------------------
// Backfill
// ---------------------------------------------------------------------------
// Entries predating this feature — and any whose inline embed failed or whose
// EMBED_MODEL changed — are caught here. Triggered opportunistically rather than
// by a migration or a cron: there is no background worker in this app, and
// embedding hundreds of entries inside a page load is exactly what we must not
// do. So: fire-and-forget from the goal loaders (page never waits), awaited from
// the search path (results should not be visibly missing old entries), bounded
// to BACKFILL_LIMIT per sweep and one sweep per goal per BACKFILL_COOLDOWN_MS.
const inFlight = new Map<number, Promise<number>>();
const lastSweep = new Map<number, number>();

export function ensureIndexed(goalId: number, force = false): Promise<number> {
  if (!Number.isInteger(goalId)) return Promise.resolve(0);
  // Join an in-flight sweep instead of starting a duplicate one — this is what
  // makes "loader kicks it off, search awaits it" free of double work.
  const running = inFlight.get(goalId);
  if (running) return running;
  const last = lastSweep.get(goalId) ?? 0;
  if (!force && Date.now() - last < BACKFILL_COOLDOWN_MS) return Promise.resolve(0);
  const p = backfill(goalId).finally(() => {
    inFlight.delete(goalId);
    lastSweep.set(goalId, Date.now());
  });
  inFlight.set(goalId, p);
  return p;
}

// Never throws — returns how many entries it managed to embed.
async function backfill(goalId: number): Promise<number> {
  if (!(await journalSearchEnabled())) return 0;
  const pending = await bestEffort(
    SCOPE,
    "listing entries missing embeddings",
    entriesMissingEmbedding(goalId, EMBED_MODEL, BACKFILL_LIMIT),
    [] as Entry[]
  );
  if (!pending.length) return 0;
  let done = 0;
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const chunk = pending.slice(i, i + BATCH_SIZE);
    try {
      const vecs = await embedBatch(chunk.map(embeddableText));
      for (let j = 0; j < chunk.length; j++) {
        await upsertEntryEmbedding(chunk[j].id, chunk[j].goal_id, EMBED_MODEL, vecs[j]);
      }
      done += chunk.length;
    } catch (e) {
      // One bad batch (model missing, Ollama down) means the rest will fail too.
      log.warn(SCOPE, "backfill batch failed; stopping sweep", {
        goalId,
        embedded: done,
        remaining: pending.length - done,
        model: EMBED_MODEL,
        error: (e as Error).message,
      });
      break;
    }
  }
  if (done) {
    log.info(SCOPE, "backfilled journal embeddings", {
      goalId,
      embedded: done,
      model: EMBED_MODEL,
      // A full sweep means there may be more waiting for the next visit.
      maybeMore: pending.length === BACKFILL_LIMIT,
    });
  }
  return done;
}

// ---------------------------------------------------------------------------
// Read path
// ---------------------------------------------------------------------------
// Nearest past entries to `queryText`, by cosine distance. Returns [] when the
// feature is off, the query is empty, or anything at all goes wrong.
export async function relevantEntries(
  goalId: number,
  queryText: string,
  opts?: { limit?: number; kind?: string; excludeIds?: Iterable<number> }
): Promise<SemanticEntry[]> {
  const q = (queryText ?? "").trim();
  if (!Number.isInteger(goalId) || q.length < 2) return [];
  if (!(await journalSearchEnabled())) return [];
  const limit = Math.max(1, Math.min(50, opts?.limit ?? 5));
  const kind = opts?.kind?.trim();
  const exclude = new Set(opts?.excludeIds ?? []);
  // Over-fetch when we have to filter after the fact: kind isn't part of the
  // vector index, and excluded ids would otherwise eat into the limit.
  const slack = kind || exclude.size ? 4 : 1;
  try {
    const vec = await embed(q);
    const rows = await searchEntriesSemantic(goalId, vec, limit * slack);
    const hits = rows
      .filter((r) => !exclude.has(r.id))
      .filter((r) => !kind || r.kind === kind)
      .slice(0, limit);
    log.debug(SCOPE, "semantic journal search", { goalId, hits: hits.length, dim: vec.length });
    return hits;
  } catch (e) {
    log.warn(SCOPE, "semantic journal search failed", {
      goalId,
      model: EMBED_MODEL,
      error: (e as Error).message,
    });
    return [];
  }
}

// UI-facing search: top up the index first (joining any sweep the loader
// started), then rank. `available: false` tells the caller to fall back to the
// substring filter rather than show an empty log.
export async function searchJournalSemantic(
  goalId: number,
  queryText: string,
  opts?: { limit?: number; kind?: string }
): Promise<{ available: boolean; entries: SemanticEntry[] }> {
  if (!(await journalSearchEnabled())) return { available: false, entries: [] };
  await ensureIndexed(goalId);
  const entries = await relevantEntries(goalId, queryText, {
    limit: opts?.limit ?? 20,
    kind: opts?.kind,
  });
  return { available: true, entries };
}

// The daily process asks a different question than the user does: not "find this
// word" but "what in my history rhymes with where I am today?". So the probe is
// the desire plus the newest entry, and the recent slice the prompt already
// shows is excluded — repeating it would waste context and read as padding.
export async function relevantHistoryForProcess(args: {
  goalId: number;
  desire: string;
  recentIds?: number[];
  latestContent?: string;
  limit?: number;
}): Promise<SemanticEntry[]> {
  const probe = [args.desire, args.latestContent].filter(Boolean).join("\n").trim();
  return relevantEntries(args.goalId, probe, {
    limit: args.limit ?? 4,
    excludeIds: args.recentIds ?? [],
  });
}
