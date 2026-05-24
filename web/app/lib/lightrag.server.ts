// LightRAG client: knowledge-graph + vector retrieval, and document insertion.
import "dotenv/config";
const BASE = process.env.LIGHTRAG_URL || "http://localhost:9621";
const API_KEY = process.env.LIGHTRAG_API_KEY || "neville-local-key";

function headers() {
  return { "Content-Type": "application/json", "X-API-Key": API_KEY };
}

export type QueryMode = "mix" | "hybrid" | "local" | "global" | "naive";

// Retrieve grounded context only (we do generation ourselves for voice control).
export async function retrieveContext(query: string, mode: QueryMode = "mix"): Promise<string> {
  const res = await fetch(`${BASE}/query`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ query, mode, only_need_context: true }),
  });
  if (!res.ok) throw new Error(`lightrag query ${res.status}: ${await res.text()}`);
  const data = await res.json();
  // Server returns { response: <context string> } when only_need_context is true.
  return typeof data.response === "string" ? data.response : JSON.stringify(data);
}

export type Source = { title: string; snippet: string };

const STOPWORDS = new Set([
  "the","a","an","and","or","but","of","to","in","on","for","with","as","by",
  "at","is","are","was","were","be","been","it","this","that","these","those",
  "i","my","me","you","your","we","our","they","their","he","she","his","her",
  "from","into","about","so","if","then","than","not","no","do","does","did",
  "will","would","can","could","should","may","might","what","which","who",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

// Retrieve grounded context, locally rerank passages, and extract book sources.
export async function retrieve(
  query: string,
  mode: QueryMode = "mix"
): Promise<{ text: string; sources: Source[] }> {
  const blob = await retrieveContext(query, mode);
  let text = blob;
  try {
    // Split the context blob into passage segments (blank lines / list rows).
    const raw = blob
      .split(/\n\s*\n|(?:\r?\n)(?=\s*[-*]\s)/)
      .map((s) => s.trim())
      .filter((s) => s.length > 40);
    if (raw.length > 1) {
      const qTokens = tokenize(query);
      const qSet = new Set(qTokens);
      // BM25-lite: term-frequency of query terms in the segment, length-normalised.
      const scored = raw.map((seg) => {
        const segTokens = tokenize(seg);
        const tf = new Map<string, number>();
        for (const t of segTokens) if (qSet.has(t)) tf.set(t, (tf.get(t) ?? 0) + 1);
        let score = 0;
        for (const [, n] of tf) score += (n * (1.5 + 1)) / (n + 1.5 * (0.25 + 0.75 * (segTokens.length / 200)));
        return { seg, score };
      });
      scored.sort((a, b) => b.score - a.score);
      const top = scored.slice(0, 12).map((s) => s.seg);
      if (top.length) text = top.join("\n\n");
    }
  } catch {
    text = blob;
  }
  return { text, sources: extractSources(blob) };
}

// Best-effort extraction of distinct human book titles referenced in the blob.
function extractSources(blob: string): Source[] {
  const out: Source[] = [];
  const seen = new Set<string>();
  try {
    // Titles look like "The Power of Awareness (1952)" — capitalised words + (year).
    const re = /([A-Z][\w'’&:,\- ]{3,80}\((?:c\.?\s*)?\d{4}\))/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(blob)) && out.length < 6) {
      const title = m[1].replace(/\s+/g, " ").trim();
      const key = title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const idx = m.index;
      const snippet = blob.slice(Math.max(0, idx - 20), idx + 120).replace(/\s+/g, " ").trim();
      out.push({ title, snippet });
    }
  } catch {
    return [];
  }
  return out;
}

// Pull embedding model + dim from the /health config. Never throws.
export async function getEmbeddingConfig(): Promise<{ model: string | null; dim: number | null }> {
  try {
    const data = (await health()) as Record<string, unknown>;
    const cfg = (data.configuration ?? data) as Record<string, unknown>;
    const model =
      (cfg.embedding_model as string) ??
      (cfg.embedding_binding as string) ??
      (data.embedding_model as string) ??
      null;
    const dimRaw =
      (cfg.embedding_dim as number) ??
      (cfg.embedding_dimension as number) ??
      (data.embedding_dim as number) ??
      null;
    const dim = typeof dimRaw === "number" ? dimRaw : dimRaw != null ? Number(dimRaw) || null : null;
    return { model: model ?? null, dim };
  } catch {
    return { model: null, dim: null };
  }
}

// Quick reachability probe with a short timeout. Never throws.
export async function healthStatus(): Promise<{ ok: boolean; detail: string }> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(`${BASE}/health`, { headers: headers(), signal: ctrl.signal });
    clearTimeout(t);
    return res.ok
      ? { ok: true, detail: "connected" }
      : { ok: false, detail: `unreachable: ${res.status}` };
  } catch (e) {
    return { ok: false, detail: `unreachable: ${(e as Error).message}` };
  }
}

// Insert a document (book / lecture) for indexing into the KG + vector store.
export async function insertText(text: string, source: string): Promise<unknown> {
  const res = await fetch(`${BASE}/documents/text`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ text, file_source: source }),
  });
  if (!res.ok) throw new Error(`lightrag insert ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function health(): Promise<unknown> {
  const res = await fetch(`${BASE}/health`, { headers: headers() });
  return res.json();
}
