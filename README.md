# The Law — a Neville Goddard Manifestation Engine

Set a desire. Get vivid, personalized practices grounded in Neville Goddard's own
teaching — "living in the end" scenes, SATS scripts, revision, mental diet, signs
to notice — and track the journey day by day until you mark it **realised**.

Retrieval runs on a real **knowledge graph** of Neville's corpus (entities +
relations), not just nearest-chunk search, so guidance reflects how his concepts
connect. **Everything runs locally.** No cloud calls, no data leaves your machine.

## Stack

- **LLM** (coaching + indexing): your choice via Ollama — see [MODELS.md](MODELS.md)
- **Embeddings**: local via Ollama (dimension auto-detected at setup)
- **RAG + Knowledge Graph**: [LightRAG](https://github.com/HKUDS/LightRAG) (Docker)
- **Store**: PostgreSQL 18 + Apache AGE (graph) + pgvector (vectors) (Docker)
- **App**: React Router v7 + Tailwind v4

```
Ollama (host) ── coach model + embedding model + extraction model
   ▲                       ▲
   │ generation            │ embeddings + extraction
web/ (React Router) ──► LightRAG :9621 ──► Postgres (AGE + pgvector)
   └─ tracker tables ───────────────────────┘
```

The coach model and the extraction model are **separate** (see [MODELS.md](MODELS.md)):
indexing uses a small fast model; the coach uses the best model your box can run.
Queries use LightRAG's `only_need_context` (no LLM at query time).

## Prerequisites

- [Docker Desktop](https://docker.com)
- [Ollama](https://ollama.com/download)
- [Node 20+](https://nodejs.org)

## Quick start

```bash
git clone <this-repo> && cd neville

# 1. Detect resources, pull models, generate env files
./setup.sh                       # add --yes to accept defaults non-interactively

# 2. Keep Ollama running (models stay resident → faster indexing)
OLLAMA_MAX_LOADED_MODELS=2 OLLAMA_KEEP_ALIVE=-1 OLLAMA_NUM_PARALLEL=2 ollama serve

# 3. Start Postgres + LightRAG
docker compose up -d

# 4. Build the knowledge graph (first run only — takes a while locally)
node ingest.mjs
#    watch progress:
curl -s -H "X-API-Key: neville-local-key" http://localhost:9621/documents/status_counts

# 5. Run the app
cd web && npm install && npm run dev
#    open http://localhost:5173
```

`setup.sh` handles model choice, embedding-dimension detection, the Postgres host
port (falls back to 5544 if 5432 is taken), and writes `.env`, `lightrag.env`,
and `web/.env` for you. To pick models yourself, see **[MODELS.md](MODELS.md)**.

Browse the knowledge graph itself at <http://localhost:9621>.

## Using it

1. **Name a desire** → the app composes a "living in the end" scene from the corpus.
   End-scenes are versioned — regenerate freely and revisit past ones.
2. **Generate Today's Process** → a state to assume, a SATS session, a revision,
   mental-diet reminders, a sign to notice, and a concrete **bridge-of-incident**
   next step — personalized to your desire and log, with the **source books cited**.
3. **Log** your sessions, felt states, and signs. Signs surface on their own
   **timeline** (the manifestation feedback loop); regenerating folds the log in.
   A **streak** tracks your daily consistency.
4. **Ask the coach** anything — it answers only from Neville's teaching, in clean
   formatted markdown with sources.
5. **Mark realised** when it comes to pass.

Daily rhythm: read the practice at night (SATS is a bedtime exercise), log the next
morning. One process per calendar day; logs are unlimited.

A health banner appears if Ollama/LightRAG is unreachable or the embedding model
drifted from what the graph was indexed with (which would silently break retrieval).

## Maintenance

```bash
# Back up the database (knowledge graph + your journey) — graph takes hours to build
scripts/backup.sh                      # → backups/neville-<timestamp>.sql.gz
scripts/restore.sh backups/<file>.sql.gz

# Recover relations dropped by a fast extraction model
node reprocess_failed.mjs              # dry run: report FAILED docs
node reprocess_failed.mjs --run        # re-run extraction on FAILED/stuck docs
```
Tip: point `LLM_MODEL` in `lightrag.env` at a stronger model before `--run` if the
drops came from a fast extractor, then `docker compose up -d --force-recreate`.

## Corpus

14 Neville books (public domain) live in [`corpus/`](corpus/) as extracted `.txt`.
Add more — including his 350+ lectures — to enrich the graph. See
[corpus/README.md](corpus/README.md).

## Layout

```
setup.sh                One-shot: detect resources, pull models, write envs
docker-compose.yml      Postgres + LightRAG
.env.example            Compose vars (Postgres host port)
lightrag.env.example    LightRAG config (storage, bindings, models, timeouts)
web/.env.example        App config (coach model, DB, LightRAG)
postgres/               Custom PG18 + AGE + pgvector image
corpus/                 Neville source texts
ingest.mjs              Push corpus into LightRAG
reprocess_failed.mjs    Re-run extraction on failed/stuck documents
scripts/                backup.sh / restore.sh (pg_dump the whole DB)
MODELS.md               How to choose models for your hardware
web/                    React Router app
  app/lib/*.server.ts   db, ollama, lightrag, coach engine
  app/routes/           home, goal detail, coach stream
```

## Notes

- Embedding model + dimension are **fixed once you ingest**; changing them needs a
  re-index (`docker compose down`, clear `data/`, re-run `node ingest.mjs`).
- `LLM_TIMEOUT` must be finite — `0` makes the LightRAG worker fail instantly.
- After editing `lightrag.env`, reload it with `docker compose up -d --force-recreate`
  (`restart` does not re-read env files).
- The data volumes (`data/`) are gitignored — the graph rebuilds from `corpus/`.

## License

Application code: MIT (see below). The corpus texts are public-domain works by
Neville Goddard.
