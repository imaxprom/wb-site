#!/bin/bash
# Крон-проверки здоровья данных (WB API + свежесть runtime-таблиц)
# Запуск: каждый час через launchd или вручную
# Результат: public/data/monitor/data-health-cron.json

cd "$(dirname "$0")/.."

OUT="public/data/monitor/data-health-cron.json"
TMP="$OUT.tmp"

mkdir -p "$(dirname "$OUT")"

if node scripts/data-health-snapshot.js > "$TMP"; then
  python3 -m json.tool "$TMP" > "$OUT"
  rm -f "$TMP"
  CHECK_COUNT=$(python3 -c "import json; print(len(json.load(open('$OUT')).get('checks', [])))")
  OVERALL=$(python3 -c "import json; print(json.load(open('$OUT')).get('overall', 'unknown'))")
  echo "Data health cron: done ($CHECK_COUNT checks, overall=$OVERALL)"
else
  python3 -m json.tool "$TMP" > "$OUT" 2>/dev/null || cp "$TMP" "$OUT"
  rm -f "$TMP"
  echo "Data health cron: snapshot failed" >&2
fi

# Обновляем общий снимок страницы мониторинга, чтобы status.json не зависел
# только от открытия /monitor в браузере.
if python3 scripts/health-collector.py >/dev/null 2>&1; then
  echo "Monitor status: updated"
else
  echo "Monitor status: update failed" >&2
fi
