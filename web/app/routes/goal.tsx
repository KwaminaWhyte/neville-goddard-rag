import { Form, Link, useNavigation } from "react-router";
import type { Route } from "./+types/goal";
import {
  getGoal,
  listEntries,
  dayNumber,
  getProcess,
  saveProcess,
  addEntry,
  setGoalStatus,
  deleteGoal,
  getStreak,
  listEndScenes,
  listSigns,
  checkEmbeddingDrift,
} from "../lib/db.server";
import { generateDailyProcess, generateEndScene } from "../lib/coach.server";
import { updateEndSceneNote } from "../lib/db.server";
import { healthStatus } from "../lib/lightrag.server";
import { ollamaHealth } from "../lib/ollama.server";
import Markdown from "../components/Markdown";
import CoachChat from "../components/CoachChat";
import { HealthBanner } from "./home";

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
  if (!goal) throw new Response("Not found", { status: 404 });
  const day = dayNumber(goal);
  const [entries, process, streak, endScenes, signs, lightrag, ollama, drift] =
    await Promise.all([
      listEntries(id),
      getProcess(id, day),
      safe(getStreak(id), { current: 0, longest: 0, lastEntryDate: null }),
      safe(listEndScenes(id), []),
      safe(listSigns(id), []),
      safe(healthStatus(), { ok: true, detail: "" }),
      safe(ollamaHealth(), { ok: true, detail: "" }),
      safe(checkEmbeddingDrift(), { ok: true, message: null }),
    ]);
  return {
    goal,
    entries,
    day,
    process,
    streak,
    endScenes,
    signs,
    health: { lightrag, ollama, drift },
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const id = Number(params.id);
  const fd = await request.formData();
  const intent = String(fd.get("intent"));
  const goal = await getGoal(id);
  if (!goal) throw new Response("Not found", { status: 404 });

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
    await saveProcess(id, day, content, sources);
    return { ok: true };
  }
  if (intent === "entry") {
    await addEntry(
      id,
      String(fd.get("kind") || "checkin"),
      String(fd.get("content") || "").trim(),
      String(fd.get("state") || "").trim() || undefined
    );
    return { ok: true };
  }
  if (intent === "endscene") {
    const scene = await generateEndScene(goal.desire);
    await updateEndSceneNote(id, scene);
    return { ok: true };
  }
  if (intent === "status") {
    await setGoalStatus(id, String(fd.get("status")));
    return { ok: true };
  }
  if (intent === "delete") {
    await deleteGoal(id);
    throw new Response(null, { status: 302, headers: { Location: "/" } });
  }
  return { ok: false };
}

export default function GoalPage({ loaderData }: Route.ComponentProps) {
  const { goal, entries, day, process, streak, endScenes, signs, health } = loaderData;
  const nav = useNavigation();
  const busy = nav.state !== "idle";
  const generating = busy && nav.formData?.get("intent") === "process";
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
        <div className="mb-2 flex items-center justify-between">
          <h2 className="serif text-lg text-[var(--color-accent)]">Live in the end</h2>
          <Form method="post">
            <input type="hidden" name="intent" value="endscene" />
            <button className="text-xs text-[var(--color-muted)] hover:text-[var(--color-gold)]">
              regenerate
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

      {/* Journey log */}
      <section className="mb-8 rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] p-6">
        <h2 className="serif text-lg mb-3">Journey log</h2>
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
          <button className="rounded-lg bg-[var(--color-accent)] px-4 py-2 text-sm font-medium text-black hover:opacity-90">
            Log it
          </button>
        </Form>
        {entries.length === 0 ? (
          <p className="text-sm text-[var(--color-muted)]">No entries yet.</p>
        ) : (
          <ul className="space-y-3">
            {entries.map((e) => (
              <li key={e.id} className="border-l-2 border-[var(--color-line)] pl-3">
                <div className="flex items-center gap-2 text-xs text-[var(--color-muted)]">
                  <span className="uppercase tracking-wide text-[var(--color-accent)]">{e.kind}</span>
                  {e.state && <span>· {e.state}</span>}
                  <span>· {new Date(e.created_at).toLocaleString()}</span>
                </div>
                <p className="mt-0.5 text-sm text-[#ddd8ef]">{e.content}</p>
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
        <CoachChat />
      </section>

      {/* Status controls */}
      <section className="flex flex-wrap items-center gap-3">
        {goal.status !== "realised" && (
          <Form method="post">
            <input type="hidden" name="intent" value="status" />
            <input type="hidden" name="status" value="realised" />
            <button className="rounded-lg bg-[var(--color-gold)] px-4 py-2 text-sm font-medium text-black hover:bg-[var(--color-gold-dim)]">
              ✦ Mark realised
            </button>
          </Form>
        )}
        {goal.status === "active" && (
          <Form method="post">
            <input type="hidden" name="intent" value="status" />
            <input type="hidden" name="status" value="released" />
            <button className="rounded-lg border border-[var(--color-line)] px-4 py-2 text-sm text-[var(--color-muted)] hover:text-[var(--color-ink)]">
              Release
            </button>
          </Form>
        )}
        <Form method="post" onSubmit={(e) => !confirm("Delete this desire and its journey?") && e.preventDefault()}>
          <input type="hidden" name="intent" value="delete" />
          <button className="rounded-lg border border-[var(--color-line)] px-4 py-2 text-sm text-red-400/80 hover:text-red-400">
            Delete
          </button>
        </Form>
      </section>
    </main>
  );
}
