#!/bin/bash
# One-time, idempotent bridge from legacy global files to organization 1.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_DIR="$PROJECT_DIR/data"
TARGET_DIR="$SOURCE_DIR/organizations/1"

mkdir -p "$TARGET_DIR"
chmod 700 "$TARGET_DIR"

copy_file_if_missing() {
  local name="$1"
  if [ -f "$SOURCE_DIR/$name" ] && [ ! -e "$TARGET_DIR/$name" ]; then
    cp -p "$SOURCE_DIR/$name" "$TARGET_DIR/$name"
  fi
}

copy_dir_if_missing() {
  local name="$1"
  if [ -d "$SOURCE_DIR/$name" ] && [ ! -e "$TARGET_DIR/$name" ]; then
    cp -a "$SOURCE_DIR/$name" "$TARGET_DIR/$name"
  fi
}

for name in \
  wb-api-key.txt wb-tokens.json wb-auth-cooldown.json \
  wb-cookies.json wb-cookies-meta.json wb-localstorage.json \
  daily-sync-status.json google-service-account.json \
  weekly-sync.log daily-sync.log shipment-sync.log \
  paid-storage-sync.log warehouse-remains-sync.log warehouse-measurements-sync.log \
  reviews-sync.log reviews-complaints.log supply-reports-sync.log cart-stock-sync.log \
  cart-stock-local.json
do
  copy_file_if_missing "$name"
done

for name in reports supply-documents wb-playwright-profile
do
  copy_dir_if_missing "$name"
done

if [ -f "$PROJECT_DIR/public/data/monitor/auth-status.json" ] && [ ! -e "$TARGET_DIR/auth-status.json" ]; then
  cp -p "$PROJECT_DIR/public/data/monitor/auth-status.json" "$TARGET_DIR/auth-status.json"
fi

find "$TARGET_DIR" -type d -exec chmod 700 {} +
find "$TARGET_DIR" -type f -name '*key*.txt' -exec chmod 600 {} +
find "$TARGET_DIR" -type f -name '*tokens*.json' -exec chmod 600 {} +
find "$TARGET_DIR" -type f -name 'google-service-account.json' -exec chmod 600 {} +

echo "Main organization files are available in $TARGET_DIR"
