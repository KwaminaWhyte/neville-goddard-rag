// Postgres pool + tracker tables (goals / entries / processes).
// Shares the same Postgres as LightRAG but uses its own neville_* tables.
import "dotenv/config";
import pg from "pg";
import { getEmbeddingConfig } from "./lightrag.server";
import { log } from "./logger.server";

const { Pool } = pg;

const pool = new Pool({
  host: process.env.PG_HOST || "localhost",
  port: Number(process.env.PG_PORT || 5432),
  user: process.env.PG_USER || "rag",
  password: process.env.PG_PASSWORD || "rag",
  database: process.env.PG_DATABASE || "rag",
  max: 10,
});

// ---------------------------------------------------------------------------
// Migrations
// ---------------------------------------------------------------------------
// Versioned, ordered, recorded in `neville_migrations`. Migrations 1–2 reproduce
// the original idempotent bootstrap blob, so an existing database converges on
// the same schema and simply records the versions as applied.
//
// `optional: true` marks a migration that may legitimately fail on a given box
// (e.g. pgvector absent). It is logged and left unrecorded — the feature that
// needs it degrades, the app still boots.
type Migration = { version: number; name: string; sql: string; optional?: boolean };

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "core_tracker_tables",
    sql: `
      CREATE TABLE IF NOT EXISTS neville_goals (
        id          SERIAL PRIMARY KEY,
        title       TEXT NOT NULL,
        desire      TEXT NOT NULL,
        end_scene   TEXT,
        status      TEXT NOT NULL DEFAULT 'active',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
        realised_at TIMESTAMPTZ
      );
      CREATE TABLE IF NOT EXISTS neville_entries (
        id         SERIAL PRIMARY KEY,
        goal_id    INTEGER NOT NULL REFERENCES neville_goals(id) ON DELETE CASCADE,
        kind       TEXT NOT NULL,
        content    TEXT NOT NULL,
        state      TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_neville_entries_goal ON neville_entries(goal_id);
      CREATE TABLE IF NOT EXISTS neville_processes (
        id         SERIAL PRIMARY KEY,
        goal_id    INTEGER NOT NULL REFERENCES neville_goals(id) ON DELETE CASCADE,
        day        INTEGER NOT NULL,
        content    TEXT NOT NULL,
        sources    JSONB,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_neville_processes_goal ON neville_processes(goal_id);
      CREATE TABLE IF NOT EXISTS neville_end_scenes (
        id         SERIAL PRIMARY KEY,
        goal_id    INTEGER NOT NULL REFERENCES neville_goals(id) ON DELETE CASCADE,
        scene      TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_neville_end_scenes_goal ON neville_end_scenes(goal_id);
      CREATE TABLE IF NOT EXISTS neville_index_meta (
        id          INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        embed_model TEXT,
        embed_dim   INTEGER,
        recorded_at TIMESTAMPTZ DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS neville_chats (
        id         SERIAL PRIMARY KEY,
        goal_id    INTEGER NOT NULL REFERENCES neville_goals(id) ON DELETE CASCADE,
        role       TEXT NOT NULL,
        content    TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_neville_chats_goal ON neville_chats(goal_id);
      CREATE TABLE IF NOT EXISTS neville_users (
        id            SERIAL PRIMARY KEY,
        email         TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        name          TEXT,
        avatar        TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS neville_sessions (
        token      TEXT PRIMARY KEY,
        user_id    INTEGER NOT NULL REFERENCES neville_users(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        expires_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_neville_sessions_user ON neville_sessions(user_id);
    `,
  },
  {
    version: 2,
    name: "goal_user_scoping",
    sql: `
      ALTER TABLE neville_goals ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES neville_users(id) ON DELETE CASCADE;
      CREATE INDEX IF NOT EXISTS idx_neville_goals_user ON neville_goals(user_id);
    `,
  },
  {
    version: 3,
    name: "user_timezone",
    sql: `
      ALTER TABLE neville_users ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';
    `,
  },
  {
    version: 4,
    name: "login_attempts",
    sql: `
      CREATE TABLE IF NOT EXISTS neville_login_attempts (
        id         BIGSERIAL PRIMARY KEY,
        email      TEXT,
        ip         TEXT,
        ok         BOOLEAN NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_neville_login_attempts_email
        ON neville_login_attempts (lower(email), created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_neville_login_attempts_ip
        ON neville_login_attempts (ip, created_at DESC);
    `,
  },
  {
    version: 5,
    name: "session_expiry_index",
    sql: `
      CREATE INDEX IF NOT EXISTS idx_neville_sessions_expires ON neville_sessions(expires_at);
    `,
  },
  {
    version: 6,
    name: "retrieval_cache",
    sql: `
      CREATE TABLE IF NOT EXISTS neville_retrieval_cache (
        key        TEXT PRIMARY KEY,
        query      TEXT NOT NULL,
        mode       TEXT NOT NULL,
        text       TEXT NOT NULL,
        sources    JSONB,
        hits       INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_neville_retrieval_cache_created
        ON neville_retrieval_cache(created_at);
    `,
  },
  {
    version: 7,
    name: "entry_embeddings",
    optional: true, // needs pgvector; journal semantic search degrades without it
    sql: `
      CREATE EXTENSION IF NOT EXISTS vector;
      CREATE TABLE IF NOT EXISTS neville_entry_embeddings (
        entry_id   INTEGER PRIMARY KEY REFERENCES neville_entries(id) ON DELETE CASCADE,
        goal_id    INTEGER NOT NULL REFERENCES neville_goals(id) ON DELETE CASCADE,
        model      TEXT NOT NULL,
        dim        INTEGER NOT NULL,
        embedding  vector NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_neville_entry_embeddings_goal
        ON neville_entry_embeddings(goal_id);
    `,
  },
];

