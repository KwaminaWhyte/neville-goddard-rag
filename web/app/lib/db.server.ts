// Postgres pool + tracker tables (goals / entries / processes).
// Shares the same Postgres as LightRAG but uses its own neville_* tables.
import "dotenv/config";
import pg from "pg";
import { getEmbeddingConfig } from "./lightrag.server";

const { Pool } = pg;

const pool = new Pool({
  host: process.env.PG_HOST || "localhost",
  port: Number(process.env.PG_PORT || 5432),
  user: process.env.PG_USER || "rag",
  password: process.env.PG_PASSWORD || "rag",
  database: process.env.PG_DATABASE || "rag",
  max: 10,
});

let migrated: Promise<void> | null = null;
function ensureMigrated(): Promise<void> {
  if (migrated) return migrated;
  migrated = (async () => {
    await pool.query(`
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
    `);
  })();
  return migrated;
}

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

export async function listGoals(): Promise<Goal[]> {
  return query<Goal>(
    "SELECT * FROM neville_goals ORDER BY (status='active') DESC, created_at DESC"
  );
}

export async function getGoal(id: number): Promise<Goal | undefined> {
  const r = await query<Goal>("SELECT * FROM neville_goals WHERE id = $1", [id]);
  return r[0];
}

export async function createGoal(title: string, desire: string, endScene: string): Promise<Goal> {
  const r = await query<Goal>(
    "INSERT INTO neville_goals (title, desire, end_scene) VALUES ($1,$2,$3) RETURNING *",
    [title, desire, endScene]
  );
  return r[0];
}

export async function setGoalStatus(id: number, status: string): Promise<void> {
  await query(
    "UPDATE neville_goals SET status=$1, realised_at = CASE WHEN $1='realised' THEN now() ELSE NULL END WHERE id=$2",
    [status, id]
  );
}

export async function deleteGoal(id: number): Promise<void> {
  await query("DELETE FROM neville_goals WHERE id = $1", [id]);
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

// Consecutive-day streak from distinct calendar days of entries.
export async function getStreak(
  goalId: number
): Promise<{ current: number; longest: number; lastEntryDate: string | null }> {
  const rows = await query<{ d: string }>(
    "SELECT DISTINCT to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS d FROM neville_entries WHERE goal_id = $1 ORDER BY d",
    [goalId]
  );
  const days = rows.map((r) => r.d);
  if (!days.length) return { current: 0, longest: 0, lastEntryDate: null };
  const lastEntryDate = days[days.length - 1];
  const toDays = (s: string) => Math.floor(new Date(s + "T00:00:00Z").getTime() / 86400000);
  // longest run of consecutive days.
  let longest = 1;
  let run = 1;
  for (let i = 1; i < days.length; i++) {
    if (toDays(days[i]) - toDays(days[i - 1]) === 1) run++;
    else run = 1;
    if (run > longest) longest = run;
  }
  // current run must end today or yesterday.
  const todayNum = Math.floor(Date.now() / 86400000);
  const lastNum = toDays(lastEntryDate);
  let current = 0;
  if (todayNum - lastNum <= 1) {
    current = 1;
    for (let i = days.length - 1; i > 0; i--) {
      if (toDays(days[i]) - toDays(days[i - 1]) === 1) current++;
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
  } catch {
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

export function dayNumber(goal: Goal): number {
  // Calendar-day rollover: Day 2 begins at local midnight after creation,
  // not 24h after the exact creation time.
  const c = new Date(goal.created_at);
  const start = new Date(c.getFullYear(), c.getMonth(), c.getDate()).getTime();
  const n = new Date();
  const today = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
  return Math.max(1, Math.round((today - start) / 86400000) + 1);
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

// --- Entry / sign CRUD (Phase 5: edit/delete) ---
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

// --- Felt-state trends (Phase 5) ---
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

// --- Search / filter (Phase 5) ---
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

// --- Coach chat history persistence (Phase 5) ---
export type Chat = { id: number; goal_id: number; role: string; content: string; created_at: string };

export async function listChats(goalId: number): Promise<Chat[]> {
  return query<Chat>(
    "SELECT * FROM neville_chats WHERE goal_id=$1 ORDER BY created_at ASC, id ASC",
    [goalId]
  );
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
