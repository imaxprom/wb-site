#!/bin/bash
# Auto-sync shipment data from WB API
# Called by cron from the project root.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="$PROJECT_DIR/data"
LOG="$DATA_DIR/shipment-sync.log"
LOCK_DIR="$DATA_DIR/shipment-sync.lock"
CRON_SECRET_FILE="$DATA_DIR/cron-secret.txt"

mkdir -p "$DATA_DIR"

log() {
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG"
}

detect_base_url() {
  if [ -n "${MPHUB_BASE_URL:-}" ]; then
    echo "${MPHUB_BASE_URL%/}"
    return 0
  fi

  for base in "http://127.0.0.1" "http://127.0.0.1:3000" "http://127.0.0.1:3002"; do
    # /api/auth/me returns 401 when the app is healthy but unauthenticated.
    status=$(curl --max-time 3 -sS -o /dev/null -w "%{http_code}" "$base/api/auth/me" 2>/dev/null || true)
    if [ "$status" = "401" ] || [ "$status" = "200" ]; then
      echo "$base"
      return 0
    fi
  done

  return 1
}

usage() {
  echo "Usage: $0 [days|--check]"
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

BASE_URL="$(detect_base_url || true)"

if [ -z "$BASE_URL" ]; then
  log "ERROR: MpHub app is not reachable on 127.0.0.1, 127.0.0.1:3000, or 127.0.0.1:3002"
  exit 1
fi

if [ "${1:-}" = "--check" ]; then
  log "Check OK: project=$PROJECT_DIR log=$LOG base_url=$BASE_URL"
  echo "OK: project=$PROJECT_DIR"
  echo "OK: log=$LOG"
  echo "OK: base_url=$BASE_URL"
  exit 0
fi

DAYS=${1:-28}
if ! [[ "$DAYS" =~ ^[0-9]+$ ]] || [ "$DAYS" -lt 1 ] || [ "$DAYS" -gt 90 ]; then
  log "ERROR: invalid days value: $DAYS"
  usage
  exit 2
fi

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  log "Skip: shipment sync is already running (lock=$LOCK_DIR)"
  exit 0
fi

cleanup() {
  rm -rf "$LOCK_DIR"
}
trap cleanup EXIT INT TERM

URL="$BASE_URL/api/data/sync"
log "Shipment sync started (days=$DAYS, url=$URL)"

CRON_SECRET="$(cat "$CRON_SECRET_FILE" 2>/dev/null || true)"
if [ -z "$CRON_SECRET" ]; then
  log "ERROR: cron secret is missing: $CRON_SECRET_FILE"
  exit 1
fi

RESP=$(curl --max-time 600 -sS -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "x-mphub-cron-secret: $CRON_SECRET" \
  -d "{\"days\": $DAYS}" \
  -w "\n%{http_code}" 2>&1)

HTTP_CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  log "Sync OK: $BODY"
elif [ "$HTTP_CODE" = "401" ]; then
  log "ERROR: API key not found (401): $BODY"
else
  log "ERROR: sync failed (HTTP $HTTP_CODE): $BODY"
  exit 1
fi
