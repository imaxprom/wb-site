#!/bin/bash
# tg-send.sh — отправка Telegram через SSH-туннель на claude-cli VM (.106)
# → HTTPS_PROXY tinyproxy → немецкий IP → api.telegram.org
#
# Usage: tg-send.sh <TG_TOKEN> <BODY_BASE64>
#   BODY_BASE64 — JSON body закодированный в base64 (чтобы не морочиться с экранированием)
#
# Возвращает ответ Telegram API в stdout, exit 0 при HTTP 2xx.
set -e

TG_TOKEN="$1"
BODY_B64="$2"

if [ -z "$TG_TOKEN" ] || [ -z "$BODY_B64" ]; then
  echo "Usage: $0 <TG_TOKEN> <BODY_BASE64>" >&2
  exit 2
fi

# Вызываем curl на claude-cli через SSH, прокидывая body через env
ssh -o ConnectTimeout=5 -o BatchMode=yes makson@192.168.55.106 \
  "BODY=\$(echo '$BODY_B64' | base64 -d); \
   HTTPS_PROXY=http://localhost:8888 \
   curl -s --max-time 10 \
     -X POST 'https://api.telegram.org/bot${TG_TOKEN}/sendMessage' \
     -H 'Content-Type: application/json' \
     -d \"\$BODY\""
