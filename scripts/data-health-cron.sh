#!/bin/bash
# Крон-проверки здоровья данных (WB API + свежесть runtime-таблиц)
# Запуск: каждый час через launchd или вручную
# Результат: data/organizations/<id>/data-health-cron.json

cd "$(dirname "$0")/.."

node scripts/data-health-for-organizations.js
