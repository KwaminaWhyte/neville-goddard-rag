// GET  /api/goals      → list all goals
// POST /api/goals      → create a goal { title, desire } (composes end-scene)
import type { Route } from "./+types/goals";
import { listGoals, createGoal } from "../../lib/db.server";
import { generateEndScene } from "../../lib/coach.server";
import { json, preflight } from "../../lib/api.server";

export async function loader(_: Route.LoaderArgs) {
  return json(await listGoals());
}

export async function action({ request }: Route.ActionArgs) {
  const pre = preflight(request);
  if (pre) return pre;
  const body = (await request.json()) as { title?: string; desire?: string };
  const title = (body.title || "").trim();
  const desire = (body.desire || "").trim();
  if (!title || !desire) return json({ error: "title and desire are required" }, 400);
  const endScene = await generateEndScene(desire);
  const goal = await createGoal(title, desire, endScene);
  return json(goal, 201);
}
