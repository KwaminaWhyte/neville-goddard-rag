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
  (`db`, `ollama`, `lightrag`, `coach`).

## Gotchas (learned the hard way)
- `LLM_TIMEOUT=0` → LightRAG worker fails instantly. Keep it finite.
- Embedding model + dim are frozen at ingest; changing = full re-index.
- `docker compose restart` does NOT reload env files; use `up -d --force-recreate`.
- pgvector HNSW caps at 2000 dims; higher-dim embedders fall back to exact scan.
- `mlx` model tags are Apple-Silicon only.
- Coach model and extraction model are deliberately different (quality vs speed).

## Setup
`./setup.sh` detects resources, pulls models, auto-detects embed dim, writes envs.
Then `docker compose up -d`, `node ingest.mjs`, `cd web && npm run dev`.
