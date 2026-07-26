// Ollama client for generation (coach model) and for embedding the user's own
// journal. Corpus retrieval/embedding still belongs to LightRAG — this embedder
// exists only for `neville_entry_embeddings`.
import "dotenv/config";
const OLLAMA = process.env.OLLAMA_URL || "http://localhost:11434";
export const GEN_MODEL = process.env.GEN_MODEL || "gemma4:26b-mlx";

// Journal embedder. Deliberately its own env var rather than reusing GEN_MODEL
// (a chat model is not an embedder) and rather than reading lightrag.env's
// EMBEDDING_MODEL (that file is the container's env, not the web app's).
//
// It also does NOT have to be the corpus embedder. AGENTS.md's "embedding model
// + dim are frozen at ingest" is about LightRAG's index, where a query vector is
// compared against chunk vectors written months earlier. Journal vectors live in
// their own table with their own `model`/`dim` columns, are only ever compared
// against other journal vectors of the same dim, and `entriesMissingEmbedding`
// treats a model change as "needs re-embedding" — so switching this is a cheap
// self-healing backfill, not a re-index. Default is the small 768-dim embedder:
// fast, cheap to re-run, and small enough for pgvector's HNSW ceiling.
export const EMBED_MODEL = process.env.EMBED_MODEL || "nomic-embed-text";

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };

// GEN_TIMEOUT_MS (env, ms): guard against a wedged local model pinning a
// request — and its Postgres pool slot — forever. Big local coach models are
// genuinely slow, so the default is deliberately generous (5 min).
// A 0/unset/NaN/negative value means "use the default", never "no timeout":
// cf. LLM_TIMEOUT=0 making the LightRAG worker fail instantly.
const DEFAULT_GEN_TIMEOUT_MS = 300_000;
const rawGenTimeout = Number(process.env.GEN_TIMEOUT_MS);
const GEN_TIMEOUT_MS =
  Number.isFinite(rawGenTimeout) && rawGenTimeout > 0 ? rawGenTimeout : DEFAULT_GEN_TIMEOUT_MS;

// Embedding is a forward pass over a few hundred tokens — nothing like coach
// generation, so it gets its own much shorter budget. Same 0-means-default rule.
const DEFAULT_EMBED_TIMEOUT_MS = 30_000;
const rawEmbedTimeout = Number(process.env.EMBED_TIMEOUT_MS);
const EMBED_TIMEOUT_MS =
  Number.isFinite(rawEmbedTimeout) && rawEmbedTimeout > 0
    ? rawEmbedTimeout
    : DEFAULT_EMBED_TIMEOUT_MS;

// AbortSignal.any needs Node >= 20.3 and the README only promises Node 20+,
// so combine by hand.
function anySignal(signals: (AbortSignal | undefined)[]): AbortSignal {
  const ctrl = new AbortController();
  for (const s of signals) {
    if (!s) continue;
    if (s.aborted) {
      ctrl.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => ctrl.abort(s.reason), { once: true });
  }
  return ctrl.signal;
}

