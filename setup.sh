#!/usr/bin/env bash
# Neville Manifestation Engine — one-shot local setup.
#
# Detects your OS / RAM / chip, suggests a model tier, pulls the models via
# Ollama, auto-detects the embedding dimension, and generates the env files.
#
#   ./setup.sh            # interactive, picks models from detected resources
#   ./setup.sh --yes      # non-interactive, accept all defaults
#
# Override any model by exporting before running:
#   COACH_MODEL=qwen2.5:32b EXTRACT_MODEL=qwen2.5:7b EMBED_MODEL=qwen3-embedding:4b ./setup.sh
set -euo pipefail
cd "$(dirname "$0")"

YES=0; [[ "${1:-}" == "--yes" || "${1:-}" == "-y" ]] && YES=1
say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m!! \033[0m %s\n' "$*"; }
die()  { printf '\033[1;31mx  \033[0m %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------- prerequisites
say "Checking prerequisites…"
command -v docker  >/dev/null || die "Docker not found. Install Docker Desktop: https://docker.com"
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 not found (need 'docker compose')."
command -v ollama  >/dev/null || die "Ollama not found. Install: https://ollama.com/download"
command -v node    >/dev/null || die "Node not found. Install Node 20+: https://nodejs.org"
command -v curl    >/dev/null || die "curl not found."
say "docker, ollama, node, curl present."

# ---------------------------------------------------------------- detect system
OS="$(uname -s)"; ARCH="$(uname -m)"; APPLE_SILICON=0
[[ "$OS" == "Darwin" && "$ARCH" == "arm64" ]] && APPLE_SILICON=1

if [[ "$OS" == "Darwin" ]]; then
  RAM_GB=$(( $(sysctl -n hw.memsize) / 1024 / 1024 / 1024 ))
else
  RAM_GB=$(( $(awk '/MemTotal/{print $2}' /proc/meminfo) / 1024 / 1024 ))
fi
say "Detected: $OS/$ARCH, ${RAM_GB}GB RAM$( ((APPLE_SILICON)) && echo ', Apple Silicon' )."

# ---------------------------------------------------------------- pick model tier
# coach  = quality matters (user reads it).  extract = speed matters (per-chunk).
if   (( RAM_GB >= 48 )); then TIER=high
elif (( RAM_GB >= 24 )); then TIER=mid
elif (( RAM_GB >= 12 )); then TIER=low
else                          TIER=min; fi

if (( APPLE_SILICON )); then
  case $TIER in
    high) DEF_COACH=gemma4:26b-mlx  DEF_EXTRACT=gemma4:e4b-mlx DEF_EMBED=qwen3-embedding:4b ;;
    mid)  DEF_COACH=qwen2.5:14b     DEF_EXTRACT=qwen2.5:3b     DEF_EMBED=qwen3-embedding:4b ;;
    low)  DEF_COACH=qwen2.5:7b      DEF_EXTRACT=qwen2.5:3b     DEF_EMBED=nomic-embed-text   ;;
    min)  DEF_COACH=llama3.2:3b     DEF_EXTRACT=llama3.2:3b    DEF_EMBED=nomic-embed-text   ;;
  esac
else
  case $TIER in
    high) DEF_COACH=qwen2.5:32b     DEF_EXTRACT=qwen2.5:7b     DEF_EMBED=qwen3-embedding:4b ;;
    mid)  DEF_COACH=qwen2.5:14b     DEF_EXTRACT=qwen2.5:3b     DEF_EMBED=qwen3-embedding:4b ;;
    low)  DEF_COACH=qwen2.5:7b      DEF_EXTRACT=qwen2.5:3b     DEF_EMBED=nomic-embed-text   ;;
    min)  DEF_COACH=llama3.2:3b     DEF_EXTRACT=llama3.2:3b    DEF_EMBED=nomic-embed-text   ;;
  esac
fi

