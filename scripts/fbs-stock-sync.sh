#!/bin/bash
# Poll FBS orders and reconcile managed stock for every active legal entity.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="$PROJECT_DIR/data"
LOG="$DATA_DIR/fbs-stock-sync.log"
LOCK_DIR="$DATA_DIR/fbs-stock-sync.lock"
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
    status=$(curl --max-time 5 -sS -o /dev/null -w "%{http_code}" "$base/api/auth/me" 2>/dev/null || true)
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
    echo "ERROR: MpHub app is not reachable"
    exit 1
  fi
  echo "OK: base_url=$BASE_URL"
  echo "OK: schedule=every-minute"
  exit 0
fi

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  # A stale lock is safe to clear after five minutes. Product-level DB leases
  # still prevent two workers from changing the same stock simultaneously.
  if [ -d "$LOCK_DIR" ] && find "$LOCK_DIR" -prune -mmin +5 2>/dev/null | grep -q .; then
    rmdir "$LOCK_DIR" 2>/dev/null || exit 0
    mkdir "$LOCK_DIR" 2>/dev/null || exit 0
  else
    exit 0
  fi
fi
trap 'rmdir "$LOCK_DIR" 2>/dev/null || true' EXIT INT TERM

BASE_URL="$(detect_base_url || true)"
CRON_SECRET="$(cat "$CRON_SECRET_FILE" 2>/dev/null || true)"
if [ -z "$BASE_URL" ] || [ -z "$CRON_SECRET" ]; then
  log "ERROR: base URL or cron secret is unavailable"
  exit 1
fi

RESP=$(curl --max-time 280 -sS -X POST "$BASE_URL/api/fbs-stock/sync" \
  -H "Content-Type: application/json" \
  -H "x-mphub-cron-secret: $CRON_SECRET" \
  -d '{}' \
  -w "\n%{http_code}" 2>&1)
HTTP_CODE=$(echo "$RESP" | tail -1)
RESP_BODY=$(echo "$RESP" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  log "OK $RESP_BODY"
else
  log "ERROR HTTP $HTTP_CODE: $RESP_BODY"
  exit 1
fi
