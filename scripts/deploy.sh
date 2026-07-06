#!/bin/bash
# Compatibility wrapper. Production deploys must use the release-based flow so
# PM2 runs from /home/makson/current and runtime shared files stay attached.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🚀 Deploying to VPS via release deploy..."
SOURCE_MODE="${SOURCE_MODE:-local}" bash "$SCRIPT_DIR/release-deploy.sh"
