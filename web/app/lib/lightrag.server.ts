// LightRAG client: knowledge-graph + vector retrieval, and document insertion.
//
// Retrieval never invokes an LLM server-side — the coach model does all
// generation, so we only ever ask LightRAG for grounded context.
//
// Citations come from LightRAG's own per-chunk `file_path`, which is exactly the
// `file_source` we sent at ingest (a human title like "The Power of Awareness
// (1952)"). See ingest.mjs / corpus/manifest.json.
//
// Env:
//   LIGHTRAG_URL                 default http://localhost:9621
//   LIGHTRAG_API_KEY             default neville-local-key
//   LIGHTRAG_QUERY_TIMEOUT_MS    default 120000  — local retrieval can be slow
//   LIGHTRAG_STRUCTURED_QUERY    default on; "0"/"off" forces the legacy
//                                /query + only_need_context path
//   RETRIEVAL_CACHE              default on; "0"/"off" disables the cache
//   RETRIEVAL_CACHE_TTL_SEC      default 86400 (24h) — the corpus is static, so
//                                context for the same query is stable until a
//                                re-index (which the cache key already busts)
import "dotenv/config";
import crypto from "node:crypto";
import { log } from "./logger.server";

const BASE = process.env.LIGHTRAG_URL || "http://localhost:9621";
const API_KEY = process.env.LIGHTRAG_API_KEY || "neville-local-key";
const QUERY_TIMEOUT_MS = num(process.env.LIGHTRAG_QUERY_TIMEOUT_MS, 120_000);

function headers() {
  return { "Content-Type": "application/json", "X-API-Key": API_KEY };
}

function num(v: string | undefined, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

// Env flags read as on unless explicitly switched off.
function flagOn(v: string | undefined): boolean {
  if (v == null || v === "") return true;
  return !/^(0|off|false|no)$/i.test(v.trim());
}

export type QueryMode = "mix" | "hybrid" | "local" | "global" | "naive";

// `kind` records how the citation itself was obtained: "metadata" is LightRAG's
// own file_path (trustworthy); "heuristic" is the regex fallback (a guess).
export type Source = {
  title: string;
  snippet: string;
  refId?: string;
  kind?: "metadata" | "heuristic";
};

// LightRAG's request model rejects queries shorter than this (422).
const MIN_QUERY_LEN = 3;
// How many passages survive the local rerank — unchanged from the original.
const TOP_SEGMENTS = 12;
const MAX_SOURCES = 6;
// LightRAG joins multi-valued file_path fields with this, and marks overflow.
const FIELD_SEP = "<SEP>";
const PATH_PLACEHOLDERS = new Set(["unknown_source", "truncated", "unknown"]);

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------
type PostResult = { ok: boolean; status: number; body: unknown; text: string };

async function postJson(path: string, payload: unknown): Promise<PostResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), QUERY_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let body: unknown = undefined;
    try {
      body = text ? JSON.parse(text) : undefined;
    } catch {
      body = undefined; // non-JSON error page; `text` still carries the detail
    }
    return { ok: res.ok, status: res.status, body, text };
  } finally {
    clearTimeout(t);
  }
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// ---------------------------------------------------------------------------
// Local rerank (BM25-lite) — pure helpers, exported so they stay unit-testable
// ---------------------------------------------------------------------------
const STOPWORDS = new Set([
  "the","a","an","and","or","but","of","to","in","on","for","with","as","by",
  "at","is","are","was","were","be","been","it","this","that","these","those",
  "i","my","me","you","your","we","our","they","their","he","she","his","her",
  "from","into","about","so","if","then","than","not","no","do","does","did",
  "will","would","can","could","should","may","might","what","which","who",
]);

