#!/bin/bash
# Release-based deploy for MpHub.
#
# Build happens in a new release directory while the current production app
# keeps running. Only after build + preflight health pass do we switch the
# /home/makson/current symlink and restart PM2.

set -euo pipefail

LOCAL_ROOT="${LOCAL_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
REMOTE_HOST="${REMOTE_HOST:-wb-site}"
REMOTE_BASE="${REMOTE_BASE:-/home/makson}"
APP_NAME="${APP_NAME:-mphub}"
APP_PORT="${APP_PORT:-3000}"
PREFLIGHT_PORT="${PREFLIGHT_PORT:-3100}"
RETAIN_RELEASES="${RETAIN_RELEASES:-5}"
BUILD_CMD="${BUILD_CMD:-npm run build -- --webpack}"
CLEAN_BUILD="${CLEAN_BUILD:-0}"
INSTALL_DEPS="${INSTALL_DEPS:-0}"
SOURCE_MODE="${SOURCE_MODE:-local}"
RELEASE_MARKER="${RELEASE_MARKER:-}"
STAMP="${RELEASE_STAMP:-$(date -u +%Y%m%d-%H%M%S)}"

LEGACY_DIR="$REMOTE_BASE/website"
RELEASES_DIR="$REMOTE_BASE/releases"
SHARED_DIR="$REMOTE_BASE/shared"
MONITOR_SHARED_DIR="$SHARED_DIR/public-data-monitor"
CURRENT_LINK="$REMOTE_BASE/current"
RELEASE_DIR="$RELEASES_DIR/$STAMP"
PREV_TARGET_FILE="/tmp/mphub-prev-target-$STAMP"

echo "[release] stamp=$STAMP"
echo "[release] local=$LOCAL_ROOT"
echo "[release] remote=$REMOTE_HOST:$RELEASE_DIR"
echo "[release] source_mode=$SOURCE_MODE"

ssh "$REMOTE_HOST" "bash -s" <<EOF
set -euo pipefail
REMOTE_BASE='$REMOTE_BASE'
LEGACY_DIR='$LEGACY_DIR'
RELEASES_DIR='$RELEASES_DIR'
SHARED_DIR='$SHARED_DIR'
MONITOR_SHARED_DIR='$MONITOR_SHARED_DIR'
CURRENT_LINK='$CURRENT_LINK'
RELEASE_DIR='$RELEASE_DIR'
PREV_TARGET_FILE='$PREV_TARGET_FILE'

mkdir -p "\$RELEASES_DIR" "\$SHARED_DIR"

if [ ! -e "\$CURRENT_LINK" ]; then
  ln -sfn "\$LEGACY_DIR" "\$CURRENT_LINK"
fi
readlink -f "\$CURRENT_LINK" > "\$PREV_TARGET_FILE"

if [ ! -f "\$SHARED_DIR/.shared-ready" ]; then
  rm -rf "\$SHARED_DIR/data"
  mkdir -p "\$SHARED_DIR/data"
  rsync -a --exclude='*.bak' "\$LEGACY_DIR/data/" "\$SHARED_DIR/data/"
  touch "\$SHARED_DIR/.shared-ready"
fi
if [ ! -f "\$SHARED_DIR/.env.production.local" ] && [ -f "\$LEGACY_DIR/.env.production.local" ]; then
  cp -a "\$LEGACY_DIR/.env.production.local" "\$SHARED_DIR/.env.production.local"
fi
if [ ! -f "\$SHARED_DIR/.env.local" ] && [ -f "\$LEGACY_DIR/.env.local" ]; then
  cp -a "\$LEGACY_DIR/.env.local" "\$SHARED_DIR/.env.local"
fi
if [ ! -d "\$SHARED_DIR/node_modules" ]; then
  cp -a "\$LEGACY_DIR/node_modules" "\$SHARED_DIR/node_modules"
fi
mkdir -p "\$SHARED_DIR/next-cache" "\$SHARED_DIR/data" "\$MONITOR_SHARED_DIR" "\$RELEASE_DIR"
if [ ! -f "\$MONITOR_SHARED_DIR/.shared-ready" ]; then
  for src in "\$LEGACY_DIR/public/data/monitor" "\$CURRENT_LINK/public/data/monitor"; do
    if [ -d "\$src" ] && [ ! -L "\$src" ]; then
      rsync -a "\$src/" "\$MONITOR_SHARED_DIR/"
    fi
  done
  touch "\$MONITOR_SHARED_DIR/.shared-ready"
fi
touch "\$SHARED_DIR/data/deploy.lock"
[ -d "\$LEGACY_DIR/data" ] && touch "\$LEGACY_DIR/data/deploy.lock"
EOF

if [ "$SOURCE_MODE" = "remote-current" ]; then
  echo "[release] rsync source from current production tree"
  ssh "$REMOTE_HOST" "bash -s" <<EOF
