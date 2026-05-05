#!/bin/bash
# notify.sh — единый хелпер для отправки алертов в Telegram.
# Использует tg-send.sh (SSH-туннель через claude-cli VM) т.к. api.telegram.org
# недоступен с российского IP wb-site.
#
# Usage:
#   bash notify.sh "HTML-текст сообщения"
#   echo "Текст" | bash notify.sh
#   TG_PARSE_MODE=Markdown bash notify.sh "*bold*"
#
# Environment:
#   TG_TOKEN       — бот-токен (env или data/telegram.env)
#   TG_CHAT_ID     — чат-id (env или data/telegram.env)
#   TG_PARSE_MODE  — HTML (default) / Markdown / MarkdownV2
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../data/telegram.env"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  source "$ENV_FILE"
fi

TG_TOKEN="${TG_TOKEN:-}"
TG_CHAT_ID="${TG_CHAT_ID:-}"
TG_PARSE_MODE="${TG_PARSE_MODE:-HTML}"

if [ -z "$TG_TOKEN" ] || [ -z "$TG_CHAT_ID" ]; then
  echo "Telegram settings are missing: set TG_TOKEN and TG_CHAT_ID" >&2
  exit 1
fi

# Текст: из аргумента или stdin
if [ -n "$1" ]; then
  MESSAGE="$1"
else
  MESSAGE=$(cat)
fi

# Строим JSON-body через Python (безопасное экранирование любого текста)
BODY=$(TG_CHAT_ID="$TG_CHAT_ID" TG_PARSE_MODE="$TG_PARSE_MODE" MSG="$MESSAGE" python3 -c "
import json, os
print(json.dumps({
  'chat_id': os.environ['TG_CHAT_ID'],
  'text': os.environ['MSG'],
  'parse_mode': os.environ['TG_PARSE_MODE'],
  'disable_web_page_preview': True,
}, ensure_ascii=False))
")

BODY_B64=$(echo -n "$BODY" | base64 -w0)
bash "$SCRIPT_DIR/tg-send.sh" "$TG_TOKEN" "$BODY_B64"
