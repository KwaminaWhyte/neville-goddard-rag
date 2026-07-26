// GET  /api/goals/:id/entries?q=&kind=&mode=  → list/search a goal's journey entries
//        mode=meaning ranks by semantic similarity to q (needs pgvector);
//        anything else is the substring filter.
// POST /api/goals/:id/entries                 → add entry { kind, content, state? }
import type { Route } from "./+types/goals.$id.entries";
import { getGoal, listEntries, searchEntries, addEntry } from "../../lib/db.server";
import { ensureIndexed, indexEntry, searchJournalSemantic } from "../../lib/journal.server";
import { requireUser } from "../../lib/auth.server";
import { jsonFor, preflight } from "../../lib/api.server";

export async function loader({ params, request }: Route.LoaderArgs) {
  const j = jsonFor(request);
  const user = await requireUser(request, { api: true });
  const id = Number(params.id);
  const goal = await getGoal(id, user.id);
  if (!goal) return j({ error: "not found" }, 404);
  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";
  const kind = url.searchParams.get("kind") || "";
  if (url.searchParams.get("mode") === "meaning" && q.trim()) {
    const res = await searchJournalSemantic(id, q, { kind, limit: 40 });
    // Unavailable (no pgvector) or nothing embedded yet → substring, so a client
    // asking for meaning never gets an empty list where words would have matched.
    if (res.available && res.entries.length) return j(res.entries);
  }
  const entries = q || kind ? await searchEntries(id, q, kind) : await listEntries(id);
  return j(entries);
}

export async function action({ request, params }: Route.ActionArgs) {
  const j = jsonFor(request);
  const pre = preflight(request);
  if (pre) return pre;
  const user = await requireUser(request, { api: true });
  const id = Number(params.id);
  const goal = await getGoal(id, user.id);
  if (!goal) return j({ error: "not found" }, 404);
  const body = (await request.json()) as { kind?: string; content?: string; state?: string };
  const content = (body.content || "").trim();
  if (!content) return j({ error: "content is required" }, 400);
  const entry = await addEntry(id, (body.kind || "checkin").trim(), content, (body.state || "").trim() || undefined);
  // Best-effort, not awaited: the mobile client's write must not wait on (or be
  // failed by) a local embedder. Backfill covers anything missed.
  void indexEntry(entry);
  // A client that only ever POSTs still gets its older entries indexed.
  void ensureIndexed(id);
  return j(entry, 201);
}
