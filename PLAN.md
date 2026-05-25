# Neville — Manifestation Engine. Build Plan

## Goal
A local web app. User sets a desire. App returns vivid, personalized, Neville-grounded
processes (SATS scripts, living-in-the-end scenes, revision, mental-diet, signs) and
tracks the journey day by day until the user marks the desire **realised**.

## Expected outcome
- Type a wish → get a "living in the end" scene + a Day-1 process within seconds.
- Daily, get a fresh process aware of yesterday's logs and felt states.
- Free-form coaching chat answers strictly from Neville's teaching (no invented doctrine).
- A real **knowledge graph** of Neville's concepts powers retrieval (connected reasoning,
  not just nearest chunks). Browsable in the LightRAG web UI.
- Everything local: Ollama LLM + embeddings, Postgres store. No cloud calls.

## Architecture
```
┌─────────────────────────── host (macOS) ───────────────────────────┐
│  Ollama  : gemma4:26b-mlx (LLM)  +  qwen3-embedding:4b (2560-dim)   │
│                                                                     │
│  web/  React Router v7 (Node server)                                │
│    loaders/actions ─┬─ tracker tables (Postgres)                    │
│                     ├─ retrieval  → LightRAG /query (mix mode)       │
│                     └─ generation → Ollama gemma4 (Neville persona)  │
│                                                                     │
│  Docker compose:                                                    │
│    postgres  (PG18 + Apache AGE + pgvector)                         │
│    lightrag  (:9621  KG + vector RAG, web UI, /query /documents)    │
└─────────────────────────────────────────────────────────────────────┘
```
Single Postgres holds BOTH LightRAG's KG/vectors AND our tracker tables (separate names).

## Components & responsibilities
- **LightRAG**: ingest corpus → extract entities/relations → graph (AGE) + chunk vectors
  (pgvector). Serves `/query` (mix = graph + vector). We use `only_need_context` to fetch
  grounded context, then generate with our own persona for voice control.
- **Coach engine** (in web server): persona + prompt templates → gemma4. Produces end-scene,
  daily process, coaching chat. Reuses retrieved context from LightRAG.
- **Tracker** (Postgres tables): `goals`, `entries`, `processes`. Day counter, status,
  felt-state history feeds back into daily generation.

---

## Tasks

### Phase 0 — Models & infra  ✅ done
- [x] Ollama running; pull `gemma4:26b-mlx` (LLM)
- [x] Pull `qwen3-embedding:4b` (embeddings, 2560-dim)
- [x] Custom Postgres image: Apache AGE + pgvector
- [x] Move to **PG18** (`apache/age:release_PG18_1.7.0` + `postgresql-18-pgvector`)
- [x] `docker compose up` → Postgres 18.1 healthy, `age 1.7.0` + `vector 0.8.2` present
- [x] LightRAG healthy at :9621, wired to Postgres + Ollama
- [x] DB on host port **5544** (5432 taken by Homebrew postgres)

### Phase 1 — Corpus & knowledge graph  ✅ done
- [x] Corpus: **14** Neville books in `corpus/`
- [x] Ingest script (`ingest.mjs`) pushes each book to `/documents/text`
- [x] Fixed indexing: keep both models resident in Ollama; finite LLM_TIMEOUT
      (0 = instant fail), EMBEDDING_TIMEOUT raised, MAX_ASYNC=1
- [x] Separate extraction model (fast) from coach model (quality)
- [x] Indexing complete — entity extraction finished
- [x] `/query` (mix) returns relevant Neville context (vector side verified)
- [x] KG entities/relations populated; browsable in LightRAG UI
- [x] `reprocess_failed.mjs` recovers FAILED/stuck docs (`/documents/reprocess_failed`)

### Phase 2 — Coach engine  ✅ done
- [x] `ollama.server.ts` — chat + stream against gemma4
- [x] `lightrag.server.ts` — query (mix, only_need_context) + insert
- [x] `db.server.ts` — Postgres pool + tracker tables (goals/entries/processes)
- [x] `coach.server.ts` — persona + end-scene / daily-process / chat, LightRAG-grounded