export async function chat(
  messages: ChatMsg[],
  opts?: { temperature?: number; signal?: AbortSignal }
): Promise<string> {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, GEN_TIMEOUT_MS);
  try {
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: GEN_MODEL,
        messages,
        stream: false,
        options: { temperature: opts?.temperature ?? 0.8 },
      }),
      signal: anySignal([ctrl.signal, opts?.signal]),
    });
    if (!res.ok) throw new Error(`ollama chat ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.message?.content ?? "";
  } catch (e) {
    if (timedOut) {
      throw new Error(`ollama chat timed out after GEN_TIMEOUT_MS=${GEN_TIMEOUT_MS}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Embeddings via POST /api/embed with { model, input }. Verified against a live
// Ollama: the reply is { model, embeddings: number[][], ... }. `input` accepts a
// string or an array of strings, and the array form returns one vector per input
// in order — one round trip per batch instead of one per entry.
// `embedding` (singular) is the older /api/embeddings shape; setup.sh reads
// `j.embeddings[0] || j.embedding`, so accept both.
export async function embedBatch(
  inputs: string[],
  opts?: { model?: string; signal?: AbortSignal }
): Promise<number[][]> {
  const model = opts?.model || EMBED_MODEL;
  const clean = inputs.map((s) => (typeof s === "string" ? s : String(s ?? "")));
  if (!clean.length) return [];
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, EMBED_TIMEOUT_MS);
  try {
    const res = await fetch(`${OLLAMA}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, input: clean }),
      signal: anySignal([ctrl.signal, opts?.signal]),
    });
    if (!res.ok) {
      // A missing embedder is a 404 with a "not found, try pulling it" body —
      // surface the model name so the fix is obvious in the log.
      throw new Error(`ollama embed ${res.status} (model ${model}): ${(await res.text()).slice(0, 200)}`);
    }
    const data = (await res.json()) as { embeddings?: unknown; embedding?: unknown };
    const raw = Array.isArray(data.embeddings)
      ? (data.embeddings as unknown[])
      : Array.isArray(data.embedding)
        ? [data.embedding as unknown]
        : [];
    const vectors = raw.map(coerceVector);
    // Guard the pgvector insert: a ragged or partial reply would poison the
    // table (mismatched dims silently drop out of every future search).
    if (vectors.length !== clean.length) {
      throw new Error(`ollama embed returned ${vectors.length} vectors for ${clean.length} inputs`);
    }
    const dim = vectors[0].length;
    if (vectors.some((v) => v.length !== dim)) {
      throw new Error("ollama embed returned vectors of differing dimensions");
    }
    return vectors;
  } catch (e) {
    if (timedOut) {
      throw new Error(`ollama embed timed out after EMBED_TIMEOUT_MS=${EMBED_TIMEOUT_MS}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function coerceVector(v: unknown): number[] {
  if (!Array.isArray(v) || !v.length) throw new Error("ollama embed returned an empty vector");
  const out = v.map(Number);
  if (out.some((n) => !Number.isFinite(n))) {
    throw new Error("ollama embed returned a non-finite component");
  }
  return out;
}

export async function embed(
  input: string,
  opts?: { model?: string; signal?: AbortSignal }
): Promise<number[]> {
  const [vec] = await embedBatch([input], opts);
  return vec;
}

// Health probe: reachable + GEN_MODEL pulled. Never throws.
export async function ollamaHealth(): Promise<{ ok: boolean; detail: string }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(`${OLLAMA}/api/tags`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return { ok: false, detail: `unreachable: ${res.status}` };
    const data = await res.json();
    const models: string[] = Array.isArray(data.models)
      ? data.models.map((m: { name?: string }) => m.name ?? "")
      : [];
    if (!models.includes(GEN_MODEL)) {
      return { ok: false, detail: `model ${GEN_MODEL} not pulled` };
    }
    return { ok: true, detail: "connected" };
  } catch (e) {
    return { ok: false, detail: `unreachable: ${(e as Error).message}` };
  }
}

// Streamed chat — yields content tokens as they arrive. The timeout here is an
// inactivity timer, not a duration cap: a long answer that keeps producing
// tokens must never be cut off mid-thought.
export async function* chatStream(
  messages: ChatMsg[],
  opts?: { temperature?: number; signal?: AbortSignal }
): AsyncGenerator<string> {
  const ctrl = new AbortController();
  let stalled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      stalled = true;
      ctrl.abort();
    }, GEN_TIMEOUT_MS);
  };
  arm();
  try {
    const res = await fetch(`${OLLAMA}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: GEN_MODEL,
        messages,
        stream: true,
        options: { temperature: opts?.temperature ?? 0.8 },
      }),
      signal: anySignal([ctrl.signal, opts?.signal]),
    });
    if (!res.ok || !res.body) throw new Error(`ollama stream ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      arm();
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const json = JSON.parse(line);
          if (json.message?.content) yield json.message.content;
        } catch {
          /* partial */
        }
      }
    }
  } catch (e) {
    if (stalled) {
      throw new Error(`ollama stream stalled: no tokens for GEN_TIMEOUT_MS=${GEN_TIMEOUT_MS}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
    // Runs on early generator return too — releases the upstream generation
    // when the consumer stops reading.
    ctrl.abort();
  }
}
