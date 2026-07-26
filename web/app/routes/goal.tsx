import { Form, Link, useNavigation, useSearchParams } from "react-router";
import type { Route } from "./+types/goal";
import {
  getGoal,
  listEntries,
  searchEntries,
  updateEntry,
  deleteEntry,
  dayNumber,
  getProcess,
  saveProcess,
  addEntry,
  setGoalStatus,
  deleteGoal,
  getStreak,
  listEndScenes,
  listSigns,
  feltStateTrend,
  listChats,
  checkEmbeddingDrift,
  getUserTimezone,
} from "../lib/db.server";
import { generateDailyProcess, generateEndScene } from "../lib/coach.server";
import {
  ensureIndexed,
  indexEntry,
  journalSearchStatus,
  reindexEntry,
  searchJournalSemantic,
} from "../lib/journal.server";
import { requireUser } from "../lib/auth.server";
import { updateEndSceneNote } from "../lib/db.server";
import { healthStatus } from "../lib/lightrag.server";
import { ollamaHealth } from "../lib/ollama.server";
import { log } from "../lib/logger.server";
import Markdown from "../components/Markdown";
import CoachChat from "../components/CoachChat";
import Trends from "../components/Trends";
import { HealthBanner } from "./home";

// Best-effort wrapper for optional page data (health checks, streaks, chats):
// never fail the page, but never lose the failure either.
async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch (e) {
    log.warn("goal", "optional loader data unavailable", { error: (e as Error).message });
    return fallback;
  }
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const id = Number(params.id);
  const goal = await getGoal(id, user.id);
  if (!goal) throw new Response("Not found", { status: 404 });
  // Day counter and streak must bucket calendar days in the same zone.
  const tz = await getUserTimezone(user.id);
  const day = dayNumber(goal, tz);
  const url = new URL(request.url);
  const q = url.searchParams.get("q") || "";
  const kind = url.searchParams.get("kind") || "";
  // mode=meaning ranks the log by semantic similarity; anything else keeps the
  // original ILIKE substring behaviour.
  const mode = url.searchParams.get("mode") === "meaning" ? "meaning" : "text";
  const filtering = Boolean(q || kind);

  // Opportunistic, bounded, throttled backfill for entries predating this
  // feature. Fire-and-forget: the page must not wait on a local embedder, and
  // the search path below joins this same sweep instead of duplicating it. It
  // no-ops when the feature is unavailable.
  void ensureIndexed(id);

  const [
    journeyEntries,
    journal,
    process,
    streak,
    endScenes,
    signs,
    trend,
    chats,
    lightrag,
    ollama,
    drift,
  ] = await Promise.all([
    // Journey log respects the search/filter; everything else spans all entries.
    journeyLog(id, { q, kind, semantic: mode === "meaning", filtering }),
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
  return {
    goal,
    entries: journeyEntries.entries,
    day,
    process,
    streak,
    endScenes,
    signs,
    trend,
    chats: chats.map((c) => ({ role: c.role as "user" | "assistant", content: c.content })),
    filter: { q, kind, filtering, mode, semantic: journeyEntries.semantic },
    journal,
    health: { lightrag, ollama, drift },
  };
}

// One shape for the journey log whichever way it was fetched, so the component
// doesn't branch on a union. `distance` is cosine distance, present only for
// semantic hits.
type LogEntry = {
  id: number;
  goal_id: number;
  kind: string;
  content: string;
  state: string | null;
  created_at: string;
  distance: number | null;
};

async function journeyLog(
  id: number,
  opts: { q: string; kind: string; semantic: boolean; filtering: boolean }
): Promise<{ entries: LogEntry[]; semantic: boolean }> {
  // Semantic mode needs something to rank against; a kind-only filter is still
  // just a filter.
  if (opts.semantic && opts.q.trim()) {
    const res = await safe(searchJournalSemantic(id, opts.q, { kind: opts.kind, limit: 40 }), {
      available: false,
      entries: [],
    });
    // Zero hits means nothing is embedded yet (or the embedder is down), not
    // "no such moment" — fall through to substring rather than show an empty log.
    if (res.available && res.entries.length) {
      return {
        entries: res.entries.map((e) => ({ ...e, distance: Number(e.distance) })),
        semantic: true,
      };
    }
  }
  const rows = opts.filtering
    ? await searchEntries(id, opts.q, opts.kind)
    : await listEntries(id);
  return { entries: rows.map((e) => ({ ...e, distance: null })), semantic: false };
}

export async function action({ request, params }: Route.ActionArgs) {
  const user = await requireUser(request);
  const id = Number(params.id);
  const fd = await request.formData();
  const intent = String(fd.get("intent"));
  const goal = await getGoal(id, user.id);
  if (!goal) throw new Response("Not found", { status: 404 });

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
      // Lets the coach also pull semantically relevant older entries, minus the
      // ones already shown above.
      goalId: id,
      recentIds: recentRows.map((e) => e.id),
    });
    await saveProcess(id, day, content, sources);
    return { ok: true };
  }
  if (intent === "entry") {
    const entry = await addEntry(
      id,
      String(fd.get("kind") || "checkin"),
      String(fd.get("content") || "").trim(),
      String(fd.get("state") || "").trim() || undefined
    );
    // Not awaited: logging your day must return immediately and must never fail
    // because the embedder is cold or Ollama is down. indexEntry never throws,
    // and anything it misses is picked up by the next backfill sweep.
    void indexEntry(entry);
    return { ok: true };
  }
  if (intent === "entry-edit") {
    const updated = await updateEntry(
      id,
      Number(fd.get("entryId")),
      String(fd.get("content") || "").trim(),
      String(fd.get("state") || "").trim() || null
    );
    // Content changed → the stored vector is stale.
    if (updated) void reindexEntry(updated);
    return { ok: true };
  }
  if (intent === "entry-delete") {
    // The vector goes with it: neville_entry_embeddings.entry_id is
    // ON DELETE CASCADE, so there is nothing extra to clean up.
    await deleteEntry(id, Number(fd.get("entryId")));
    return { ok: true };
  }
  if (intent === "endscene") {
    const scene = await generateEndScene(goal.desire);
    await updateEndSceneNote(id, scene);
    return { ok: true };
  }
  if (intent === "status") {
    await setGoalStatus(id, user.id, String(fd.get("status")));
    return { ok: true };
  }
  if (intent === "delete") {
    await deleteGoal(id, user.id);
    throw new Response(null, { status: 302, headers: { Location: "/" } });
  }
  return { ok: false };
}