// Arbitrary but stable key so two app processes can't migrate concurrently.
const MIGRATION_LOCK = 0x6e65_7631;

let migrated: Promise<void> | null = null;

async function runMigrations(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS neville_migrations (
        version    INTEGER PRIMARY KEY,
        name       TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    try {
      const res = await client.query<{ version: number }>(
        "SELECT version FROM neville_migrations"
      );
      const applied = new Set(res.rows.map((r) => Number(r.version)));
      for (const m of MIGRATIONS) {
        if (applied.has(m.version)) continue;
        try {
          await client.query("BEGIN");
          await client.query(m.sql);
          await client.query("INSERT INTO neville_migrations (version, name) VALUES ($1,$2)", [
            m.version,
            m.name,
          ]);
          await client.query("COMMIT");
          log.info("db", "migration applied", { version: m.version, name: m.name });
        } catch (e) {
          await client.query("ROLLBACK").catch(() => {});
          if (m.optional) {
            log.warn("db", "optional migration skipped", {
              version: m.version,
              name: m.name,
              error: (e as Error).message,
            });
            continue;
          }
          throw e;
        }
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]).catch(() => {});
    }
  } finally {
    client.release();
  }
}

function ensureMigrated(): Promise<void> {
  if (migrated) return migrated;
  migrated = runMigrations().catch((e) => {
    // Reset so the next request retries rather than caching a permanent failure.
    migrated = null;
    log.error("db", "migrations failed", { error: (e as Error).message });
    throw e;
  });
  return migrated;
}

// Which optional migrations actually landed — lets features self-disable.
export async function migrationApplied(version: number): Promise<boolean> {
  try {
    const r = await query<{ n: string }>(
      "SELECT count(*)::text AS n FROM neville_migrations WHERE version = $1",
      [version]
    );
    return Number(r[0]?.n ?? 0) > 0;
  } catch (e) {
    // Callers use this to self-disable a feature; a DB hiccup should read as
    // "not available" rather than throw, but it must still be visible.
    log.warn("db", "migrationApplied check failed", { version, error: (e as Error).message });
    return false;
  }
}

export const MIGRATION_ENTRY_EMBEDDINGS = 7;

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  await ensureMigrated();
  const res = await pool.query<T>(text, params as never);
  return res.rows;
}

export type Goal = {
  id: number;
  title: string;
  desire: string;
  end_scene: string | null;
  status: string;
  created_at: string;
  realised_at: string | null;
};

export type Entry = {
  id: number;
  goal_id: number;
  kind: string;
  content: string;
  state: string | null;
  created_at: string;
};

export type Process = {
  id: number;
  goal_id: number;
  day: number;
  content: string;
  sources: string[] | null;
  created_at: string;
};

export async function listGoals(userId: number): Promise<Goal[]> {
  return query<Goal>(
    "SELECT * FROM neville_goals WHERE user_id = $1 ORDER BY (status='active') DESC, created_at DESC",
    [userId]
  );
}

