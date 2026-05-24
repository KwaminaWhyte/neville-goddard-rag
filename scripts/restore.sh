#!/usr/bin/env bash
# Restore the Postgres `rag` database into the running neville-postgres container
# from a gzip dump produced by scripts/backup.sh.
#
# WARNING: this overwrites current data in the `rag` database — including the
# LightRAG knowledge graph (AGE + pgvector) and the app's neville_* tracker
# tables, since they share one database.
#
# Usage:
#   scripts/restore.sh backups/<file>.sql.gz          # prompts for confirmation
#   scripts/restore.sh backups/<file>.sql.gz --yes    # skip confirmation
set -euo pipefail

CONTAINER="neville-postgres"
DB="rag"
USER="rag"

ASSUME_YES="false"
FILE=""

for arg in "$@"; do
  case "${arg}" in
    --yes|-y) ASSUME_YES="true" ;;
    *) FILE="${arg}" ;;
  esac
done

if [[ -z "${FILE}" ]]; then
  echo "Usage: scripts/restore.sh backups/<file>.sql.gz [--yes]" >&2
  exit 1
fi

if [[ ! -f "${FILE}" ]]; then
  echo "Error: backup file not found: ${FILE}" >&2
  exit 1
fi

if ! docker ps --format '{{.Names}}' | grep -qx "${CONTAINER}"; then
  echo "Error: container '${CONTAINER}' is not running." >&2
  echo "Start the stack (docker compose up -d) and try again." >&2
  exit 1
fi

if [[ "${ASSUME_YES}" != "true" ]]; then
  echo "WARNING: This will restore '${FILE}' into database '${DB}' on container '${CONTAINER}'."
  echo "It OVERWRITES current data (LightRAG knowledge graph + app neville_* tables)."
  read -r -p "Proceed? [y/N] " reply
  case "${reply}" in
    y|Y|yes|YES) ;;
    *) echo "Aborted."; exit 1 ;;
  esac
fi

echo "Restoring '${FILE}' into '${DB}'..."
gunzip -c "${FILE}" | docker exec -i "${CONTAINER}" psql -U "${USER}" -d "${DB}"

echo "Restore complete."
