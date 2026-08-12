#!/bin/bash
# Refresh client-visible WB cart stock. Production cron runs this three times a day.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="$PROJECT_DIR/data"
LOG="$DATA_DIR/cart-stock-sync.log"
LOCK_DIR="$DATA_DIR/cart-stock-sync.lock"
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

  for base in "http://127.0.0.1:3000" "http://127.0.0.1:3002" "http://127.0.0.1"; do
    status=$(curl --max-time 10 -sS -o /dev/null -w "%{http_code}" "$base/api/auth/me" 2>/dev/null || true)
    if [ "$status" = "401" ] || [ "$status" = "200" ]; then
      echo "$base"
      return 0
    fi
  done

  return 1
}

if [ "${1:-}" = "--check" ]; then
  BASE_URL="$(detect_base_url || true)"
  if [ -z "$BASE_URL" ]; then
    echo "ERROR: MpHub app is not reachable on local HTTP ports"
    exit 1
  fi
  echo "OK: project=$PROJECT_DIR"
  echo "OK: base_url=$BASE_URL"
  echo "OK: schedule=06:00,14:00,22:00 MSK"
  exit 0
fi

BASE_URL="$(detect_base_url || true)"
if [ -z "$BASE_URL" ]; then
  log "ERROR: MpHub app is not reachable on local HTTP ports"
  exit 1
fi

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  log "Skip: cart stock sync is already running (lock=$LOCK_DIR)"
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

URL="$BASE_URL/api/shipment/cart-stock"
log "WB cart stock sync started (url=$URL)"

RESP=$(curl --max-time 30 -sS -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "x-mphub-cron-secret: $CRON_SECRET" \
  -d "{}" \
  -w "\n%{http_code}" 2>&1)

HTTP_CODE=$(echo "$RESP" | tail -1)
RESP_BODY=$(echo "$RESP" | sed '$d')

if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "202" ]; then
  log "WB cart stock sync queued: $RESP_BODY"
else
  log "ERROR: WB cart stock sync failed (HTTP $HTTP_CODE): $RESP_BODY"
  exit 1
fi