set -euo pipefail
CURRENT_LINK='$CURRENT_LINK'
RELEASE_DIR='$RELEASE_DIR'
rsync -a --delete \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='.venv' \
  --exclude='.npm-cache' \
  --exclude='.deploy-backups' \
  --exclude='.DS_Store' \
  --exclude='.git' \
  --exclude='.env.local' \
  --exclude='.env.production.local' \
  --exclude='.env.production.local.*' \
  --exclude='__pycache__/' \
  --exclude='*.pyc' \
  --exclude='/data/' \
  --exclude='public/data/monitor/status.json' \
  --exclude='public/data/monitor/repair-state.json' \
  --exclude='public/data/monitor/repair-log.json' \
  --exclude='public/data/monitor/data-health-cron.json' \
  --exclude='public/data/monitor/changes.json' \
  --exclude='public/data/monitor/auth-status.json' \
  "\$CURRENT_LINK/" "\$RELEASE_DIR/"
EOF
else
  echo "[release] rsync source from local worktree"
  rsync -az --delete \
    --exclude='node_modules' \
    --exclude='.next' \
    --exclude='.venv' \
    --exclude='.npm-cache' \
    --exclude='.deploy-backups' \
    --exclude='.DS_Store' \
    --exclude='.git' \
    --exclude='.env.local' \
    --exclude='.env.production.local' \
    --exclude='.env.production.local.*' \
    --exclude='__pycache__/' \
    --exclude='*.pyc' \
    --exclude='/data/' \
    --exclude='public/data/monitor/status.json' \
    --exclude='public/data/monitor/repair-state.json' \
    --exclude='public/data/monitor/repair-log.json' \
    --exclude='public/data/monitor/data-health-cron.json' \
    --exclude='public/data/monitor/changes.json' \
    --exclude='public/data/monitor/auth-status.json' \
    -e "ssh" \
    "$LOCAL_ROOT/" "$REMOTE_HOST:$RELEASE_DIR/"
fi

if [ -n "$RELEASE_MARKER" ]; then
  echo "[release] write release marker"
  ssh "$REMOTE_HOST" "bash -s" <<EOF
set -euo pipefail
RELEASE_DIR='$RELEASE_DIR'
STAMP='$STAMP'
RELEASE_MARKER='$RELEASE_MARKER'
mkdir -p "\$RELEASE_DIR/public/data"
printf '{"stamp":"%s","marker":"%s","createdAt":"%s"}\n' "\$STAMP" "\$RELEASE_MARKER" "\$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "\$RELEASE_DIR/public/data/release-marker.json"
EOF
fi

echo "[release] build and switch"
ssh "$REMOTE_HOST" "bash -s" <<EOF
set -euo pipefail
APP_NAME='$APP_NAME'
APP_PORT='$APP_PORT'
PREFLIGHT_PORT='$PREFLIGHT_PORT'
REMOTE_BASE='$REMOTE_BASE'
BUILD_CMD='$BUILD_CMD'
CLEAN_BUILD='$CLEAN_BUILD'
INSTALL_DEPS='$INSTALL_DEPS'
RETAIN_RELEASES='$RETAIN_RELEASES'
RELEASES_DIR='$RELEASES_DIR'
SHARED_DIR='$SHARED_DIR'
MONITOR_SHARED_DIR='$MONITOR_SHARED_DIR'
CURRENT_LINK='$CURRENT_LINK'
RELEASE_DIR='$RELEASE_DIR'
PREV_TARGET_FILE='$PREV_TARGET_FILE'

health_check() {
  local url="\$1"
  for _ in \$(seq 1 30); do
    local code
    code="\$(curl --max-time 5 -k -sS -o /dev/null -w '%{http_code}' "\$url" 2>/dev/null || true)"
    if [ "\$code" = "200" ] || [ "\$code" = "307" ] || [ "\$code" = "401" ]; then
      echo "[release] health ok: \$url -> \$code"
      return 0
    fi
    sleep 2
  done
  echo "[release] health failed: \$url"
  return 1
}

validate_release_tree() {
  local missing=0
  local required=(
    "src/app/api/data/meta/route.ts"
    "src/app/api/data/orders-aggregated/route.ts"
    "src/app/api/data/products/route.ts"
    "src/app/api/data/stock/route.ts"
    "src/app/api/data/sync/route.ts"
    "src/app/shipment/page.tsx"
    "src/components/DataProvider.tsx"
    "public/data/docs.json"
  )

  for file in "\${required[@]}"; do
    if [ ! -f "\$file" ]; then
      echo "[release] missing required file: \$file"
      missing=1
    fi
  done

  if [ "\$missing" -ne 0 ]; then
    return 1
  fi
}

start_pm2_from_current() {
  cd "\$CURRENT_LINK"
  set -a
  [ -f .env.local ] && . ./.env.local
  [ -f .env.production.local ] && . ./.env.production.local
  set +a
  export NODE_ENV=production
  pm2 delete "\$APP_NAME" >/dev/null 2>&1 || true
  pm2 start node_modules/.bin/next --name "\$APP_NAME" -- start -p "\$APP_PORT" -H 127.0.0.1
}

