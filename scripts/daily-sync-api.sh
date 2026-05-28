#!/bin/bash
# Trigger daily sync through the Next.js API so production writes follow
# the active runtime DB engine (PostgreSQL on prod).

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="$PROJECT_DIR/data"
LOG="$DATA_DIR/daily-sync.log"
LOCK_DIR="$DATA_DIR/daily-sync-api.lock"
CRON_SECRET_FILE="$DATA_DIR/cron-secret.txt"
BASE_URL="${MPHUB_BASE_URL:-http://127.0.0.1:3000}"

mkdir -p "$DATA_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"
}

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  log "Skip: daily sync API is already running (lock=$LOCK_DIR)"
  exit 0
fi

cleanup() {
  rm -rf "$LOCK_DIR"
}
trap cleanup EXIT INT TERM

CRON_SECRET="$(cat "$CRON_SECRET_FILE" 2>/dev/null || true)"
if [ -z "$CRON_SECRET" ]; then
  log "ERROR: cron secret is missing: $CRON_SECRET_FILE"
  exit 1
fi

URL="${BASE_URL%/}/api/wb/daily-sync"
log "Daily sync API started (url=$URL)"

RESP=$(curl --max-time 900 -sS -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "x-mphub-cron-secret: $CRON_SECRET" \
  -d "{}" \
  -w "\n%{http_code}" 2>&1)

HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  log "Daily sync API OK: $BODY"
else
  log "ERROR: daily sync API failed (HTTP $HTTP_CODE): $BODY"
  exit 1
fi
