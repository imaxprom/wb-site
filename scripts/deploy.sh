#!/bin/bash
# Deploy to VPS: sync files -> safe build -> restart
# Usage: bash scripts/deploy.sh

set -e
echo "🚀 Deploying to VPS..."

# 1. Sync source files (no data, no node_modules, no .next)
echo "📦 Syncing files..."
rsync -az --delete \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='.deploy-backups' \
  --exclude='.git' \
  --exclude='/data/' \
  --exclude='public/data/monitor/status.json' \
  --exclude='public/data/monitor/repair-state.json' \
  --exclude='public/data/monitor/repair-log.json' \
  --exclude='public/data/monitor/data-health-cron.json' \
  --exclude='public/data/monitor/changes.json' \
  --exclude='public/data/monitor/auth-status.json' \
  -e "ssh" \
  /Users/octopus/Projects/website/ wb-site:~/website/

# 2. Safe build on VPS: backup .next -> stop PM2 -> build -> start -> health-check
echo "🔨 Safe building..."
ssh wb-site "cd ~/website && bash scripts/prod-safe-build.sh"

echo "✅ Deployed! https://hub.imaxprom.site"
