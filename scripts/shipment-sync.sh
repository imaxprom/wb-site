#!/bin/bash
# Auto-sync shipment data from WB API
# Runs 5 times/day: 09:00, 12:00, 15:00, 18:00, 21:00
# Called by launchd: com.mphub.shipment-sync

DAYS=${1:-28}
LOG="/Users/octopus/Projects/website/data/shipment-sync.log"
URL="http://localhost:3000/api/data/sync"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] Shipment sync started (days=$DAYS)" >> "$LOG"

# Login first to get JWT cookie
COOKIE_JAR=$(mktemp)
LOGIN_RESP=$(curl -s -c "$COOKIE_JAR" -X POST "$URL" \
  -H "Content-Type: application/json" \
  -d "{\"days\": $DAYS}" \
  -w "\n%{http_code}" 2>&1)

HTTP_CODE=$(echo "$LOGIN_RESP" | tail -1)
BODY=$(echo "$LOGIN_RESP" | head -n -1)

if [ "$HTTP_CODE" = "200" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ✅ Sync OK: $BODY" >> "$LOG"
elif [ "$HTTP_CODE" = "401" ]; then
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ❌ API key not found (401)" >> "$LOG"
else
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] ❌ Sync failed (HTTP $HTTP_CODE): $BODY" >> "$LOG"
fi

rm -f "$COOKIE_JAR"
