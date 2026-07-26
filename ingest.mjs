// Ingest the corpus into LightRAG (knowledge graph + vectors).
//
// Metadata lives in corpus/manifest.json, not in this script — the title we send
// as `file_source` becomes the document's `file_path` in LightRAG, which is
// exactly what the app cites to the user (see web/app/lib/lightrag.server.ts).
// Books sit in corpus/, lectures in corpus/lectures/ (recursed), so new lectures
// drop in without touching code.
//
// Indexing is expensive — hours for the whole corpus on a local box — so this
// script no longer blindly re-submits everything. Use --skip-existing and/or
// --only to ingest just what is new.
//
// Usage:
//   node ingest.mjs                        # submit every corpus file
//   node ingest.mjs --dry-run              # report what would be submitted
//   node ingest.mjs --skip-existing        # skip docs LightRAG already knows
//   node ingest.mjs --only power-of        # substring match on path or title
//   node ingest.mjs --only '/lecture-0\d/' # or a /regex/
//   node ingest.mjs --kind lecture         # only manifest kind=lecture
//   node ingest.mjs --limit 5
//
// Env: LIGHTRAG_URL (default http://localhost:9621)
//      LIGHTRAG_API_KEY (default neville-local-key)
//
// Exits non-zero if any file failed; one bad file no longer aborts the run.
import fs from "fs";
import path from "path";

const BASE = process.env.LIGHTRAG_URL || "http://localhost:9621";
const KEY = process.env.LIGHTRAG_API_KEY || "neville-local-key";
const HEADERS = { "Content-Type": "application/json", "X-API-Key": KEY };

const CORPUS = path.join(process.cwd(), "corpus");
const MANIFEST = path.join(CORPUS, "manifest.json");

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { only: null, kind: null, skipExisting: false, dryRun: false, limit: 0 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--skip-existing") out.skipExisting = true;
    else if (a === "--only") out.only = argv[++i];
    else if (a === "--kind") out.kind = argv[++i];
    else if (a === "--limit") out.limit = Number(argv[++i]) || 0;
    else {
      console.error(`Unknown argument: ${a}\nRun with --help for usage.`);
      process.exit(2);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.help) {
  console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(0, 25).join("\n"));
  process.exit(0);
}

// "/foo/i" is treated as a regex; anything else as a case-insensitive substring.
function makeMatcher(pattern) {
  if (!pattern) return () => true;
  const m = /^\/(.*)\/([a-z]*)$/.exec(pattern);
  if (m) {
    const re = new RegExp(m[1], m[2] || "i");
    return (...fields) => fields.some((f) => re.test(f));
  }
  const needle = pattern.toLowerCase();
  return (...fields) => fields.some((f) => f.toLowerCase().includes(needle));
}

const matches = makeMatcher(args.only);

// ---------------------------------------------------------------------------
// Manifest
// ---------------------------------------------------------------------------
function loadManifest() {
  try {
    const raw = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
    const sources = raw && typeof raw.sources === "object" ? raw.sources : {};
    // Index under several spellings so a manifest key may be the corpus-relative
    // path, the bare filename, or the filename without .txt.
    const index = new Map();
    for (const [key, meta] of Object.entries(sources)) {
      if (!meta || typeof meta !== "object") continue;
      const base = path.basename(key);
      for (const k of [key, base, base.replace(/\.txt$/i, "")]) {
        index.set(k.toLowerCase(), { ...meta, manifestKey: key });
      }
    }
    return { index, keys: Object.keys(sources) };
  } catch (e) {
    if (e.code === "ENOENT") {
      console.warn(`WARN: no ${path.relative(process.cwd(), MANIFEST)} — titles will come from filenames.`);
      return { index: new Map(), keys: [] };
    }
    console.error(`ERROR: could not read ${MANIFEST}: ${e.message}`);
    process.exit(1);
  }
}

const manifest = loadManifest();

// Fallback for files absent from the manifest: same derivation as before.
function titleFromFilename(rel) {
  return path
    .basename(rel)
    .replace(/\.txt$/i, "")
    .replace(/^neville-goddard_/, "")
    .replace(/[-_]/g, " ")
    .trim();
}

function lookupMeta(rel) {
  const base = path.basename(rel);
  return (
    manifest.index.get(rel.toLowerCase()) ??
    manifest.index.get(base.toLowerCase()) ??
    manifest.index.get(base.replace(/\.txt$/i, "").toLowerCase()) ??
    null
  );
}

// ---------------------------------------------------------------------------
// Discovery: corpus/*.txt (books) + corpus/lectures/**/*.txt (lectures)
// ---------------------------------------------------------------------------
function walk(dir, acc = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, acc);
    else if (ent.isFile() && ent.name.toLowerCase().endsWith(".txt")) acc.push(full);
  }
  return acc;
}