### Phase 3 — React Router app  ✅ done
- [x] React Router v7 in `web/`, dark mystical theme
- [x] Routes: home (list+create), goal detail (process/log/status), `/api/coach` stream
- [x] Markdown rendering; CoachChat streaming component
- [x] Status panel: graph state + link to LightRAG UI
- [x] Typecheck clean; home page serves 200

### Phase 4 — Verify end to end  ✅ done
- [x] Document run steps in README.md
- [x] Create a desire → end-scene generated
- [x] Generate Day-1 process; add a log; regenerate → reflects log
- [x] Coaching chat answers from corpus only

### Phase 4.5 — Hardening & sharing  ✅ done
- [x] GitHub-ready: `.gitignore`, `.env.example`, `lightrag.env.example`, `web/.env.example`
- [x] `setup.sh` — detect OS/RAM/Apple-Silicon → tiered model defaults, pull, auto-detect
      EMBED_DIM, pick PG port, write all env files
- [x] `MODELS.md`, `corpus/README.md`, `LICENSE` (MIT), general-audience `README.md`
- [x] `scripts/backup.sh` + `restore.sh` (pg_dump whole DB)
- [x] End-scene **versioning** (`neville_end_scenes`, past versions kept)
- [x] **Signs** timeline (kind='sign') + **streak** counter
- [x] **Health banner** — Ollama / LightRAG reachability + embedding-drift detection
      (`neville_index_meta`, `checkEmbeddingDrift`)
- [x] ChatGPT-style markdown rendering (react-markdown + remark-gfm + rehype-sanitize),
      `prose-neville` / `prose-chat` styles, sources footer
- [x] Pending/loading states on all action buttons
- [x] BM25-lite lexical rerank in `lightrag.server.ts` `retrieve()` + real source titles
- [x] **Calendar-day rollover** for `dayNumber` (Day 2 at local midnight, not +24h)

### Phase 5 — Feature expansion
- [x] **Edit/delete log entries + signs** — `updateEntry`/`deleteEntry` (goal-scoped) +
      per-entry inline edit (`<details>`) + confirm-delete UI on goal page
- [x] **Felt-state trends** — `feltStateTrend` + `Trends.tsx` inline-SVG sentiment sparkline
      (keyword lexicon scores states; trend summary) on goal page
- [x] **Chat history persistence** — `neville_chats` table + `listChats`/`addChat`/`clearChats`;
      `api.coach` persists user+assistant turns, `CoachChat` seeds from saved history + Clear
- [x] **Search/filter** — `searchEntries` (ILIKE + kind) wired to goal-page GET form (URL query)
- [x] **First-run onboarding** — `Onboarding.tsx` "How it works" panel on home empty-state
- [ ] Reminders — night SATS + morning log nudge (browser Notification API)  *(later)*
- [ ] Auto-generate process on first visit of a new day  *(later)*
- [ ] Journey export — goal + processes + log → Markdown/PDF  *(later)*

### Phase 6 — Mobile app (Expo SDK 56)  ✅ done (single-user)
- [x] JSON API on the web server (`web/app/routes/api/*`) — goals CRUD, entries
      CRUD/search, goal bundle, process/end-scene/status; reuses existing
      `.server.ts` logic; permissive CORS; coach stream via `/api/coach`
- [x] `mobile/` Expo SDK 56 (RN 0.85, React 19) + expo-router, dark gold theme
- [x] Full parity: home (list/create/onboarding/health), goal detail, end-scene
      (+ versions), daily process (markdown), journey log (add/edit/delete/search),
      felt-state trends (dependency-free sparkline), signs timeline, streak,
      streaming coach chat (`expo/fetch`)
- [x] Typecheck clean; Metro iOS bundle builds (1526 modules)
- [ ] Auth + authorization — deferred until the app proves out  *(later)*

## Decisions locked
- LLM: `gemma4:26b-mlx` · Embeddings: `qwen3-embedding:4b` (DIM 2560)
- Store: Postgres **18** + Apache AGE + pgvector · RAG/KG: LightRAG
- Frontend: React Router v7 (no Next.js)
- All local via Ollama

## Open / later
- Add more lectures (350+ exist) to enrich the graph
- Optional reranker (model-based) for sharper retrieval — BM25-lite rerank shipped
- Auth if ever exposed beyond localhost
- Tests (no suite yet)
