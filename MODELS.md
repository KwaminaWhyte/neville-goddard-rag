# Choosing models

The stack uses **three** models, all local via Ollama:

| Role | What it does | What to optimize | Set in |
|------|--------------|------------------|--------|
| **coach** | Generates everything you read — end-scene, daily process, chat | **Quality** (bigger = better voice) | `web/.env` → `GEN_MODEL` |
| **extract** | One-time entity/relation extraction while building the graph | **Speed** (runs per chunk) | `lightrag.env` → `LLM_MODEL` |
| **embed** | Vectorizes chunks + queries for retrieval | Must match dim at ingest | `lightrag.env` → `EMBEDDING_MODEL` / `EMBEDDING_DIM` |

`setup.sh` picks sensible defaults from your RAM and chip, pulls them, and
auto-detects the embedding dimension. This table is for overriding.

## Suggested by system resources

`setup.sh` reads total RAM and whether you're on Apple Silicon, then maps to:

| Tier | RAM | coach | extract | embed |
|------|-----|-------|---------|-------|
| **high** | ≥ 48 GB | `qwen2.5:32b` *(or `gemma4:26b-mlx` on Apple Silicon)* | `qwen2.5:7b` *(`gemma4:e4b-mlx`)* | `qwen3-embedding:4b` |
| **mid**  | ≥ 24 GB | `qwen2.5:14b` | `qwen2.5:3b` | `qwen3-embedding:4b` |
| **low**  | ≥ 12 GB | `qwen2.5:7b`  | `qwen2.5:3b` | `nomic-embed-text` |
| **min**  | < 12 GB | `llama3.2:3b` | `llama3.2:3b` | `nomic-embed-text` |

Numbers are guidance, not hard floors — a 32B model needs ~20 GB free to run well.

## Overriding

Export before running setup:
```bash
COACH_MODEL=qwen2.5:32b EXTRACT_MODEL=qwen2.5:7b EMBED_MODEL=qwen3-embedding:4b ./setup.sh
```
Or edit `web/.env` (coach) and `lightrag.env` (extract/embed) by hand, then
`docker compose up -d --force-recreate` to reload LightRAG's env.

## Key rules

- **Coach ≠ extract.** Use a big model for the coach (you read it) and a small
  fast one for extraction (it runs once per chunk; a big model = hours of indexing).
- **Embedding model + dim are frozen at ingest.** Changing them later requires a
  full re-index (`docker compose down`, wipe `data/`, re-run `node ingest.mjs`).
  `setup.sh` auto-detects the dim, so you don't hand-set it.
- **pgvector HNSW caps at 2000 dims.** `qwen3-embedding:4b` is 2560-dim, so vector
  search uses an exact cosine scan — fine at this corpus size. Smaller embedders
  (e.g. `nomic-embed-text`, 768-dim) get the HNSW index automatically.
- **`mlx` tags are Apple-Silicon only.** Don't pick them on Linux/Windows.
- **`LLM_TIMEOUT` must be finite, never `0`** — the LightRAG worker reads 0 as
  "0 seconds" and fails instantly.

## Keeping Ollama healthy during indexing

Run the server so both extract + embed models stay resident (no reload thrash):
```bash
OLLAMA_MAX_LOADED_MODELS=2 OLLAMA_KEEP_ALIVE=-1 OLLAMA_NUM_PARALLEL=2 ollama serve
```