function discover() {
  if (!fs.existsSync(CORPUS)) {
    console.error(`ERROR: ${CORPUS} does not exist.`);
    process.exit(1);
  }
  const files = fs
    .readdirSync(CORPUS, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".txt"))
    .map((e) => path.join(CORPUS, e.name));

  const lecturesDir = path.join(CORPUS, "lectures");
  if (fs.existsSync(lecturesDir) && fs.statSync(lecturesDir).isDirectory()) {
    files.push(...walk(lecturesDir));
  }

  return files
    .map((full) => {
      const rel = path.relative(CORPUS, full).split(path.sep).join("/");
      const meta = lookupMeta(rel);
      // Anything under lectures/ is a lecture unless the manifest says otherwise.
      const kind = meta?.kind || (rel.startsWith("lectures/") ? "lecture" : "book");
      return {
        rel,
        full,
        title: meta?.title || titleFromFilename(rel),
        kind,
        year: meta?.year ?? null,
        inManifest: !!meta,
      };
    })
    .sort((a, b) => a.rel.localeCompare(b.rel));
}

// ---------------------------------------------------------------------------
// Cleaning
// ---------------------------------------------------------------------------
// Publisher boilerplate from the Global Grey ebook PDFs — strip so it doesn't
// become spurious graph entities.
const BOILER = [
  /globalgrey/i,
  /this ebook edition was published/i,
  /this book can be found on the site/i,
  /^\s*global grey\s*(\d{4})?\s*$/i,
  /^\s*first published in\b/i,
  // Decorative rules and end markers left by pdftotext.
  /^\s*\*{3,}\s*$/,
  /^\s*(the\s+)?end\s*$/i,
];

