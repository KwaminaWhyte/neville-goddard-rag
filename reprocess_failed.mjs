// Reprocess documents LightRAG marked FAILED (e.g. relations dropped by a fast
// extraction model) plus any stuck PENDING/PROCESSING docs.
//
// Reprocessing re-runs entity/relation extraction using the extraction model
// configured in lightrag.env (LLM_BINDING / LLM_MODEL — the Ollama model on the
// host). Reprocessed docs keep their original track_id from initial upload.
//
// Usage:
//   node reprocess_failed.mjs            # DRY RUN (default): report status only
//   node reprocess_failed.mjs --dry-run  # same as above, explicit
//   node reprocess_failed.mjs --run      # actually trigger reprocessing, then poll
//
// Env: LIGHTRAG_URL (default http://localhost:9621)
//      LIGHTRAG_API_KEY (default neville-local-key)
//
// Endpoints used (discovered via /openapi.json):
//   GET  /documents/status_counts   -> counts by status
//   POST /documents/reprocess_failed -> dedicated retry of FAILED/PENDING/PROCESSING
//   GET  /documents/pipeline_status  -> busy flag for progress polling

const BASE = process.env.LIGHTRAG_URL || "http://localhost:9621";
const KEY = process.env.LIGHTRAG_API_KEY || "neville-local-key";

const HEADERS = { "Content-Type": "application/json", "X-API-Key": KEY };

const args = process.argv.slice(2);
const RUN = args.includes("--run");
const DRY = !RUN; // default behavior is dry

const POLL_INTERVAL_MS = 5000;
const MAX_WAIT_MS = 10 * 60 * 1000; // 10 minutes

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJSON(pathname) {
  const res = await fetch(`${BASE}${pathname}`, { headers: HEADERS });
  const body = await res.text();
  if (!res.ok) throw new Error(`GET ${pathname} -> ${res.status}: ${body}`);
  return JSON.parse(body);
}

async function postJSON(pathname, payload) {
  const res = await fetch(`${BASE}${pathname}`, {
    method: "POST",
    headers: HEADERS,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`POST ${pathname} -> ${res.status}: ${body}`);
  return body ? JSON.parse(body) : {};
}

// Status keys may be upper- or lower-case depending on LightRAG version, so
// normalize before reading individual buckets.
function normalizeCounts(raw) {
  const out = {};
  for (const [k, v] of Object.entries(raw || {})) out[k.toLowerCase()] = v;
  return out;
}

function pick(counts, name) {
  return counts[name.toLowerCase()] ?? 0;
}

async function fetchStatusCounts() {
  const data = await getJSON("/documents/status_counts");
  return normalizeCounts(data.status_counts || data);
}

function printCounts(counts) {
  const entries = Object.entries(counts).filter(([k]) => k !== "all");
  if (entries.length === 0) {
    console.log("  (no documents)");
    return;
  }
  for (const [k, v] of entries.sort()) console.log(`  ${k.padEnd(12)} ${v}`);
}

async function main() {
  console.log(`LightRAG: ${BASE}`);
  console.log(`Mode: ${RUN ? "RUN (will trigger reprocessing)" : "DRY RUN (report only)"}\n`);

  let counts;
  try {
    counts = await fetchStatusCounts();
  } catch (e) {
    console.error(`Could not reach LightRAG status_counts.\n  ${e.message}`);
    console.error("Is the neville-lightrag container running on", BASE, "?");
    process.exit(1);
  }

  console.log("Current document status counts:");
  printCounts(counts);

  const failed = pick(counts, "failed");
  const pending = pick(counts, "pending");
  const processing = pick(counts, "processing");
  const toReprocess = failed + pending + processing;

  console.log(`\nFAILED: ${failed}  (PENDING: ${pending}, PROCESSING: ${processing})`);
  console.log(`reprocess_failed will pick up ${toReprocess} document(s) (FAILED + PENDING + PROCESSING).`);

  if (toReprocess === 0) {
    console.log("\nNothing to reprocess. Done.");
    return;
  }

  if (DRY) {
    console.log("\nDRY RUN: no action taken.");
    console.log("Re-run with --run to trigger reprocessing via POST /documents/reprocess_failed.");
    console.log("(Reprocessing uses the extraction model configured in lightrag.env.)");
    return;
  }

  console.log("\nTriggering POST /documents/reprocess_failed ...");
  const resp = await postJSON("/documents/reprocess_failed");
  console.log(`  status:  ${resp.status ?? "(none)"}`);
  console.log(`  message: ${resp.message ?? "(none)"}`);

  console.log("\nPolling pipeline / status_counts for progress (max 10 min)...");
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT_MS) {
    await sleep(POLL_INTERVAL_MS);
    let busy = false;
    let latest = "";
    try {
      const ps = await getJSON("/documents/pipeline_status");
      busy = !!ps.busy;
      latest = ps.latest_message || ps.job_name || "";
    } catch {
      /* pipeline_status optional; fall back to counts only */
    }
    const c = await fetchStatusCounts();
    const inFlight = pick(c, "pending") + pick(c, "processing");
    const elapsed = Math.round((Date.now() - start) / 1000);
    console.log(
      `  [${elapsed}s] busy=${busy} pending=${pick(c, "pending")} processing=${pick(c, "processing")} ` +
        `processed=${pick(c, "processed")} failed=${pick(c, "failed")}` +
        (latest ? `  | ${latest}` : "")
    );
    if (!busy && inFlight === 0) {
      console.log("\nPipeline idle and no PENDING/PROCESSING remain.");
      console.log("Final status counts:");
      printCounts(c);
      const stillFailed = pick(c, "failed");
      if (stillFailed > 0) {
        console.log(`\nNote: ${stillFailed} document(s) still FAILED — check LightRAG logs / extraction model.`);
      }
      return;
    }
  }

  console.log("\nMax wait elapsed; reprocessing may still be running in background.");
  console.log("Latest status counts:");
  printCounts(await fetchStatusCounts());
}

main().catch((e) => {
  console.error("\nError:", e.message);
  process.exit(1);
});
