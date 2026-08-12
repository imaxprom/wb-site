#!/bin/bash
# Daily sync for WB supply documents: acceptance act, reconciliation report,
# and Honest Sign report. Called by production cron from the project root.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ORG_ID="${MPHUB_ORGANIZATION_ID:-}"
if ! [[ "$ORG_ID" =~ ^[1-9][0-9]*$ ]]; then
  echo "MPHUB_ORGANIZATION_ID is required" >&2
  exit 2
fi
DATA_DIR="$PROJECT_DIR/data/organizations/$ORG_ID"
LOG="$DATA_DIR/supply-reports-sync.log"
LOCK_DIR="$DATA_DIR/supply-reports-sync.lock"
CRON_SECRET_FILE="$PROJECT_DIR/data/cron-secret.txt"

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

usage() {
  echo "Usage: $0 [supplyLimit] [documentPageLimit] [--check]"
}

if [ "${1:-}" = "-h" ] || [ "${1:-}" = "--help" ]; then
  usage
  exit 0
fi

BASE_URL="$(detect_base_url || true)"

if [ -z "$BASE_URL" ]; then
  log "ERROR: MpHub app is not reachable on local HTTP ports"
  exit 1
fi

if [ "${1:-}" = "--check" ]; then
  log "Check OK: project=$PROJECT_DIR log=$LOG base_url=$BASE_URL"
  echo "OK: project=$PROJECT_DIR"
  echo "OK: log=$LOG"
  echo "OK: base_url=$BASE_URL"
  exit 0
fi

SUPPLY_LIMIT=${1:-${SUPPLY_REPORTS_SUPPLY_LIMIT:-100}}
DOCUMENT_PAGE_LIMIT=${2:-${SUPPLY_REPORTS_DOCUMENT_PAGE_LIMIT:-4}}

if ! [[ "$SUPPLY_LIMIT" =~ ^[0-9]+$ ]] || [ "$SUPPLY_LIMIT" -lt 1 ] || [ "$SUPPLY_LIMIT" -gt 300 ]; then
  log "ERROR: invalid supplyLimit value: $SUPPLY_LIMIT"
  usage
  exit 2
fi

if ! [[ "$DOCUMENT_PAGE_LIMIT" =~ ^[0-9]+$ ]] || [ "$DOCUMENT_PAGE_LIMIT" -lt 1 ] || [ "$DOCUMENT_PAGE_LIMIT" -gt 20 ]; then
  log "ERROR: invalid documentPageLimit value: $DOCUMENT_PAGE_LIMIT"
  usage
  exit 2
fi

if ! mkdir "$LOCK_DIR" 2>/dev/null; then
  log "Skip: supply reports sync is already running (lock=$LOCK_DIR)"
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

URL="$BASE_URL/api/supply-reports/sync"
BODY="{\"download\":true,\"supplyLimit\":$SUPPLY_LIMIT,\"documentPageLimit\":$DOCUMENT_PAGE_LIMIT}"
log "Supply reports sync started (supplyLimit=$SUPPLY_LIMIT, documentPageLimit=$DOCUMENT_PAGE_LIMIT, url=$URL)"

RESP=$(curl --max-time 3600 -sS -X POST "$URL" \
  -H "Content-Type: application/json" \
  -H "x-mphub-cron-secret: $CRON_SECRET" \
  -H "x-mphub-organization-id: $ORG_ID" \
  -d "$BODY" \
  -w "\n%{http_code}" 2>&1)

HTTP_CODE=$(echo "$RESP" | tail -1)
RESP_BODY=$(echo "$RESP" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  log "Supply reports sync OK: $RESP_BODY"
else
  log "ERROR: supply reports sync failed (HTTP $HTTP_CODE): $RESP_BODY"
  exit 1
fi
