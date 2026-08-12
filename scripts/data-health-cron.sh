#!/bin/bash
# Крон-проверки здоровья данных (WB API + свежесть runtime-таблиц)
# Запуск: каждый час через launchd или вручную
# Результат: data/organizations/<id>/data-health-cron.json

cd "$(dirname "$0")/.."

node scripts/data-health-for-organizations.js

# Обновляем общий снимок страницы мониторинга, чтобы status.json не зависел
# только от открытия /monitor в браузере.
if python3 scripts/health-collector.py >/dev/null 2>&1; then
  echo "Monitor status: updated"
else
  echo "Monitor status: update failed" >&2
fi
