import { Form, Link, redirect, useNavigation } from "react-router";
import type { Route } from "./+types/home";
import { listGoals, createGoal } from "../lib/db.server";
import { requireUser } from "../lib/auth.server";
import { generateEndScene } from "../lib/coach.server";
import { healthStatus } from "../lib/lightrag.server";
import { ollamaHealth } from "../lib/ollama.server";
import Onboarding from "../components/Onboarding";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "The Law — Neville Manifestation Engine" },
    { name: "description", content: "Set a desire. Live in the end. Be guided until it is realised." },
  ];
}

async function corpusGraph() {
  // Best-effort corpus/graph status (don't fail the page if LightRAG is busy).
  let graph = { ready: false, processing: 0, processed: 0 };
  try {
    const base = process.env.LIGHTRAG_URL || "http://localhost:9621";
    const key = process.env.LIGHTRAG_API_KEY || "neville-local-key";
    const r = await fetch(`${base}/documents/status_counts`, { headers: { "X-API-Key": key } });
    if (r.ok) {
      const c = (await r.json()).status_counts ?? {};
      graph = {
        ready: (c.PROCESSED ?? 0) > 0 && (c.PROCESSING ?? 0) === 0 && (c.PENDING ?? 0) === 0,
        processing: (c.PROCESSING ?? 0) + (c.PENDING ?? 0),
        processed: c.PROCESSED ?? 0,
      };
    }
  } catch {
    /* ignore */
  }
  return graph;
}

async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch {
    return fallback;
  }
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await requireUser(request);
  const [goals, graph, lightrag, ollama] = await Promise.all([
    listGoals(user.id),
    corpusGraph(),
    safe(healthStatus(), { ok: true, detail: "" }),
    safe(ollamaHealth(), { ok: true, detail: "" }),
  ]);
  return { goals, graph, health: { lightrag, ollama } };
}

export async function action({ request }: Route.ActionArgs) {
  const user = await requireUser(request);
  const fd = await request.formData();
  const title = String(fd.get("title") ?? "").trim();
  const desire = String(fd.get("desire") ?? "").trim();
  if (!title || !desire) return { error: "Give your wish a name and describe it." };
  const endScene = await generateEndScene(desire);
  const goal = await createGoal(user.id, title, desire, endScene);
  return redirect(`/goal/${goal.id}`);
}

type HealthEntry = { ok: boolean; detail: string };
type DriftEntry = { ok: boolean; message: string | null };

export function HealthBanner({
  health,
}: {
  health: { lightrag?: HealthEntry; ollama?: HealthEntry; drift?: DriftEntry };
}) {
  const issues: string[] = [];
  if (health.ollama && !health.ollama.ok)
    issues.push(`⚠ Ollama unreachable — ${health.ollama.detail || "start it to generate guidance."}`);
  if (health.lightrag && !health.lightrag.ok)
    issues.push(`⚠ LightRAG unreachable — ${health.lightrag.detail || "the knowledge graph is offline."}`);
  if (health.drift && !health.drift.ok)
    issues.push(`⚠ ${health.drift.message || "Embedding drift detected — re-index the corpus."}`);
  if (issues.length === 0) return null;
  return (
    <div className="mb-6 space-y-1 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
      {issues.map((msg, i) => (
        <p key={i}>{msg}</p>
      ))}
    </div>
  );
}

export default function Home({ loaderData, actionData }: Route.ComponentProps) {
  const { goals, graph, health } = loaderData;
  const nav = useNavigation();
  const creating = nav.state !== "idle" && nav.formAction === "/";

  return (
    <main className="mx-auto max-w-3xl px-5 py-12">
      <HealthBanner health={health} />
      <header className="mb-10">
        <h1 className="serif text-4xl text-[var(--color-gold)] tracking-wide">The Law</h1>
        <p className="mt-2 text-[var(--color-muted)]">
          Assume the feeling of the wish fulfilled. Name a desire — be guided, in Neville's own
          teaching, until it is realised.
        </p>
        <div className="mt-3 text-xs text-[var(--color-muted)]">
          {graph.ready ? (
            <span className="text-[var(--color-accent)]">● Knowledge graph ready ({graph.processed} sources)</span>
          ) : graph.processing > 0 ? (
            <span className="text-[var(--color-gold-dim)]">◐ Building knowledge graph… {graph.processing} indexing</span>
          ) : (
            <span>○ Corpus not yet indexed</span>
          )}{" "}
          ·{" "}
          <a className="underline hover:text-[var(--color-gold)]" href="http://localhost:9621" target="_blank" rel="noreferrer">
            explore the graph ↗
          </a>
        </div>
      </header>

      <section className="mb-12 rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] p-6">
        <h2 className="serif text-xl mb-4">Name a new desire</h2>
        <Form method="post" className="space-y-3">
          <input
            name="title"
            placeholder="A short name — e.g. “Lead designer role”"
            className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-base)] px-4 py-2.5 outline-none focus:border-[var(--color-gold-dim)]"
          />
          <textarea
            name="desire"
            rows={3}
            placeholder="Describe it as already done — what is true now that it is yours?"
            className="w-full rounded-lg border border-[var(--color-line)] bg-[var(--color-base)] px-4 py-2.5 outline-none focus:border-[var(--color-gold-dim)]"
          />
          {actionData?.error && <p className="text-sm text-red-400">{actionData.error}</p>}
          <button
            disabled={creating}
            className="rounded-lg bg-[var(--color-gold)] px-5 py-2.5 font-medium text-black transition hover:bg-[var(--color-gold-dim)] disabled:opacity-50"
          >
            {creating ? "Composing your end-scene…" : "Begin"}
          </button>
        </Form>
      </section>

      <section>
        <h2 className="serif text-xl mb-4 text-[var(--color-muted)]">Your desires</h2>
        {goals.length === 0 ? (
          <Onboarding />
        ) : (
          <ul className="space-y-3">
            {goals.map((g) => (
              <li key={g.id}>
                <Link
                  to={`/goal/${g.id}`}
                  className="block rounded-xl border border-[var(--color-line)] bg-[var(--color-panel)] px-5 py-4 transition hover:border-[var(--color-gold-dim)]"
                >
                  <div className="flex items-center justify-between">
                    <span className="serif text-lg">{g.title}</span>
                    <StatusBadge status={g.status} />
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-[var(--color-muted)]">{g.desire}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: "text-[var(--color-accent)] border-[var(--color-accent)]",
    realised: "text-[var(--color-gold)] border-[var(--color-gold)]",
    released: "text-[var(--color-muted)] border-[var(--color-line)]",
  };
  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-xs ${map[status] ?? map.active}`}>
      {status}
    </span>
  );
}
