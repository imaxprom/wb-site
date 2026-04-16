#!/bin/bash
# Deploy to VPS: sync files → build → restart
# Usage: bash scripts/deploy.sh

set -e
echo "🚀 Deploying to VPS..."

# 1. Sync source files (no data, no node_modules, no .next)
echo "📦 Syncing files..."
rsync -az --delete \
  --exclude='node_modules' \
  --exclude='.next' \
  --exclude='.git' \
  --exclude='data/' \
  -e "ssh" \
  /Users/octopus/Projects/website/ wb-site:~/website/

# 2. Build on VPS
echo "🔨 Building..."
ssh wb-site "cd ~/website && npm run build 2>&1 | tail -3"

# 3. Restart PM2
echo "♻️  Restarting..."
ssh wb-site "sudo pm2 restart mphub 2>&1 | tail -3"

echo "✅ Deployed! https://hub.imaxprom.site"