export async function getGoal(id: number, userId: number): Promise<Goal | undefined> {
  if (!Number.isInteger(id)) return undefined;
  const r = await query<Goal>("SELECT * FROM neville_goals WHERE id = $1 AND user_id = $2", [
    id,
    userId,
  ]);
  return r[0];
}

export async function createGoal(
  userId: number,
  title: string,
  desire: string,
  endScene: string
): Promise<Goal> {
  const r = await query<Goal>(
    "INSERT INTO neville_goals (user_id, title, desire, end_scene) VALUES ($1,$2,$3,$4) RETURNING *",
    [userId, title, desire, endScene]
  );
  return r[0];
}

// Lets the first registered account adopt any pre-auth (orphan) goals.
export async function claimOrphanGoals(userId: number): Promise<void> {
  await query("UPDATE neville_goals SET user_id = $1 WHERE user_id IS NULL", [userId]);
}

// userId is required for defence in depth: routes already check ownership, but a
// mutation should never be expressible without the owner.
export async function setGoalStatus(id: number, userId: number, status: string): Promise<void> {
  await query(
    `UPDATE neville_goals
        SET status=$3, realised_at = CASE WHEN $3='realised' THEN now() ELSE NULL END
      WHERE id=$1 AND user_id=$2`,
    [id, userId, status]
  );
}

export async function deleteGoal(id: number, userId: number): Promise<void> {
  await query("DELETE FROM neville_goals WHERE id = $1 AND user_id = $2", [id, userId]);
}

// id here is the goal id — versions the scene and repoints the goal's current scene.
export async function updateEndSceneNote(id: number, scene: string): Promise<void> {
  await addEndScene(id, scene);
}

export type EndScene = { id: number; goal_id: number; scene: string; created_at: string };

export async function listEndScenes(goalId: number): Promise<EndScene[]> {
  return query<EndScene>(
    "SELECT * FROM neville_end_scenes WHERE goal_id = $1 ORDER BY created_at DESC, id DESC",
    [goalId]
  );
}

// Insert a scene version AND repoint neville_goals.end_scene to it (current pointer).
export async function addEndScene(goalId: number, scene: string): Promise<EndScene> {
  const r = await query<EndScene>(
    "INSERT INTO neville_end_scenes (goal_id, scene) VALUES ($1,$2) RETURNING *",
    [goalId, scene]
  );
  await query("UPDATE neville_goals SET end_scene = $1 WHERE id = $2", [scene, goalId]);
  return r[0];
}

export type Sign = { id: number; content: string; state: string | null; created_at: string };

export async function listSigns(goalId: number): Promise<Sign[]> {
  return query<Sign>(
    "SELECT id, content, state, created_at FROM neville_entries WHERE goal_id = $1 AND kind = 'sign' ORDER BY created_at DESC",
    [goalId]
  );
}

// ---------------------------------------------------------------------------
// Timezone-aware calendar-day math
// ---------------------------------------------------------------------------
// The day counter and the streak MUST bucket days identically, or Day N and the
// streak disagree for anyone not sitting at UTC+0. Both go through the user's
// timezone: JS side via Intl, SQL side via `AT TIME ZONE`.
export const DEFAULT_TZ = "UTC";

