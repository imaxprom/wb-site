#!/bin/bash
# Roll back MpHub to the previous release (or to a specified release path/stamp).

set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-wb-site}"
REMOTE_BASE="${REMOTE_BASE:-/home/makson}"
APP_NAME="${APP_NAME:-mphub}"
APP_PORT="${APP_PORT:-3000}"
TARGET="${1:-}"

ssh "$REMOTE_HOST" "bash -s" <<EOF
set -euo pipefail
REMOTE_BASE='$REMOTE_BASE'
APP_NAME='$APP_NAME'
APP_PORT='$APP_PORT'
TARGET='$TARGET'
RELEASES_DIR="\$REMOTE_BASE/releases"
CURRENT_LINK="\$REMOTE_BASE/current"
SHARED_DIR="\$REMOTE_BASE/shared"
MONITOR_SHARED_DIR="\$SHARED_DIR/public-data-monitor"

health_check() {
  local url="\$1"
  for _ in \$(seq 1 30); do
    local code
    code="\$(curl --max-time 5 -k -sS -o /dev/null -w '%{http_code}' "\$url" 2>/dev/null || true)"
    if [ "\$code" = "200" ] || [ "\$code" = "307" ] || [ "\$code" = "401" ]; then
      echo "[rollback] health ok: \$url -> \$code"
      return 0
    fi
    sleep 2
  done
  echo "[rollback] health failed: \$url"
  return 1
}

start_pm2_from_current() {
  cd "\$CURRENT_LINK"
  mkdir -p "\$MONITOR_SHARED_DIR" public/data
  if [ -f public/data/monitor/monitor-registry.json ] && [ ! -L public/data/monitor ]; then
    cp -a public/data/monitor/monitor-registry.json "\$MONITOR_SHARED_DIR/monitor-registry.json"
  fi
  rm -rf public/data/monitor
  ln -sfn "\$MONITOR_SHARED_DIR" public/data/monitor
  set -a
  [ -f .env.local ] && . ./.env.local
  [ -f .env.production.local ] && . ./.env.production.local
  set +a
  export NODE_ENV=production
  pm2 delete "\$APP_NAME" >/dev/null 2>&1 || true
  pm2 start node_modules/.bin/next --name "\$APP_NAME" -- start -p "\$APP_PORT" -H 127.0.0.1
}

mkdir -p "\$SHARED_DIR/data"
touch "\$SHARED_DIR/data/deploy.lock"
trap 'rm -f "\$SHARED_DIR/data/deploy.lock"' EXIT

current="\$(readlink -f "\$CURRENT_LINK" 2>/dev/null || true)"
if [ -z "\$TARGET" ]; then
  target="\$(find "\$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' \
    | sort -nr \
    | awk -v current="\$current" '\$2 != current {print \$2; exit}')"
  if [ -z "\$target" ] && [ -d "\$REMOTE_BASE/website" ] && [ "\$current" != "\$REMOTE_BASE/website" ]; then
    target="\$REMOTE_BASE/website"
  fi
else
  if [ -d "\$TARGET" ]; then
    target="\$TARGET"
  elif [ -d "\$RELEASES_DIR/\$TARGET" ]; then
    target="\$RELEASES_DIR/\$TARGET"
  else
    echo "[rollback] target not found: \$TARGET"
    exit 1
  fi
fi

if [ -z "\$target" ] || [ ! -d "\$target" ]; then
  echo "[rollback] no previous release found"
  exit 1
fi

echo "[rollback] current: \${current:-none}"
echo "[rollback] target: \$target"
ln -sfn "\$target" "\$CURRENT_LINK"
start_pm2_from_current
health_check "http://127.0.0.1:\$APP_PORT/login"
pm2 save >/dev/null || true
pm2 status "\$APP_NAME" --no-color
echo "[rollback] OK"
EOF