rollback() {
  local reason="\$1"
  local prev
  prev="\$(cat "\$PREV_TARGET_FILE" 2>/dev/null || true)"
  echo "[release] ERROR: \$reason"
  if [ -n "\$prev" ] && [ -e "\$prev" ]; then
    echo "[release] rollback current -> \$prev"
    ln -sfn "\$prev" "\$CURRENT_LINK"
    start_pm2_from_current || true
    health_check "http://127.0.0.1:\$APP_PORT/login" || true
  fi
  rm -f "\$SHARED_DIR/data/deploy.lock" "\$REMOTE_BASE/website/data/deploy.lock"
  exit 1
}

cd "\$RELEASE_DIR"
ln -sfn "\$SHARED_DIR/data" data
[ -f "\$SHARED_DIR/.env.production.local" ] && ln -sfn "\$SHARED_DIR/.env.production.local" .env.production.local
[ -f "\$SHARED_DIR/.env.local" ] && ln -sfn "\$SHARED_DIR/.env.local" .env.local
ln -sfn "\$SHARED_DIR/node_modules" node_modules
mkdir -p "\$MONITOR_SHARED_DIR" public/data
if [ -f public/data/monitor/monitor-registry.json ]; then
  src_registry="\$(readlink -f public/data/monitor/monitor-registry.json)"
  dst_registry="\$(readlink -m "\$MONITOR_SHARED_DIR/monitor-registry.json")"
  if [ "\$src_registry" != "\$dst_registry" ]; then
    cp -a public/data/monitor/monitor-registry.json "\$MONITOR_SHARED_DIR/monitor-registry.json"
  fi
fi
rm -rf public/data/monitor
ln -sfn "\$MONITOR_SHARED_DIR" public/data/monitor

if ! validate_release_tree; then
  rollback "release tree validation failed"
fi

if [ "\$INSTALL_DEPS" = "1" ]; then
  echo "[release] npm ci into shared node_modules"
  rm -rf "\$SHARED_DIR/node_modules"
  npm ci
  mv node_modules "\$SHARED_DIR/node_modules"
  ln -sfn "\$SHARED_DIR/node_modules" node_modules
fi

if [ "\$CLEAN_BUILD" = "1" ]; then
  echo "[release] clean next cache"
  rm -rf "\$SHARED_DIR/next-cache"
fi
mkdir -p "\$SHARED_DIR/next-cache" .next
ln -sfn "\$SHARED_DIR/next-cache" .next/cache

echo "[release] build: \$BUILD_CMD"
if ! bash -lc "\$BUILD_CMD"; then
  rollback "build failed"
fi

echo "[release] preflight next start on port \$PREFLIGHT_PORT"
set -a
[ -f .env.local ] && . ./.env.local
[ -f .env.production.local ] && . ./.env.production.local
set +a
export NODE_ENV=production
node node_modules/.bin/next start -p "\$PREFLIGHT_PORT" -H 127.0.0.1 > "\$SHARED_DIR/data/release-preflight-\$(basename "\$RELEASE_DIR").log" 2>&1 &
PREFLIGHT_PID=\$!
trap 'kill "\$PREFLIGHT_PID" >/dev/null 2>&1 || true; rm -f "\$SHARED_DIR/data/deploy.lock" "\$REMOTE_BASE/website/data/deploy.lock"' EXIT
if ! health_check "http://127.0.0.1:\$PREFLIGHT_PORT/login"; then
  rollback "preflight health failed"
fi
kill "\$PREFLIGHT_PID" >/dev/null 2>&1 || true
wait "\$PREFLIGHT_PID" >/dev/null 2>&1 || true
trap - EXIT

echo "[release] switch current -> \$RELEASE_DIR"
ln -sfn "\$RELEASE_DIR" "\$CURRENT_LINK"

echo "[release] updating crontab cwd to current"
mkdir -p "\$HOME/cron-backups"
crontab -l > "\$HOME/cron-backups/crontab-before-release-\$(basename "\$RELEASE_DIR")" 2>/dev/null || true
if crontab -l >/tmp/mphub-cron-\$(basename "\$RELEASE_DIR") 2>/dev/null; then
  sed 's#/home/makson/website#/home/makson/current#g' "/tmp/mphub-cron-\$(basename "\$RELEASE_DIR")" | crontab -
fi

echo "[release] restart PM2 from current"
if ! start_pm2_from_current; then
  rollback "pm2 start failed"
fi
if ! health_check "http://127.0.0.1:\$APP_PORT/login"; then
  rollback "production health failed"
fi

pm2 save >/dev/null || true
pm2 status "\$APP_NAME" --no-color

echo "[release] cleanup old releases, keep \$RETAIN_RELEASES"
find "\$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
  | sort -nr \
  | awk -v keep="\$RETAIN_RELEASES" 'NR>keep {print \$2}' \
  | xargs -r rm -rf

rm -f "\$SHARED_DIR/data/deploy.lock" "\$REMOTE_BASE/website/data/deploy.lock"
echo "[release] OK: \$RELEASE_DIR"
EOF

echo "[release] deployed: $STAMP"
