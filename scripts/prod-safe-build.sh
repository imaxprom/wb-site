#!/bin/bash
# Safe production build for the PM2/Next.js server.
# Builds while the app is stopped, with .next rollback on build or health failure.

set -u

APP_NAME="${APP_NAME:-mphub}"
APP_DIR="${APP_DIR:-$HOME/website}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/login}"
BACKUP_ROOT="${BACKUP_ROOT:-$APP_DIR/.deploy-backups}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
NEXT_BACKUP="$BACKUP_ROOT/.next-$STAMP"

cd "$APP_DIR" || exit 1
mkdir -p "$BACKUP_ROOT" || exit 1

echo "[deploy] app=$APP_NAME dir=$APP_DIR stamp=$STAMP"

HAS_NEXT=0
if [ -d .next ]; then
  HAS_NEXT=1
  echo "[deploy] backing up .next -> $NEXT_BACKUP"
  cp -a .next "$NEXT_BACKUP" || exit 1
else
  echo "[deploy] .next does not exist; rollback backup will be unavailable"
fi

restore_previous_build() {
  reason="$1"
  echo "[deploy] ERROR: $reason"

  if [ "$HAS_NEXT" = "1" ] && [ -d "$NEXT_BACKUP" ]; then
    if [ -d .next ]; then
      failed_next="$BACKUP_ROOT/.next-failed-$STAMP"
      echo "[deploy] preserving failed .next -> $failed_next"
      mv .next "$failed_next" 2>/dev/null || true
    fi
    echo "[deploy] restoring previous .next"
    cp -a "$NEXT_BACKUP" .next || true
  fi

  echo "[deploy] starting previous PM2 app"
  pm2 restart "$APP_NAME" || true
  exit 1
}

wait_for_health() {
  for _ in $(seq 1 30); do
    code="$(curl --max-time 5 -k -sS -o /dev/null -w '%{http_code}' "$HEALTH_URL" 2>/dev/null || true)"
    if [ "$code" = "200" ] || [ "$code" = "307" ] || [ "$code" = "401" ]; then
      echo "[deploy] health ok: $HEALTH_URL -> $code"
      return 0
    fi
    sleep 2
  done

  echo "[deploy] health failed: $HEALTH_URL"
  return 1
}

echo "[deploy] stopping PM2 app"
pm2 stop "$APP_NAME" || exit 1

echo "[deploy] building"
if ! npm run build; then
  restore_previous_build "build failed"
fi

echo "[deploy] starting PM2 app"
if ! pm2 restart "$APP_NAME"; then
  restore_previous_build "PM2 restart failed"
fi

if ! wait_for_health; then
  restore_previous_build "health check failed"
fi

echo "[deploy] PM2 status"
pm2 status "$APP_NAME" --no-color

echo "[deploy] OK"