COACH_MODEL="${COACH_MODEL:-$DEF_COACH}"
EXTRACT_MODEL="${EXTRACT_MODEL:-$DEF_EXTRACT}"
EMBED_MODEL="${EMBED_MODEL:-$DEF_EMBED}"

say "Suggested tier: $TIER"
echo "    coach   (generation)  : $COACH_MODEL"
echo "    extract (indexing)    : $EXTRACT_MODEL"
echo "    embed                 : $EMBED_MODEL"
echo "    (see MODELS.md to override; or re-run with COACH_MODEL=… EXTRACT_MODEL=… EMBED_MODEL=…)"
if (( ! YES )); then
  read -r -p "Use these models? [Y/n] " a; [[ "${a:-Y}" =~ ^[Nn] ]] && die "Edit choices then re-run."
fi

# ---------------------------------------------------------------- pull models
ensure_ollama() { curl -sf http://localhost:11434/api/tags >/dev/null 2>&1; }
if ! ensure_ollama; then
  warn "Ollama server not responding. Start it in another terminal with:"
  echo "    OLLAMA_MAX_LOADED_MODELS=2 OLLAMA_KEEP_ALIVE=-1 OLLAMA_NUM_PARALLEL=2 ollama serve"
  read -r -p "Press Enter once it's up… " _ || true
  ensure_ollama || die "Still can't reach Ollama at :11434."
fi
for m in "$COACH_MODEL" "$EXTRACT_MODEL" "$EMBED_MODEL"; do
  say "Pulling $m …"; ollama pull "$m" || die "ollama pull $m failed (check the tag exists)."
done

# ---------------------------------------------------------------- detect embed dim
say "Detecting embedding dimension for $EMBED_MODEL …"
EMBED_DIM=$(curl -sf http://localhost:11434/api/embed \
  -d "{\"model\":\"$EMBED_MODEL\",\"input\":\"dimension probe\"}" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const j=JSON.parse(s);const v=(j.embeddings&&j.embeddings[0])||j.embedding;if(!v)process.exit(1);console.log(v.length)})') \
  || die "Could not probe embedding dim (is $EMBED_MODEL an embedding model?)."
say "Embedding dimension: $EMBED_DIM"

# ---------------------------------------------------------------- choose PG port
PG_PORT=5432
if lsof -iTCP:5432 -sTCP:LISTEN >/dev/null 2>&1; then
  PG_PORT=5544
  warn "Port 5432 in use (local Postgres?). Publishing Docker Postgres on $PG_PORT instead."
fi

# ---------------------------------------------------------------- write env files
say "Writing .env, lightrag.env, web/.env …"
printf 'PG_PUBLISH_PORT=%s\n' "$PG_PORT" > .env

sed -e "s|__EXTRACT_MODEL__|$EXTRACT_MODEL|" \
    -e "s|__EMBED_MODEL__|$EMBED_MODEL|" \
    -e "s|__EMBED_DIM__|$EMBED_DIM|" \
    lightrag.env.example > lightrag.env

sed -e "s|__COACH_MODEL__|$COACH_MODEL|" \
    -e "s|^PG_PORT=.*|PG_PORT=$PG_PORT|" \
    web/.env.example > web/.env

# ---------------------------------------------------------------- next steps
cat <<EOF

$(say "Setup complete.")

Next:
  1. Keep Ollama running (models stay resident):
       OLLAMA_MAX_LOADED_MODELS=2 OLLAMA_KEEP_ALIVE=-1 OLLAMA_NUM_PARALLEL=2 ollama serve
  2. Start Postgres + LightRAG:
       docker compose up -d
  3. Build the knowledge graph (first run only — takes a while on local hardware):
       node ingest.mjs
     Watch progress:
       curl -s -H "X-API-Key: neville-local-key" http://localhost:9621/documents/status_counts
  4. Start the app:
       cd web && npm install && npm run dev
     Open http://localhost:5173

Postgres is on host port $PG_PORT (user/pass/db = rag/rag/rag).
EOF
