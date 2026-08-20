#!/bin/sh
set -eu

mkdir -p "${STORAGE_LOCAL_PATH:-/data/files}" "${BACKUP_PATH:-/backups}" /data

PORT="${DCE_PORT:-8080}"
exec python -m uvicorn app.main:app \
  --app-dir /app/backend \
  --host 0.0.0.0 \
  --port "${PORT}" \
  --proxy-headers \
  --forwarded-allow-ips "*" \
  --log-level "${LOG_LEVEL:-info}"
