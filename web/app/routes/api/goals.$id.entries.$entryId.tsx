// PATCH/POST /api/goals/:id/entries/:entryId  → update { content, state? }
// DELETE     /api/goals/:id/entries/:entryId  → delete entry
import type { Route } from "./+types/goals.$id.entries.$entryId";
import { getGoal, updateEntry, deleteEntry } from "../../lib/db.server";
import { requireUser } from "../../lib/auth.server";
import { json, preflight } from "../../lib/api.server";

export async function action({ request, params }: Route.ActionArgs) {
  const pre = preflight(request);
  if (pre) return pre;
  const user = await requireUser(request, { api: true });
  const id = Number(params.id);
  const entryId = Number(params.entryId);
  const goal = await getGoal(id, user.id);
  if (!goal) return json({ error: "not found" }, 404);

  if (request.method === "DELETE") {
    await deleteEntry(id, entryId);
    return json({ ok: true });
  }
  const body = (await request.json()) as { content?: string; state?: string | null };
  const content = (body.content || "").trim();
  if (!content) return json({ error: "content is required" }, 400);
  const updated = await updateEntry(id, entryId, content, body.state ?? null);
  if (!updated) return json({ error: "not found" }, 404);
  return json(updated);
}
