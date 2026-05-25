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
} from "../../lib/db.server";
import { generateDailyProcess, generateEndScene } from "../../lib/coach.server";
import { healthStatus } from "../../lib/lightrag.server";
import { ollamaHealth } from "../../lib/ollama.server";
import { json, preflight } from "../../lib/api.server";

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

export async function loader({ params }: Route.LoaderArgs) {
  const id = Number(params.id);
  const goal = await getGoal(id);
  if (!goal) return json({ error: "not found" }, 404);
  const day = dayNumber(goal);
  const [process, streak, endScenes, signs, trend, chats, lightrag, ollama, drift] =
    await Promise.all([
      getProcess(id, day),
      safe(getStreak(id), { current: 0, longest: 0, lastEntryDate: null }),
      safe(listEndScenes(id), []),
      safe(listSigns(id), []),
      safe(feltStateTrend(id), []),
      safe(listChats(id), []),
      safe(healthStatus(), { ok: true, detail: "" }),
      safe(ollamaHealth(), { ok: true, detail: "" }),
      safe(checkEmbeddingDrift(), { ok: true, message: null }),
    ]);
  return json({
    goal,
    day,
    process: process ?? null,
    streak,
    endScenes,
    signs,
    trend,
    chats: chats.map((c) => ({ role: c.role, content: c.content })),
    health: { lightrag, ollama, drift },
  });
}

export async function action({ request, params }: Route.ActionArgs) {
  const pre = preflight(request);
  if (pre) return pre;
  const id = Number(params.id);
  const goal = await getGoal(id);
  if (!goal) return json({ error: "not found" }, 404);

  if (request.method === "DELETE") {
    await deleteGoal(id);
    return json({ ok: true });
  }

  const body = (await request.json().catch(() => ({}))) as {
    intent?: string;
    status?: string;
  };
  const intent = body.intent;

  if (intent === "process") {
    const day = dayNumber(goal);
    const recent = (await listEntries(id)).slice(0, 5).map((e) => ({
      kind: e.kind,
      content: e.content,
      state: e.state,
    }));
    const { content, sources } = await generateDailyProcess({
      desire: goal.desire,
      endScene: goal.end_scene,
      day,
      recent,
    });
    const saved = await saveProcess(id, day, content, sources);
    return json(saved);
  }
  if (intent === "endscene") {
    const scene = await generateEndScene(goal.desire);
    await updateEndSceneNote(id, scene);
    return json({ ok: true, scene });
  }
  if (intent === "status") {
    await setGoalStatus(id, String(body.status));
    return json({ ok: true });
  }
  return json({ error: "unknown intent" }, 400);
}