export function tokenize(s: string): string[] {
  if (typeof s !== "string") return [];
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

// Term-frequency of query terms in the segment, length-normalised (k1=1.5, b=0.75,
// pivot 200 tokens). Accepts a raw query string or pre-tokenized terms.
export function scoreSegment(query: string | string[] | Set<string>, segment: string): number {
  const qSet =
    query instanceof Set
      ? query
      : new Set(Array.isArray(query) ? query : tokenize(String(query ?? "")));
  if (!qSet.size) return 0;
  const segTokens = tokenize(segment);
  if (!segTokens.length) return 0;
  const tf = new Map<string, number>();
  for (const t of segTokens) if (qSet.has(t)) tf.set(t, (tf.get(t) ?? 0) + 1);
  let score = 0;
  for (const [, n] of tf) {
    score += (n * (1.5 + 1)) / (n + 1.5 * (0.25 + 0.75 * (segTokens.length / 200)));
  }
  return score;
}

// Highest-scoring segments first, capped at `limit`. Ties keep input order.
export function rerank(query: string, segments: string[], limit = TOP_SEGMENTS): string[] {
  const qSet = new Set(tokenize(query));
  if (segments.length <= 1 || !qSet.size) return segments.slice(0, limit);
  return segments
    .map((seg, i) => ({ seg, i, score: scoreSegment(qSet, seg) }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((s) => s.seg);
}

// Split a pre-formatted context blob into passage-ish segments (blank lines / list rows).
function splitBlob(blob: string): string[] {
  return blob
    .split(/\n\s*\n|(?:\r?\n)(?=\s*[-*]\s)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 40);
}

// ---------------------------------------------------------------------------
// Structured retrieval: POST /query/data
// ---------------------------------------------------------------------------
// This is the preferred path. It returns entities / relationships / chunks /
// references as JSON, each carrying `file_path`, so citations are metadata
// rather than a guess — and it is guaranteed not to run an LLM.
type Chunk = { content: string; path: string | null; refId: string | null };
type Structured = {
  chunks: Chunk[];
  entityLines: string[];
  relationLines: string[];
  refPaths: { path: string; refId: string | null }[];
};

// Remembered per process: older LightRAG builds have no /query/data at all, and
// there is no point paying a round-trip per retrieval to rediscover that.
let structuredSupported = flagOn(process.env.LIGHTRAG_STRUCTURED_QUERY);

// file_path may hold several sources joined by <SEP>; keep the first real one.
function cleanPath(raw: unknown): string | null {
  const s = str(raw);
  if (!s) return null;
  for (const part of s.split(FIELD_SEP)) {
    const p = part.trim().replace(/\.txt$/i, "");
    if (p && !PATH_PLACEHOLDERS.has(p.toLowerCase())) return p;
  }
  return null;
}

function parseStructured(payload: unknown): Structured | null {
  const root = asRecord(payload);
  // Documented shape is { status, message, data: {...}, metadata: {...} }, but
  // tolerate a build that returns the data object directly.
  const data = asRecord(root.data ?? root);
  const chunks: Chunk[] = [];
  for (const c of asArray(data.chunks)) {
    const rec = asRecord(c);
    const content = str(rec.content);
    if (!content) continue;
    chunks.push({
      content,
      path: cleanPath(rec.file_path ?? rec.file_source),
      refId: str(rec.reference_id),
    });
  }

  const entityLines: string[] = [];
  for (const e of asArray(data.entities)) {
    const rec = asRecord(e);
    const name = str(rec.entity_name) ?? str(rec.name);
    if (!name) continue;
    const type = str(rec.entity_type);
    const desc = str(rec.description);
    entityLines.push(`- ${name}${type ? ` (${type})` : ""}${desc ? `: ${desc}` : ""}`);
  }

  const relationLines: string[] = [];
  for (const r of asArray(data.relationships ?? data.relations)) {
    const rec = asRecord(r);
    const src = str(rec.src_id) ?? str(rec.source);
    const tgt = str(rec.tgt_id) ?? str(rec.target);
    if (!src || !tgt) continue;
    const desc = str(rec.description);
    relationLines.push(`- ${src} → ${tgt}${desc ? `: ${desc}` : ""}`);
  }

  const refPaths: { path: string; refId: string | null }[] = [];
  for (const r of asArray(data.references)) {
    const rec = asRecord(r);
    const path = cleanPath(rec.file_path ?? rec.file_source);
    if (path) refPaths.push({ path, refId: str(rec.reference_id) });
  }

  // Nothing usable — let the caller fall back rather than return an empty context.
  if (!chunks.length && !entityLines.length && !relationLines.length) return null;
  return { chunks, entityLines, relationLines, refPaths };
}

async function queryStructured(query: string, mode: QueryMode): Promise<Structured | null> {
  if (!structuredSupported) return null;
  let res: PostResult;
  try {
    res = await postJson("/query/data", { query, mode, include_references: true });
  } catch (e) {
    log.warn("lightrag", "/query/data request failed", {
      mode,
      error: (e as Error).message,
    });
    return null;
  }
  if (res.status === 404 || res.status === 405) {
    // This LightRAG build predates the structured endpoint. Stop asking.
    structuredSupported = false;
    log.info("lightrag", "/query/data unsupported; using /query + only_need_context", {
      status: res.status,
    });
    return null;
  }
  if (!res.ok) {
    log.warn("lightrag", "/query/data returned an error", {
      status: res.status,
      detail: res.text.slice(0, 300),
    });
    return null;
  }
  const parsed = parseStructured(res.body);
  if (!parsed) log.warn("lightrag", "/query/data returned no usable chunks or graph data", { mode });
  return parsed;
}

// Assemble the coach-facing context. Entities/relations are kept because the
// graph (not just nearest-chunk) is the whole point of this stack; passages are
// labelled with their real source so the model quotes the right book.
function buildStructuredText(query: string, s: Structured): string {
  const parts: string[] = [];
  if (s.entityLines.length) {
    parts.push(`## Concepts\n${s.entityLines.slice(0, 40).join("\n")}`);
  }
  if (s.relationLines.length) {
    parts.push(`## How they connect\n${s.relationLines.slice(0, 40).join("\n")}`);
  }
  if (s.chunks.length) {
    // Rerank the real chunks, then re-attach each one's source label.
    const byContent = new Map<string, Chunk>();
    for (const c of s.chunks) if (!byContent.has(c.content)) byContent.set(c.content, c);
    const top = rerank(query, [...byContent.keys()], TOP_SEGMENTS);
    const passages = top.map((content) => {
      const c = byContent.get(content)!;
      return `${c.path ? `[${c.path}]\n` : ""}${content}`;
    });
    parts.push(`## Passages\n\n${passages.join("\n\n")}`);
  }
  return parts.join("\n\n").trim();
}

function sourcesFromStructured(s: Structured): Source[] {
  const out: Source[] = [];
  const seen = new Set<string>();
  // Chunks first: they carry the passage text, which makes a real snippet.
  for (const c of s.chunks) {
    if (!c.path) continue;
    const key = c.path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      title: c.path,
      snippet: c.content.replace(/\s+/g, " ").trim().slice(0, 160),
      ...(c.refId ? { refId: c.refId } : {}),
      kind: "metadata",
    });
    if (out.length >= MAX_SOURCES) return out;
  }
  // Then any reference LightRAG listed that had no chunk of its own.
  for (const r of s.refPaths) {
    const key = r.path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ title: r.path, snippet: "", ...(r.refId ? { refId: r.refId } : {}), kind: "metadata" });
    if (out.length >= MAX_SOURCES) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Legacy retrieval: POST /query with only_need_context
// ---------------------------------------------------------------------------
// Returns one pre-formatted context string. Newer builds also return a
// `references` array with file_path, which is still real metadata — so we take
// it when it is there.
type LegacyResult = { blob: string; refPaths: { path: string; refId: string | null }[] };

async function queryLegacy(query: string, mode: QueryMode): Promise<LegacyResult> {
  const res = await postJson("/query", {
    query,
    mode,
    only_need_context: true,
    include_references: true,
  });
  if (!res.ok) throw new Error(`lightrag query ${res.status}: ${res.text.slice(0, 500)}`);
  const root = asRecord(res.body);
  const blob = typeof root.response === "string" ? root.response : res.text;
  const refPaths: { path: string; refId: string | null }[] = [];
  for (const r of asArray(root.references)) {
    const rec = asRecord(r);
    const path = cleanPath(rec.file_path ?? rec.file_source);
    if (path) refPaths.push({ path, refId: str(rec.reference_id) });
  }
  return { blob, refPaths };
}

// Retrieve grounded context only (we do generation ourselves for voice control).
export async function retrieveContext(query: string, mode: QueryMode = "mix"): Promise<string> {
  const s = await queryStructured(query, mode);
  if (s) return buildStructuredText(query, s);
  return (await queryLegacy(query, mode)).blob;
}

// ---------------------------------------------------------------------------
// LAST-RESORT source extraction — a guess, not metadata
// ---------------------------------------------------------------------------
// Used ONLY when LightRAG gave us no file_path at all (very old build, or docs
// ingested without a file_source). It pattern-matches capitalised prose followed
// by a parenthesised year, so it can and does invent titles. Anything it returns
// is tagged kind:"heuristic" and logged — prefer showing nothing over showing
// this if you ever have to choose.
function extractSourcesHeuristic(blob: string): Source[] {
  const out: Source[] = [];
  const seen = new Set<string>();
  try {
    const re = /([A-Z][\w'’&:,\- ]{3,80}\((?:c\.?\s*)?\d{4}\))/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(blob)) && out.length < MAX_SOURCES) {
      const title = m[1].replace(/\s+/g, " ").trim();
      const key = title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const idx = m.index;
      const snippet = blob.slice(Math.max(0, idx - 20), idx + 120).replace(/\s+/g, " ").trim();
      out.push({ title, snippet, kind: "heuristic" });
    }
  } catch (e) {
    log.warn("lightrag", "heuristic source extraction failed", { error: (e as Error).message });
    return [];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Retrieval cache
// ---------------------------------------------------------------------------
// Bump when the assembled context shape changes — old rows would otherwise be
// served in the new format's place.
const CACHE_SHAPE_VERSION = "2";
const CACHE_ENABLED = flagOn(process.env.RETRIEVAL_CACHE);
const CACHE_TTL_SEC = num(process.env.RETRIEVAL_CACHE_TTL_SEC, 86_400);

// db.server imports getEmbeddingConfig from this module, so importing it
// statically would create a cycle. Load it lazily instead (module cache makes
// repeat calls free).
async function dbModule() {
  return import("./db.server");
}

// The embedding model + dim are frozen at ingest (see AGENTS.md): if they change,
// the graph has been re-indexed and every cached context is stale. Fold them
// into the key so a re-index invalidates the cache instead of poisoning it.
// Memoised because this costs a /health round-trip.
let embedCfg: { at: number; model: string | null; dim: number | null } | null = null;
const EMBED_CFG_TTL_MS = 5 * 60_000;
const EMBED_CFG_RETRY_MS = 15_000;

async function cachedEmbeddingConfig(): Promise<{ model: string | null; dim: number | null }> {
  const now = Date.now();
  if (embedCfg) {
    const known = embedCfg.model != null || embedCfg.dim != null;
    const ttl = known ? EMBED_CFG_TTL_MS : EMBED_CFG_RETRY_MS;
    if (now - embedCfg.at < ttl) return { model: embedCfg.model, dim: embedCfg.dim };
  }
  const cfg = await getEmbeddingConfig();
  embedCfg = { at: now, ...cfg };
  return cfg;
}

function normaliseQuery(q: string): string {
  return q.replace(/\s+/g, " ").trim().toLowerCase();
}

async function cacheKey(query: string, mode: QueryMode): Promise<string> {
  const { model, dim } = await cachedEmbeddingConfig();
  const material = [
    CACHE_SHAPE_VERSION,
    model ?? "unknown-model",
    String(dim ?? "unknown-dim"),
    mode,
    normaliseQuery(query),
  ].join(" ");
  return crypto.createHash("sha256").update(material).digest("hex");
}

// JSONB comes back as `unknown` — validate before handing it to callers that do
// `sources.map(s => s.title)`.
function coerceSources(v: unknown): Source[] {
  const out: Source[] = [];
  for (const item of asArray(v)) {
    const rec = asRecord(item);
    const title = str(rec.title);
    if (!title) continue;
    const kind = rec.kind === "heuristic" ? "heuristic" : "metadata";
    const refId = str(rec.refId);
    out.push({
      title,
      snippet: typeof rec.snippet === "string" ? rec.snippet : "",
      ...(refId ? { refId } : {}),
      kind,
    });
  }
  return out;
}

async function readCache(
  key: string
): Promise<{ text: string; sources: Source[] } | undefined> {
  try {
    const { getCachedRetrieval } = await dbModule();
    const row = await getCachedRetrieval(key, CACHE_TTL_SEC);
    if (!row || !row.text) return undefined;
    return { text: row.text, sources: coerceSources(row.sources) };
  } catch (e) {
    // Never let a DB problem break retrieval — just retrieve for real.
    log.warn("lightrag", "retrieval cache read failed", { error: (e as Error).message });
    return undefined;
  }
}

let lastPruneAt = 0;
const PRUNE_INTERVAL_MS = 60 * 60_000;

async function writeCache(
  key: string,
  query: string,
  mode: QueryMode,
  text: string,
  sources: Source[]
): Promise<void> {
  try {
    const { putCachedRetrieval, pruneRetrievalCache } = await dbModule();
    await putCachedRetrieval(key, query, mode, text, sources);
    // Opportunistic housekeeping: expired rows are dead weight and nothing else
    // sweeps this table. At most once an hour per process.
    const now = Date.now();
    if (now - lastPruneAt > PRUNE_INTERVAL_MS) {
      lastPruneAt = now;
      const removed = await pruneRetrievalCache(CACHE_TTL_SEC);
      if (removed) log.debug("lightrag", "pruned expired retrieval cache rows", { removed });
    }
  } catch (e) {
    log.warn("lightrag", "retrieval cache write failed", { error: (e as Error).message });
  }
}

// ---------------------------------------------------------------------------
// Public retrieval
// ---------------------------------------------------------------------------
// Retrieve grounded context, locally rerank passages, and cite real sources.
export async function retrieve(
  query: string,
  mode: QueryMode = "mix",
  opts?: { noCache?: boolean }
): Promise<{ text: string; sources: Source[] }> {
  if (typeof query !== "string" || query.trim().length < MIN_QUERY_LEN) {
    log.warn("lightrag", "query too short to retrieve", { length: query?.length ?? 0 });
    return { text: "", sources: [] };
  }

  const useCache = CACHE_ENABLED && !opts?.noCache;
  let key: string | null = null;
  if (useCache) {
    key = await cacheKey(query, mode).catch((e) => {
      log.warn("lightrag", "cache key derivation failed", { error: (e as Error).message });
      return null;
    });
    if (key) {
      const hit = await readCache(key);
      if (hit) {
        log.debug("lightrag", "retrieval cache hit", { mode, sources: hit.sources.length });
        return hit;
      }
    }
  }

  const result = await retrieveFresh(query, mode);
  // Never cache an empty or failed retrieval — it would pin the failure for the
  // whole TTL.
  if (key && result.text.trim()) {
    await writeCache(key, query, mode, result.text, result.sources);
  }
  return result;
}

async function retrieveFresh(
  query: string,
  mode: QueryMode
): Promise<{ text: string; sources: Source[] }> {
  const s = await queryStructured(query, mode);
  if (s) {
    const sources = sourcesFromStructured(s);
    if (!sources.length) {
      log.warn("lightrag", "structured retrieval carried no file_path metadata", { mode });
    }
    return { text: buildStructuredText(query, s), sources };
  }

  // Legacy path: one context blob, plus references if this build sends them.
  const { blob, refPaths } = await queryLegacy(query, mode);
  const segments = splitBlob(blob);
  const text = segments.length > 1 ? rerank(query, segments).join("\n\n") : blob;

  if (refPaths.length) {
    const sources: Source[] = [];
    const seen = new Set<string>();
    for (const r of refPaths) {
      const k = r.path.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      sources.push({
        title: r.path,
        snippet: "",
        ...(r.refId ? { refId: r.refId } : {}),
        kind: "metadata",
      });
      if (sources.length >= MAX_SOURCES) break;
    }
    return { text, sources };
  }

  // No metadata anywhere. Guess, and be loud about it.
  const guessed = extractSourcesHeuristic(blob);
  log.warn("lightrag", "no source metadata; falling back to heuristic title scraping", {
    mode,
    guessed: guessed.length,
  });
  return { text, sources: guessed };
}

// ---------------------------------------------------------------------------
// Health / config / insertion
// ---------------------------------------------------------------------------
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
  } catch (e) {
    log.warn("lightrag", "embedding config lookup failed", { error: (e as Error).message });
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
// `source` becomes the document's file_path — i.e. the citation users will see.
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
