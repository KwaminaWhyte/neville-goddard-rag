// GET  /api/goals/:id/entries?q=&kind=  → list/search a goal's journey entries
// POST /api/goals/:id/entries           → add entry { kind, content, state? }
import type { Route } from "./+types/goals.$id.entries";
import { listEntries, searchEntries, addEntry } from "../../lib/db.server";
import { json, preflight } from "../../lib/api.server";

export async function loader({ params, request }: Route.LoaderArgs) {
  const id = Number(params.id);
  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";
  const kind = url.searchParams.get("kind") || "";
  const entries = q || kind ? await searchEntries(id, q, kind) : await listEntries(id);
  return json(entries);
}

export async function action({ request, params }: Route.ActionArgs) {
  const pre = preflight(request);
  if (pre) return pre;
  const id = Number(params.id);
  const body = (await request.json()) as { kind?: string; content?: string; state?: string };
  const content = (body.content || "").trim();
  if (!content) return json({ error: "content is required" }, 400);
  const entry = await addEntry(id, (body.kind || "checkin").trim(), content, (body.state || "").trim() || undefined);
  return json(entry, 201);
}
