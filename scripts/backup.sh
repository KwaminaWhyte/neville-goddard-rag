#!/usr/bin/env bash
# Back up the Postgres `neville` database from the running neville-postgres container.
#
# This single dump captures BOTH the LightRAG knowledge graph (Apache AGE graph
# tables + pgvector embedding tables) AND the app's neville_* tracker tables,
# because they all live in the one shared `neville` database.
#
# Usage: scripts/backup.sh
# Output: ./backups/neville-YYYYmmdd-HHMMSS.sql.gz
set -euo pipefail

CONTAINER="neville-postgres"
DB="neville"
USER="rag"

# Resolve repo root (parent of this scripts/ dir) so output lands in ./backups
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BACKUP_DIR="${REPO_ROOT}/backups"

if ! docker ps --format '{{.Names}}' | grep -qx "${CONTAINER}"; then
  echo "Error: container '${CONTAINER}' is not running." >&2
  echo "Start the stack (docker compose up -d) and try again." >&2
  exit 1
fi

mkdir -p "${BACKUP_DIR}"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUT="${BACKUP_DIR}/neville-${TIMESTAMP}.sql.gz"

echo "Dumping database '${DB}' from container '${CONTAINER}'..."
docker exec -t "${CONTAINER}" pg_dump -U "${USER}" -d "${DB}" | gzip > "${OUT}"

SIZE="$(du -h "${OUT}" | cut -f1)"
echo "Backup written: ${OUT} (${SIZE})"
echo "Captured: LightRAG knowledge graph (AGE + pgvector) AND app neville_* tracker tables (shared 'neville' DB)."
