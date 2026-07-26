// GET    /api/goals/:id            → full goal bundle (goal, day, process, streak,
//                                     endScenes, signs, trend, chats, health)
// POST   /api/goals/:id            → mutate via { intent }:
//          intent=process   → generate today's process
//          intent=endscene  → regenerate end-scene
//          intent=status    → { status } set goal status
// DELETE /api/goals/:id            → delete goal
import type { Route } from "./+types/goals.$id";
import {
  getGoal,
  dayNumber,
  getProcess,
  saveProcess,
  listEntries,
  getStreak,
  listEndScenes,
  listSigns,
  feltStateTrend,
  listChats,
  setGoalStatus,
  deleteGoal,
  updateEndSceneNote,
  checkEmbeddingDrift,
  getUserTimezone,
} from "../../lib/db.server";
import { generateDailyProcess, generateEndScene } from "../../lib/coach.server";
import { ensureIndexed, journalSearchStatus } from "../../lib/journal.server";
import { requireUser } from "../../lib/auth.server";
import { healthStatus } from "../../lib/lightrag.server";
import { ollamaHealth } from "../../lib/ollama.server";
import { jsonFor, preflight } from "../../lib/api.server";
import { log } from "../../lib/logger.server";

// Best-effort wrapper for optional bundle data (health checks, streaks, chats):
// never fail the response, but never lose the failure either.
async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch (e) {
    log.warn("api/goals.$id", "optional bundle data unavailable", { error: (e as Error).message });
    return fallback;
  }
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const j = jsonFor(request);
  const user = await requireUser(request, { api: true });
  const id = Number(params.id);
  const goal = await getGoal(id, user.id);
  if (!goal) return j({ error: "not found" }, 404);
  // Day counter and streak must bucket calendar days in the same zone.
  const tz = await getUserTimezone(user.id);
  const day = dayNumber(goal, tz);
  // Same opportunistic bounded sweep as the web loader — never awaited, no-ops
  // when journal embeddings are unavailable.
  void ensureIndexed(id);
  const [journal, process, streak, endScenes, signs, trend, chats, lightrag, ollama, drift] =
    await Promise.all([
      safe(journalSearchStatus(), { available: false, reason: null as string | null, model: "" }),
      getProcess(id, day),
      safe(getStreak(id, tz), { current: 0, longest: 0, lastEntryDate: null }),
      safe(listEndScenes(id), []),
      safe(listSigns(id), []),
      safe(feltStateTrend(id), []),
      safe(listChats(id), []),
      safe(healthStatus(), { ok: true, detail: "" }),
      safe(ollamaHealth(), { ok: true, detail: "" }),
      safe(checkEmbeddingDrift(), { ok: true, message: null }),
    ]);
  return j({
    goal,
    day,
    process: process ?? null,
    streak,
    endScenes,
    signs,
    trend,
    chats: chats.map((c) => ({ role: c.role, content: c.content })),
    journal,
    health: { lightrag, ollama, drift },
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const j = jsonFor(request);
  const pre = preflight(request);
  if (pre) return pre;
  const user = await requireUser(request, { api: true });
  const id = Number(params.id);
  const goal = await getGoal(id, user.id);
  if (!goal) return j({ error: "not found" }, 404);

  if (request.method === "DELETE") {
    await deleteGoal(id, user.id);
    return j({ ok: true });
  }

  const body = (await request.json().catch(() => ({}))) as {
    intent?: string;
    status?: string;
  };
  const intent = body.intent;

  if (intent === "process") {
    const day = dayNumber(goal, await getUserTimezone(user.id));
    const recentRows = (await listEntries(id)).slice(0, 5);
    const recent = recentRows.map((e) => ({
      kind: e.kind,
      content: e.content,
      state: e.state,
    }));
    const { content, sources } = await generateDailyProcess({
      desire: goal.desire,
      endScene: goal.end_scene,
      day,
      recent,
      // Also fold in semantically relevant older entries, minus these five.
      goalId: id,
      recentIds: recentRows.map((e) => e.id),
    });
    const saved = await saveProcess(id, day, content, sources);
    return j(saved);
  }
  if (intent === "endscene") {
    const scene = await generateEndScene(goal.desire);
    await updateEndSceneNote(id, scene);
    return j({ ok: true, scene });
  }
  if (intent === "status") {
    await setGoalStatus(id, user.id, String(body.status));
    return j({ ok: true });
  }
  return j({ error: "unknown intent" }, 400);
}
