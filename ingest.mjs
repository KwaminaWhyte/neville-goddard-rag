// Ingest corpus/*.txt into LightRAG (knowledge graph + vectors).
// Usage: node ingest.mjs
import fs from "fs";
import path from "path";

const BASE = process.env.LIGHTRAG_URL || "http://localhost:9621";
const KEY = process.env.LIGHTRAG_API_KEY || "neville-local-key";

const TITLES = {
  "neville-goddard_at-your-command": "At Your Command (1939)",
  "neville-goddard_awakened-imagination-and-the-search": "Awakened Imagination & The Search (1954)",
  "neville-goddard_creative-use-of-imagination": "The Creative Use of Imagination",
  "neville-goddard_feeling-is-the-secret": "Feeling Is the Secret (1944)",
  "neville-goddard_freedom-for-all": "Freedom for All (1942)",
  "neville-goddard_he-breaks-the-shell": "He Breaks the Shell",
  "neville-goddard_i-know-my-father": "I Know My Father",
  "neville-goddard_law-and-the-promise": "The Law and the Promise (1961)",
  "neville-goddard_out-of-this-world": "Out of This World (1949)",
  "neville-goddard_power-of-awareness": "The Power of Awareness (1952)",
  "neville-goddard_prayer-the-art-of-believing": "Prayer: The Art of Believing (1945)",
  "neville-goddard_resurrection": "Resurrection (1966)",
  "neville-goddard_seedtime-and-harvest": "Seedtime and Harvest (1956)",
  "neville-goddard_your-faith-is-your-fortune": "Your Faith Is Your Fortune (1941)",
};

const title = (f) =>
  TITLES[f.replace(/\.txt$/, "")] ??
  f.replace(/\.txt$/, "").replace(/^neville-goddard_/, "").replace(/[-_]/g, " ");

// Publisher boilerplate from the Global Grey ebook PDFs — strip so it doesn't
// become spurious graph entities.
const BOILER = [
  /globalgrey/i,
  /this ebook edition was published/i,
  /this book can be found on the site/i,
  /^\s*global grey\s*\d{4}\s*$/i,
  /^\s*first published in\b/i,
];

// Strip page-breaks, page numbers, publisher boilerplate; collapse whitespace.
function clean(raw) {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\f/g, "\n") // form-feed page breaks
    .split("\n")
    .filter((l) => !/^\s*\d+\s*$/.test(l)) // lone page numbers
    .filter((l) => !BOILER.some((re) => re.test(l)))
    .join("\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function insert(text, source) {
  const res = await fetch(`${BASE}/documents/text`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-Key": KEY },
    body: JSON.stringify({ text, file_source: source }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${body}`);
  return body;
}

const dir = path.join(process.cwd(), "corpus");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".txt"));
for (const f of files) {
  const t = title(f);
  const text = clean(fs.readFileSync(path.join(dir, f), "utf8"));
  process.stdout.write(`Submitting ${t} (${text.length} chars)... `);
  console.log(await insert(text, t));
}
console.log("\nAll submitted. Indexing runs async — poll /documents/pipeline_status.");
