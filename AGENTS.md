# Project notes for agents/contributors

Local, fully-offline RAG + knowledge-graph app over Neville Goddard's corpus.
User sets a desire → gets personalized daily practices → tracks until realised.

## Architecture
- **Ollama (host)** serves three models: a *coach* (generation), an *extraction*
  model (graph indexing), and an *embedding* model. See `MODELS.md`.
- **LightRAG** (Docker, :9621) builds + serves the knowledge graph and vectors.
  Queries use `only_need_context` — no LLM at query time; the coach generates.
- **Postgres 18 + Apache AGE + pgvector** (Docker) stores both LightRAG's
  KG/vectors and the app's tracker tables (`neville_goals/entries/processes`).
- **web/** React Router v7. Server logic in `app/lib/*.server.ts`
  (`db`, `ollama`, `lightrag`, `coach`, `journal`, `logger`).

## Schema changes
`db.server.ts` owns a versioned migration list recorded in `neville_migrations`,
run once per process under a Postgres advisory lock. To change the schema, append
a new numbered entry — never edit an applied one. Migrations 1–2 reproduce the
original bootstrap blob, so a pre-migrations database converges and records them.
Mark a migration `optional: true` when it can legitimately fail on some boxes
(e.g. needs pgvector); it is logged, left unrecorded, and the dependent feature
gates itself on `migrationApplied(version)`.

## Gotchas (learned the hard way)
- `LLM_TIMEOUT=0` → LightRAG worker fails instantly. Keep it finite. Same rule
  applies app-side: a 0/unset timeout env means "use the default", never "no limit".
- Embedding model + dim are frozen at ingest; changing = full re-index. This binds
  LightRAG's corpus index only — journal embeddings live in their own table with
  their own `model`/`dim` columns and are never compared against corpus vectors.
- `docker compose restart` does NOT reload env files; use `up -d --force-recreate`.
- pgvector HNSW caps at 2000 dims; higher-dim embedders fall back to exact scan.
  A `vector` column with *unspecified* dim is legal and works for exact scan —
  that's what the journal table uses, so the embedder can change without a DDL.
- `mlx` model tags are Apple-Silicon only. The registry does not 404 them on other
  platforms — it returns **412** with the body `this model requires macOS`, so a
  tag check must treat 412 as "exists, platform-gated", not "missing".
- LightRAG's `/health` reports `embedding_model` but **not** `embedding_dim`
  (it comes back undefined), so drift detection only has the model name to go on.
- Coach model and extraction model are deliberately different (quality vs speed).
- Day counters and streaks must bucket calendar days in the *same* timezone —
  they are both driven by `neville_users.timezone` (JS side `ymdInTz`, SQL side
  `AT TIME ZONE`). Mixing server-local and UTC bucketing was a real off-by-one bug.

## Setup
`./setup.sh` detects resources, verifies the model tags resolve, pulls models,
auto-detects embed dim, writes envs. Then `docker compose up -d`,
`node ingest.mjs`, `cd web && npm run dev`.

## Tests
`cd web && npm test`. Tests must stay hermetic — no Postgres, Ollama, LightRAG or
Docker required — so keep testable logic in exported pure functions. CI
(`.github/workflows/ci.yml`) runs typecheck + tests, validates
`docker compose config`, and syntax-checks `setup.sh`.

## Conventions
- Never swallow a failure. `logger.server.ts` gives `log.*` and
  `bestEffort(scope, what, promise, fallback)` — use those instead of `catch {}`.
- Never log passwords, hashes, session tokens, or journal entry content.
- Comments explain *why*, concise `//` style. No JSDoc blocks.