export function isValidTimezone(tz: string): boolean {
  if (!tz || typeof tz !== "string") return false;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

// "YYYY-MM-DD" for an instant, as seen in `tz`. Falls back to UTC on bad input.
export function ymdInTz(d: Date, tz: string = DEFAULT_TZ): string {
  const zone = isValidTimezone(tz) ? tz : DEFAULT_TZ;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

// Days since the epoch for a "YYYY-MM-DD" string — safe integer day arithmetic.
export function ymdToEpochDay(ymd: string): number {
  const [y, m, d] = ymd.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

export function dayNumber(goal: Goal, tz: string = DEFAULT_TZ): number {
  const start = ymdToEpochDay(ymdInTz(new Date(goal.created_at), tz));
  const today = ymdToEpochDay(ymdInTz(new Date(), tz));
  return Math.max(1, today - start + 1);
}

export async function getUserTimezone(userId: number): Promise<string> {
  try {
    const r = await query<{ timezone: string | null }>(
      "SELECT timezone FROM neville_users WHERE id = $1",
      [userId]
    );
    const tz = r[0]?.timezone;
    return tz && isValidTimezone(tz) ? tz : DEFAULT_TZ;
  } catch (e) {
    log.warn("db", "getUserTimezone failed, defaulting to UTC", {
      userId,
      error: (e as Error).message,
    });
    return DEFAULT_TZ;
  }
}

export async function setUserTimezone(userId: number, tz: string): Promise<boolean> {
  if (!isValidTimezone(tz)) return false;
  await query("UPDATE neville_users SET timezone = $2 WHERE id = $1", [userId, tz]);
  return true;
}

// Consecutive-day streak from distinct calendar days of entries, in `tz`.
export async function getStreak(
  goalId: number,
  tz: string = DEFAULT_TZ
): Promise<{ current: number; longest: number; lastEntryDate: string | null }> {
  const zone = isValidTimezone(tz) ? tz : DEFAULT_TZ;
  const rows = await query<{ d: string }>(
    `SELECT DISTINCT to_char(created_at AT TIME ZONE $2, 'YYYY-MM-DD') AS d
       FROM neville_entries WHERE goal_id = $1 ORDER BY d`,
    [goalId, zone]
  );
  return computeStreak(
    rows.map((r) => r.d),
    ymdInTz(new Date(), zone)
  );
}

// Pure, so it is directly testable: day strings (ascending) + today's day string.
export function computeStreak(
  days: string[],
  todayYmd: string
): { current: number; longest: number; lastEntryDate: string | null } {
  if (!days.length) return { current: 0, longest: 0, lastEntryDate: null };
  const lastEntryDate = days[days.length - 1];
  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    if (ymdToEpochDay(days[i]) - ymdToEpochDay(days[i - 1]) === 1) run++;
    else run = 1;
    if (run > longest) longest = run;
  }
  // The current run only counts if it reaches today or yesterday.
  const todayNum = ymdToEpochDay(todayYmd);
  const lastNum = ymdToEpochDay(lastEntryDate);
  let current = 0;
  if (todayNum - lastNum >= 0 && todayNum - lastNum <= 1) {
    current = 1;
    for (let i = days.length - 1; i > 0; i--) {
      if (ymdToEpochDay(days[i]) - ymdToEpochDay(days[i - 1]) === 1) current++;
      else break;
    }
  }
  return { current, longest, lastEntryDate };
}

// Compare LightRAG's live embedding config against the stored one. Never throws.
export async function checkEmbeddingDrift(): Promise<{ ok: boolean; message: string | null }> {
  try {
    const cur = await getEmbeddingConfig();
    if (cur.model == null && cur.dim == null) return { ok: true, message: null };
    const stored = (
      await query<{ embed_model: string | null; embed_dim: number | null }>(
        "SELECT embed_model, embed_dim FROM neville_index_meta WHERE id = 1"
      )
    )[0];
    if (!stored) {
      await query(
        "INSERT INTO neville_index_meta (id, embed_model, embed_dim) VALUES (1,$1,$2) ON CONFLICT (id) DO UPDATE SET embed_model = $1, embed_dim = $2, recorded_at = now()",
        [cur.model, cur.dim]
      );
      return { ok: true, message: null };
    }
    if (stored.embed_model !== cur.model || Number(stored.embed_dim) !== Number(cur.dim)) {
      const oldStr = `${stored.embed_model}/${stored.embed_dim}`;
      const newStr = `${cur.model}/${cur.dim}`;
      return {
        ok: false,
        message: `Embedding config changed (was ${oldStr} → now ${newStr}) — retrieval may be corrupt; re-index.`,
      };
    }
    return { ok: true, message: null };
  } catch (e) {
    log.warn("db", "embedding drift check failed", { error: (e as Error).message });
    return { ok: true, message: null };
  }
}

export async function listEntries(goalId: number): Promise<Entry[]> {
  return query<Entry>(
    "SELECT * FROM neville_entries WHERE goal_id = $1 ORDER BY created_at DESC",
    [goalId]
  );
}

export async function addEntry(
  goalId: number,
  kind: string,
  content: string,
  state?: string
): Promise<Entry> {
  const r = await query<Entry>(
    "INSERT INTO neville_entries (goal_id, kind, content, state) VALUES ($1,$2,$3,$4) RETURNING *",
    [goalId, kind, content, state ?? null]
  );
  return r[0];
}

export async function getProcess(goalId: number, day: number): Promise<Process | undefined> {
  const r = await query<Process>(
    "SELECT * FROM neville_processes WHERE goal_id=$1 AND day=$2 ORDER BY created_at DESC LIMIT 1",
    [goalId, day]
  );
  return r[0];
}

export async function saveProcess(
  goalId: number,
  day: number,
  content: string,
  sources: string[]
): Promise<Process> {
  const r = await query<Process>(
    "INSERT INTO neville_processes (goal_id, day, content, sources) VALUES ($1,$2,$3,$4) RETURNING *",
    [goalId, day, content, JSON.stringify(sources)]
  );
  return r[0];
}

// --- Entry / sign CRUD ---
// Entries and signs share neville_entries (signs are kind='sign'). goalId guards
// so a stray id can't touch another goal's row.
export async function updateEntry(
  goalId: number,
  entryId: number,
  content: string,
  state?: string | null
): Promise<Entry | undefined> {
  const r = await query<Entry>(
    "UPDATE neville_entries SET content=$1, state=COALESCE($2, state) WHERE id=$3 AND goal_id=$4 RETURNING *",
    [content, state ?? null, entryId, goalId]
  );
  return r[0];
}

export async function deleteEntry(goalId: number, entryId: number): Promise<void> {
  await query("DELETE FROM neville_entries WHERE id=$1 AND goal_id=$2", [entryId, goalId]);
}

// --- Felt-state trends ---
// One point per entry that carries a `state`, oldest→newest, for charting.
export type TrendPoint = { date: string; state: string; kind: string };
export async function feltStateTrend(goalId: number): Promise<TrendPoint[]> {
  return query<TrendPoint>(
    `SELECT to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS') AS date, state, kind
       FROM neville_entries
      WHERE goal_id=$1 AND state IS NOT NULL AND state <> ''
      ORDER BY created_at ASC`,
    [goalId]
  );
}

// --- Search / filter ---
// Case-insensitive substring filter over a goal's entries. kind optional.
export async function searchEntries(
  goalId: number,
  q?: string,
  kind?: string
): Promise<Entry[]> {
  const where = ["goal_id = $1"];
  const params: unknown[] = [goalId];
  if (q && q.trim()) {
    params.push(`%${q.trim()}%`);
    where.push(`content ILIKE $${params.length}`);
  }
  if (kind && kind.trim()) {
    params.push(kind.trim());
    where.push(`kind = $${params.length}`);
  }
  return query<Entry>(
    `SELECT * FROM neville_entries WHERE ${where.join(" AND ")} ORDER BY created_at DESC`,
    params
  );
}

export async function searchProcesses(goalId: number, q?: string): Promise<Process[]> {
  const where = ["goal_id = $1"];
  const params: unknown[] = [goalId];
  if (q && q.trim()) {
    params.push(`%${q.trim()}%`);
    where.push(`content ILIKE $${params.length}`);
  }
  return query<Process>(
    `SELECT * FROM neville_processes WHERE ${where.join(" AND ")} ORDER BY day DESC, created_at DESC`,
    params
  );
}

// --- Coach chat history persistence ---
export type Chat = { id: number; goal_id: number; role: string; content: string; created_at: string };

export async function listChats(goalId: number): Promise<Chat[]> {
  return query<Chat>(
    "SELECT * FROM neville_chats WHERE goal_id=$1 ORDER BY created_at ASC, id ASC",
    [goalId]
  );
}

// Most recent `limit` turns, returned oldest→newest. This is what the coach is
// allowed to see — the client never supplies its own history.
export async function recentChats(goalId: number, limit = 20): Promise<Chat[]> {
  const rows = await query<Chat>(
    "SELECT * FROM neville_chats WHERE goal_id=$1 ORDER BY created_at DESC, id DESC LIMIT $2",
    [goalId, limit]
  );
  return rows.reverse();
}

export async function addChat(goalId: number, role: string, content: string): Promise<Chat> {
  const r = await query<Chat>(
    "INSERT INTO neville_chats (goal_id, role, content) VALUES ($1,$2,$3) RETURNING *",
    [goalId, role, content]
  );
  return r[0];
}

export async function clearChats(goalId: number): Promise<void> {
  await query("DELETE FROM neville_chats WHERE goal_id=$1", [goalId]);
}

// ---------------------------------------------------------------------------
// Session hygiene
// ---------------------------------------------------------------------------
export async function pruneExpiredSessions(): Promise<number> {
  const r = await query<{ n: string }>(
    "WITH d AS (DELETE FROM neville_sessions WHERE expires_at <= now() RETURNING 1) SELECT count(*)::text AS n FROM d"
  );
  return Number(r[0]?.n ?? 0);
}

// Revoke every session for a user, optionally sparing the caller's own token.
export async function deleteUserSessions(userId: number, keepToken?: string): Promise<number> {
  const r = keepToken
    ? await query<{ n: string }>(
        "WITH d AS (DELETE FROM neville_sessions WHERE user_id = $1 AND token <> $2 RETURNING 1) SELECT count(*)::text AS n FROM d",
        [userId, keepToken]
      )
    : await query<{ n: string }>(
        "WITH d AS (DELETE FROM neville_sessions WHERE user_id = $1 RETURNING 1) SELECT count(*)::text AS n FROM d",
        [userId]
      );
  return Number(r[0]?.n ?? 0);
}

// ---------------------------------------------------------------------------
// Login throttling
// ---------------------------------------------------------------------------
const LOGIN_WINDOW_MIN = 15;
const LOGIN_FREE_ATTEMPTS = 5;
const LOGIN_MAX_BACKOFF_SEC = 900;

export async function recordLoginAttempt(
  email: string,
  ip: string | null,
  ok: boolean
): Promise<void> {
  await query("INSERT INTO neville_login_attempts (email, ip, ok) VALUES ($1,$2,$3)", [
    email || null,
    ip,
    ok,
  ]);
}

export async function clearLoginAttempts(email: string, ip: string | null): Promise<void> {
  // $2 needs an explicit cast: Postgres cannot infer a bind parameter's type
  // from `$2 IS NOT NULL` alone and errors out with
  // "could not determine data type of parameter $2".
  await query(
    "DELETE FROM neville_login_attempts WHERE ok = false AND (lower(email) = lower($1::text) OR ($2::text IS NOT NULL AND ip = $2::text))",
    [email, ip]
  );
}

// Exponential backoff after LOGIN_FREE_ATTEMPTS failures inside the window,
// counted per-email OR per-IP (whichever is worse) so neither axis is a bypass.
export function backoffSeconds(failures: number): number {
  if (failures <= LOGIN_FREE_ATTEMPTS) return 0;
  const over = failures - LOGIN_FREE_ATTEMPTS;
  return Math.min(LOGIN_MAX_BACKOFF_SEC, 5 * 2 ** (over - 1));
}

export async function loginBackoff(
  email: string,
  ip: string | null
): Promise<{ blocked: boolean; retryAfterSec: number; failures: number }> {
  try {
    const r = await query<{ failures: string; last: string | null }>(
      // $2 needs an explicit cast — see clearLoginAttempts.
      `SELECT count(*)::text AS failures, max(created_at)::text AS last
         FROM neville_login_attempts
        WHERE ok = false
          AND created_at > now() - ($3 || ' minutes')::interval
          AND (lower(email) = lower($1::text) OR ($2::text IS NOT NULL AND ip = $2::text))`,
      [email, ip, String(LOGIN_WINDOW_MIN)]
    );
    const failures = Number(r[0]?.failures ?? 0);
    const penalty = backoffSeconds(failures);
    if (!penalty || !r[0]?.last) return { blocked: false, retryAfterSec: 0, failures };
    const elapsed = (Date.now() - new Date(r[0].last).getTime()) / 1000;
    const remaining = Math.ceil(penalty - elapsed);
    return remaining > 0
      ? { blocked: true, retryAfterSec: remaining, failures }
      : { blocked: false, retryAfterSec: 0, failures };
  } catch (e) {
    // Fail open rather than locking everyone out of a local app on a DB hiccup.
    log.warn("db", "login backoff check failed", { error: (e as Error).message });
    return { blocked: false, retryAfterSec: 0, failures: 0 };
  }
}

// ---------------------------------------------------------------------------
// Retrieval cache
// ---------------------------------------------------------------------------
export type CachedRetrieval = { text: string; sources: unknown };

export async function getCachedRetrieval(
  key: string,
  maxAgeSec: number
): Promise<CachedRetrieval | undefined> {
  const r = await query<{ text: string; sources: unknown }>(
    `UPDATE neville_retrieval_cache SET hits = hits + 1
       WHERE key = $1 AND created_at > now() - ($2 || ' seconds')::interval
       RETURNING text, sources`,
    [key, String(Math.max(1, Math.floor(maxAgeSec)))]
  );
  return r[0];
}

export async function putCachedRetrieval(
  key: string,
  queryText: string,
  mode: string,
  text: string,
  sources: unknown
): Promise<void> {
  await query(
    `INSERT INTO neville_retrieval_cache (key, query, mode, text, sources)
       VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (key) DO UPDATE
       SET text = EXCLUDED.text, sources = EXCLUDED.sources,
           created_at = now(), hits = 0`,
    [key, queryText, mode, text, JSON.stringify(sources ?? null)]
  );
}

export async function pruneRetrievalCache(maxAgeSec: number): Promise<number> {
  const r = await query<{ n: string }>(
    `WITH d AS (
       DELETE FROM neville_retrieval_cache
        WHERE created_at <= now() - ($1 || ' seconds')::interval RETURNING 1
     ) SELECT count(*)::text AS n FROM d`,
    [String(Math.max(1, Math.floor(maxAgeSec)))]
  );
  return Number(r[0]?.n ?? 0);
}

// ---------------------------------------------------------------------------
// Journal embeddings (semantic search over the user's own entries)
// ---------------------------------------------------------------------------
// pgvector literal form: "[0.1,0.2,...]".
// Validates rather than formatting blindly: a NaN/Infinity slipping in from a
// half-failed embedding call would otherwise only surface as a Postgres cast
// error at write time, and the `number[]` signature is not enforced at runtime.
// Callers bind this as `$n::vector`, so this is about data integrity, not
// injection — but rejecting garbage here beats storing or attempting it.
export function toVectorLiteral(embedding: number[]): string {
  const bad = embedding.findIndex((v) => typeof v !== "number" || !Number.isFinite(v));
  if (bad !== -1) {
    throw new Error(`embedding contains a non-finite value at index ${bad}`);
  }
  return `[${embedding.join(",")}]`;
}

export async function upsertEntryEmbedding(
  entryId: number,
  goalId: number,
  model: string,
  embedding: number[]
): Promise<void> {
  await query(
    `INSERT INTO neville_entry_embeddings (entry_id, goal_id, model, dim, embedding)
       VALUES ($1,$2,$3,$4,$5::vector)
     ON CONFLICT (entry_id) DO UPDATE
       SET goal_id = EXCLUDED.goal_id, model = EXCLUDED.model,
           dim = EXCLUDED.dim, embedding = EXCLUDED.embedding, created_at = now()`,
    [entryId, goalId, model, embedding.length, toVectorLiteral(embedding)]
  );
}

// Entries for a goal that have no embedding yet (or whose model changed).
export async function entriesMissingEmbedding(
  goalId: number,
  model: string,
  limit = 200
): Promise<Entry[]> {
  return query<Entry>(
    `SELECT e.* FROM neville_entries e
       LEFT JOIN neville_entry_embeddings em ON em.entry_id = e.id
      WHERE e.goal_id = $1 AND (em.entry_id IS NULL OR em.model <> $2)
      ORDER BY e.created_at DESC
      LIMIT $3`,
    [goalId, model, limit]
  );
}

export type SemanticEntry = Entry & { distance: number };

// Cosine-distance nearest entries within one goal. `dim` guard keeps a stale
// embedding from a different model out of the comparison.
export async function searchEntriesSemantic(
  goalId: number,
  embedding: number[],
  limit = 5
): Promise<SemanticEntry[]> {
  return query<SemanticEntry>(
    `SELECT e.*, (em.embedding <=> $2::vector) AS distance
       FROM neville_entry_embeddings em
       JOIN neville_entries e ON e.id = em.entry_id
      WHERE em.goal_id = $1 AND em.dim = $3
      ORDER BY distance ASC
      LIMIT $4`,
    [goalId, toVectorLiteral(embedding), embedding.length, limit]
  );
}

export async function deleteEntryEmbedding(entryId: number): Promise<void> {
  await query("DELETE FROM neville_entry_embeddings WHERE entry_id = $1", [entryId]);
}