export default function GoalPage({ loaderData }: Route.ComponentProps) {
  const {
    goal,
    entries,
    day,
    process,
    streak,
    endScenes,
    signs,
    trend,
    chats,
    filter,
    journal,
    health,
  } = loaderData;
  const [, setSearchParams] = useSearchParams();
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  // True while THIS form's intent (and optional status value) is in flight.
  const pending = (intent: string, status?: string) =>
    busy &&
    nav.formData?.get("intent") === intent &&
    (status === undefined || nav.formData?.get("status") === status);
  const generating = pending("process");
  // Newest end-scene is the current one shown above; the rest are past versions.
  const pastScenes = endScenes.slice(1);

  return (
    <main className="mx-auto max-w-3xl px-5 py-10">
      <Link to="/" className="text-sm text-[var(--color-muted)] hover:text-[var(--color-gold)]">
        ← all desires
      </Link>

      <HealthBanner health={health} />

      <header className="mt-4 mb-8">
        <div className="flex items-start justify-between gap-4">
          <h1 className="serif text-3xl text-[var(--color-gold)]">{goal.title}</h1>
          <div className="flex flex-col items-end gap-1.5">
            <span className="whitespace-nowrap rounded-full border border-[var(--color-line)] px-3 py-1 text-xs text-[var(--color-muted)]">
              Day {day} · {goal.status}
            </span>
            {streak.current > 0 ? (
              <span className="whitespace-nowrap text-xs text-[var(--color-gold)]">
                🔥 {streak.current}-day streak
                {streak.longest > streak.current && (
                  <span className="text-[var(--color-muted)]"> · best {streak.longest}</span>
                )}
              </span>
            ) : (
              <span className="whitespace-nowrap text-xs text-[var(--color-muted)]">
                Begin your streak — log today
              </span>
            )}
          </div>
        </div>
        <p className="mt-2 text-[var(--color-muted)]">{goal.desire}</p>
      </header>

      {/* End scene */}
      <section className="mb-8 rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] p-6">
        <img
          src="/illustrations/endscene.png"
          alt="Celestial illustration"
          className="mb-4 h-28 w-full rounded-lg border border-[var(--color-line)] object-cover"
        />
        <div className="mb-2 flex items-center justify-between">
          <h2 className="serif text-lg text-[var(--color-accent)]">Live in the end</h2>
          <Form method="post">
            <input type="hidden" name="intent" value="endscene" />
            <button
              disabled={pending("endscene")}
              className="text-xs text-[var(--color-muted)] hover:text-[var(--color-gold)] disabled:opacity-50"
            >
              {pending("endscene") ? "composing…" : "regenerate"}
            </button>
          </Form>
        </div>
        <p className="italic leading-relaxed text-[#e7e2fb]">{goal.end_scene}</p>
        <p className="mt-3 text-xs text-[var(--color-muted)]">
          Replay this nightly in a drowsy state until it feels natural.
        </p>
        {pastScenes.length > 0 && (
          <details className="mt-4 border-t border-[var(--color-line)] pt-3">
            <summary className="cursor-pointer text-xs text-[var(--color-muted)] hover:text-[var(--color-gold)]">
              Past versions ({pastScenes.length})
            </summary>
            <ul className="mt-3 space-y-3">
              {pastScenes.map((s) => (
                <li key={s.id} className="border-l-2 border-[var(--color-line)] pl-3">
                  <div className="text-xs text-[var(--color-muted)]">
                    {new Date(s.created_at).toLocaleString()}
                  </div>
                  <p className="mt-0.5 text-sm italic leading-relaxed text-[#cfc8ec]">{s.scene}</p>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      {/* Daily process */}
      <section className="mb-8 rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] p-6">
        <img
          src="/illustrations/process.png"
          alt="Celestial illustration"
          className="mb-4 h-28 w-full rounded-lg border border-[var(--color-line)] object-cover"
        />
        <div className="mb-3 flex items-center justify-between">
          <h2 className="serif text-lg text-[var(--color-gold)]">Today's process — Day {day}</h2>
          <Form method="post">
            <input type="hidden" name="intent" value="process" />
            <button
              disabled={generating}
              className="rounded-lg border border-[var(--color-gold-dim)] px-3 py-1.5 text-xs text-[var(--color-gold)] hover:bg-[var(--color-gold)]/10 disabled:opacity-50"
            >
              {generating ? "Drawing from the teaching…" : process ? "Regenerate" : "Generate"}
            </button>
          </Form>
        </div>
        {process ? (
          <Markdown>{process.content}</Markdown>
        ) : (
          <p className="text-sm text-[var(--color-muted)]">
            No process yet for today. Generate one — it is composed from your end-scene, your recent
            log, and Neville's teaching.
          </p>
        )}
      </section>

      {/* Felt-state trends */}
      {trend.length > 1 && (
        <section className="mb-8 rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] p-6">
          <h2 className="serif text-lg mb-1 text-[var(--color-accent)]">Felt-state trends</h2>
          <p className="mb-4 text-xs text-[var(--color-muted)]">
            How your assumed state has moved over time — the inner weather of your journey.
          </p>
          <Trends points={trend} />
        </section>
      )}

      {/* Journey log */}
      <section className="mb-8 rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] p-6">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="serif text-lg">Journey log</h2>
          {/* Search / filter — GET form updates the URL query, loader filters. */}
          <Form method="get" className="flex flex-wrap items-center justify-end gap-2">
            <input
              name="q"
              defaultValue={filter.q}
              placeholder={filter.mode === "meaning" ? "when did I feel…?" : "search…"}
              className="w-32 rounded-lg border border-[var(--color-line)] bg-[var(--color-base)] px-2.5 py-1 text-xs outline-none focus:border-[var(--color-accent)] sm:w-40"
            />
            {/* Substring vs. meaning. Disabled (not hidden) when pgvector is
                absent, so the capability is discoverable with its reason. */}
            <select
              name="mode"
              defaultValue={journal.available ? filter.mode : "text"}
              disabled={!journal.available}
              title={journal.reason ?? "Search by wording, or by meaning (your own log, embedded)"}
              className="rounded-lg border border-[var(--color-line)] bg-[var(--color-base)] px-2 py-1 text-xs disabled:opacity-40"
            >
              <option value="text">by words</option>
              <option value="meaning">by meaning</option>
            </select>
            <select
              name="kind"
              defaultValue={filter.kind}
              className="rounded-lg border border-[var(--color-line)] bg-[var(--color-base)] px-2 py-1 text-xs"
            >
              <option value="">all</option>
              <option value="checkin">Check-in</option>
              <option value="sats">SATS</option>
              <option value="revision">Revision</option>
              <option value="sign">Sign</option>
              <option value="reflection">Reflection</option>
            </select>
            <button className="rounded-lg border border-[var(--color-line)] px-2.5 py-1 text-xs text-[var(--color-muted)] hover:text-[var(--color-gold)]">
              Filter
            </button>
            {filter.filtering && (
              <button
                type="button"
                onClick={() => setSearchParams({})}
                className="text-xs text-[var(--color-muted)] hover:text-[var(--color-gold)]"
              >
                clear
              </button>
            )}
          </Form>
        </div>
        {filter.semantic ? (
          <p className="mb-3 text-xs text-[var(--color-accent)]">
            Closest in meaning to “{filter.q}” — your own words, ranked by feeling rather than
            wording.
          </p>
        ) : (
          filter.mode === "meaning" &&
          Boolean(filter.q) && (
            <p className="mb-3 text-xs text-[var(--color-muted)]">
              Your log isn’t embedded yet — showing word matches. Try again in a moment.
            </p>
          )
        )}
        {!journal.available && journal.reason && (
          <p className="mb-3 text-xs text-[var(--color-muted)]">
            Search by meaning is off: {journal.reason}
          </p>
        )}
        <Form method="post" className="mb-5 space-y-2">
          <input type="hidden" name="intent" value="entry" />
          <div className="flex gap-2">
            <select
              name="kind"
              className="rounded-lg border border-[var(--color-line)] bg-[var(--color-base)] px-3 py-2 text-sm"
            >
              <option value="checkin">Check-in</option>
              <option value="sats">SATS</option>
              <option value="revision">Revision</option>
              <option value="sign">Sign / bridge of incident</option>
              <option value="reflection">Reflection</option>
            </select>
            <input
              name="state"
              placeholder="felt state (e.g. assured, doubtful)"
              className="flex-1 rounded-lg border border-[var(--color-line)] bg-[var(--color-base)] px-3 py-2 text-sm"
            />
          </div>
          <textarea
            name="content"
            rows={2}
            required
            placeholder="What did you imagine, notice, or feel?"
            className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-base)] px-3 py-2 text-sm"
          />
          <button
            disabled={pending("entry")}
            className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-black hover:opacity-90 disabled:opacity-50"
          >
            {pending("entry") ? "Logging…" : "Log it"}
          </button>
        </Form>
        {entries.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">
            {filter.filtering ? "No entries match your filter." : "No entries yet."}
          </p>
        ) : (
          <ul className="space-y-3">
            {entries.map((e) => (
              <li key={e.id} className="group border-l-2 border-[var(--color-line)] pl-3">
                <div className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
                  <span className="uppercase tracking-wide text-[var(--color-accent)]">{e.kind}</span>
                  {e.state && <span>· {e.state}</span>}
                  <span>· {new Date(e.created_at).toLocaleString()}</span>
                  {/* Cosine distance → a plain closeness reading for the user. */}
                  {e.distance != null && (
                    <span className="text-[var(--color-gold)]">
                      · {Math.round(Math.max(0, 1 - e.distance) * 100)}% match
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-2 opacity-0 transition group-hover:opacity-100">
                    <Form
                      method="post"
                      onSubmit={(ev) => !confirm("Delete this entry?") && ev.preventDefault()}
                    >
                      <input type="hidden" name="intent" value="entry-delete" />
                      <input type="hidden" name="entryId" value={e.id} />
                      <button
                        disabled={pending("entry-delete")}
                        className="text-red-400/70 hover:text-red-400 disabled:opacity-50"
                      >
                        delete
                      </button>
                    </Form>
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-[#ddd8ef]">{e.content}</p>
                {/* Edit form, revealed by the <details> toggle above (same row). */}
                <details className="mt-1">
                  <summary className="cursor-pointer list-none text-xs text-[var(--color-muted)] hover:text-[var(--color-gold)]">
                    edit ↻
                  </summary>
                  <Form method="post" className="mt-2 space-y-2">
                    <input type="hidden" name="intent" value="entry-edit" />
                    <input type="hidden" name="entryId" value={e.id} />
                    <input
                      name="state"
                      defaultValue={e.state ?? ""}
                      placeholder="felt state"
                      className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-base)] px-3 py-1.5 text-sm"
                    />
                    <textarea
                      name="content"
                      rows={2}
                      defaultValue={e.content}
                      required
                      className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-base)] px-3 py-1.5 text-sm"
                    />
                    <button
                      disabled={pending("entry-edit")}
                      className="rounded-lg border border-[var(--color-gold-dim)] px-3 py-1 text-xs text-[var(--color-gold)] hover:bg-[var(--color-gold)]/10 disabled:opacity-50"
                    >
                      {pending("entry-edit") ? "Saving…" : "Save"}
                    </button>
                  </Form>
                </details>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Signs noticed — the manifestation feedback loop */}
      {signs.length > 0 && (
        <section className="mb-8 rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] p-6">
          <h2 className="serif text-lg mb-1 text-[var(--color-gold)]">Signs noticed</h2>
          <p className="mb-4 text-xs text-[var(--color-muted)]">
            Bridges of incident — the world rearranging toward your assumption.
          </p>
          <ol className="relative ml-1 space-y-5 border-l border-[var(--color-line)] pl-5">
            {signs.map((s) => (
              <li key={s.id} className="relative">
                <span className="absolute -left-[1.6rem] top-1.5 h-2.5 w-2.5 rounded-full border border-[var(--color-base)] bg-[var(--color-gold)] shadow-[0_0_8px_var(--color-gold)]" />
                <div className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
                  <span>{new Date(s.created_at).toLocaleString()}</span>
                  {s.state && (
                    <span className="text-[var(--color-accent)]">· felt {s.state}</span>
                  )}
                </div>
                <p className="mt-0.5 text-sm leading-relaxed text-[#e7e2fb]">{s.content}</p>
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* Coach chat */}
      <section className="mb-8 rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] p-6">
        <h2 className="serif text-lg mb-3 text-[var(--color-accent)]">Ask the coach</h2>
        <CoachChat goalId={goal.id} initial={chats} />
      </section>

      {/* Status controls */}
      <section className="flex flex-wrap items-center gap-3">
        {goal.status !== "realised" && (
          <Form method="post">
            <input type="hidden" name="intent" value="status" />
            <input type="hidden" name="status" value="realised" />
            <button
              disabled={pending("status", "realised")}
              className="rounded-lg bg-[var(--color-gold)] px-4 py-2 text-sm font-medium text-black hover:bg-[var(--color-gold-dim)] disabled:opacity-50"
            >
              {pending("status", "realised") ? "Marking…" : "✦ Mark realised"}
            </button>
          </Form>
        )}
        {goal.status === "active" && (
          <Form method="post">
            <input type="hidden" name="intent" value="status" />
            <input type="hidden" name="status" value="released" />
            <button
              disabled={pending("status", "released")}
              className="rounded-lg border border-[var(--color-line)] px-4 py-2 text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)] disabled:opacity-50"
            >
              {pending("status", "released") ? "Releasing…" : "Release"}
            </button>
          </Form>
        )}
        <Form method="post" onSubmit={(e) => !confirm("Delete this desire and its journey?") && e.preventDefault()}>
          <input type="hidden" name="intent" value="delete" />
          <button
            disabled={pending("delete")}
            className="rounded-lg border border-[var(--color-line)] px-4 py-2 text-sm text-red-400/80 hover:text-red-400 disabled:opacity-50"
          >
            {pending("delete") ? "Deleting…" : "Delete"}
          </button>
        </Form>
      </section>
    </main>
  );
}