// Global Grey closes several books with a personal note from the publisher
// ("I'm Julie, and I run Global Grey...", donation appeals, Amazon warnings).
// It is pure publisher chatter and would otherwise mint entities like "Julie"
// and "Amazon" into the graph — cut it and everything after it.
const AFTERWORD = /^.*\bI(?:'|’)?m Julie\b.*$/im;

// Strip page-breaks, page numbers, publisher boilerplate; collapse whitespace.
function clean(raw) {
  let s = raw.replace(/\r\n/g, "\n").replace(/\f/g, "\n"); // form-feed page breaks
  const cut = AFTERWORD.exec(s);
  if (cut) s = s.slice(0, cut.index);
  return s
    .split("\n")
    .filter((l) => !/^\s*\d+\s*$/.test(l)) // lone page numbers
    .filter((l) => !BOILER.some((re) => re.test(l)))
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ---------------------------------------------------------------------------
// LightRAG
// ---------------------------------------------------------------------------
async function insert(text, source) {
  const res = await fetch(`${BASE}/documents/text`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({ text, file_source: source }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${body}`);
  return body;
}

// Every doc object LightRAG returns carries `file_path`; the listing endpoint's
// shape has changed across versions (grouped-by-status vs paginated), so just
// walk the JSON and harvest file_path/status pairs wherever they appear.
function harvestDocs(node, out) {
  if (Array.isArray(node)) {
    for (const n of node) harvestDocs(n, out);
    return out;
  }
  if (node && typeof node === "object") {
    const fp = node.file_path;
    if (typeof fp === "string" && fp.trim()) {
      out.set(fp.trim(), typeof node.status === "string" ? node.status : "unknown");
    }
    for (const v of Object.values(node)) harvestDocs(v, out);
  }
  return out;
}

// Returns Map<file_path, status>, or null if LightRAG could not be asked.
async function fetchKnownDocs() {
  const known = new Map();
  // Preferred: paginated listing (newer builds; page_size caps at 200).
  try {
    for (let page = 1; page <= 50; page++) {
      const res = await fetch(`${BASE}/documents/paginated`, {
        method: "POST",
        headers: HEADERS,
        body: JSON.stringify({ page, page_size: 200 }),
      });
      if (res.status === 404 || res.status === 405) throw new Error("not supported");
      if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = JSON.parse(await res.text());
      const before = known.size;
      harvestDocs(data, known);
      const totalPages = Number(data?.pagination?.total_pages ?? 0);
      if (known.size === before || (totalPages && page >= totalPages)) break;
    }
    if (known.size) return known;
  } catch {
    /* fall through to the older grouped listing */
  }
  try {
    const res = await fetch(`${BASE}/documents`, { headers: HEADERS });
    if (!res.ok) throw new Error(`${res.status}: ${(await res.text()).slice(0, 200)}`);
    return harvestDocs(JSON.parse(await res.text()), known);
  } catch (e) {
    console.warn(`WARN: could not list existing documents (${e.message}); not skipping anything.`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const all = discover();
  if (!all.length) {
    console.error(`ERROR: no .txt files found under ${CORPUS}.`);
    process.exit(1);
  }

  // Stale manifest entries: a title recorded for a file that is not there.
  const present = new Set(all.map((d) => d.rel.toLowerCase()));
  for (const key of manifest.keys) {
    const k = key.toLowerCase();
    if (!present.has(k) && !present.has(path.basename(k))) {
      console.warn(`WARN: manifest entry has no file: ${key}`);
    }
  }

  // Titles are LightRAG's document identity — a collision would silently merge
  // two sources under one citation. Refuse rather than corrupt the graph.
  const byTitle = new Map();
  for (const d of all) {
    const k = d.title.toLowerCase();
    if (byTitle.has(k)) {
      console.error(`ERROR: duplicate title "${d.title}" from ${byTitle.get(k)} and ${d.rel}`);
      console.error("Give each source a distinct `title` in corpus/manifest.json.");
      process.exit(1);
    }
    byTitle.set(k, d.rel);
  }

  const unlisted = all.filter((d) => !d.inManifest);
  if (unlisted.length) {
    console.warn(
      `WARN: ${unlisted.length} file(s) missing from corpus/manifest.json — using a filename-derived title:`
    );
    for (const d of unlisted) console.warn(`  ${d.rel}  ->  "${d.title}"`);
    console.warn("Add them to the manifest so citations read properly.\n");
  }

  let selected = all.filter((d) => matches(d.rel, d.title));
  if (args.kind) selected = selected.filter((d) => d.kind === args.kind);

  let known = null;
  if (args.skipExisting) {
    known = await fetchKnownDocs();
  }

  const skipped = [];
  if (known) {
    selected = selected.filter((d) => {
      const status = known.get(d.title);
      if (status === undefined) return true;
      skipped.push({ ...d, status });
      return false;
    });
  }

  if (args.limit > 0) selected = selected.slice(0, args.limit);

  console.log(`LightRAG: ${BASE}`);
  console.log(
    `Corpus: ${all.length} file(s) (${all.filter((d) => d.kind === "book").length} book, ` +
      `${all.filter((d) => d.kind === "lecture").length} lecture)`
  );
  if (skipped.length) {
    console.log(`Already in LightRAG, skipping ${skipped.length}:`);
    for (const d of skipped) console.log(`  - ${d.title} [${d.status}]`);
    const failed = skipped.filter((d) => /fail/i.test(d.status));
    if (failed.length) {
      console.log(`  (${failed.length} are FAILED — retry those with: node reprocess_failed.mjs --run)`);
    }
  }
  console.log(`To submit: ${selected.length}${args.dryRun ? " (DRY RUN — nothing will be sent)" : ""}\n`);

  const ok = [];
  const failures = [];
  for (const d of selected) {
    let text;
    try {
      text = clean(fs.readFileSync(d.full, "utf8"));
    } catch (e) {
      console.error(`FAIL ${d.rel}: could not read/clean — ${e.message}`);
      failures.push({ ...d, error: e.message });
      continue;
    }
    if (!text) {
      console.error(`FAIL ${d.rel}: empty after cleaning (all boilerplate?)`);
      failures.push({ ...d, error: "empty after cleaning" });
      continue;
    }
    if (args.dryRun) {
      console.log(`would submit ${d.title} [${d.kind}] (${text.length} chars)`);
      ok.push(d);
      continue;
    }
    process.stdout.write(`Submitting ${d.title} (${text.length} chars)... `);
    try {
      console.log(await insert(text, d.title));
      ok.push(d);
    } catch (e) {
      // Keep going: one bad file must not cost the rest of a multi-hour run.
      console.log("FAILED");
      console.error(`  ${d.rel}: ${e.message}`);
      failures.push({ ...d, error: e.message });
    }
  }

  console.log(
    `\nSummary: ${ok.length} ${args.dryRun ? "would be submitted" : "submitted"}, ` +
      `${skipped.length} skipped, ${failures.length} failed.`
  );
  if (failures.length) {
    console.error("Failed:");
    for (const f of failures) console.error(`  - ${f.rel}: ${f.error}`);
  }
  if (!args.dryRun && ok.length) {
    console.log("Indexing runs async — poll /documents/pipeline_status for progress.");
  }
  if (failures.length) process.exit(1);
}

main().catch((e) => {
  console.error(`\nError: ${e.message}`);
  process.exit(1);
});
