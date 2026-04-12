#!/bin/bash
# Автотесты API — сравнение ответов с эталонами
# Запуск: ./scripts/test-api.sh [save|test]
# save — сохранить текущие ответы как эталоны
# test — сравнить с эталонами (по умолчанию)

set -e

BASE="http://localhost:3000"
SNAP_DIR="$(dirname "$0")/../data/api-snapshots"
MODE="${1:-test}"
PASS=0
FAIL=0
ERRORS=""

# Эндпоинты для тестирования
declare -a ENDPOINTS=(
  "finance-pnl|/api/finance/pnl?from=2026-03-30&to=2026-04-05"
  "finance-articles|/api/finance/articles?from=2026-03-30&to=2026-04-05"
  "finance-daily|/api/finance/daily?from=2026-03-30&to=2026-04-05"
  "finance-filters|/api/finance/filters"
  "finance-reconciliation|/api/finance/reconciliation"
  "finance-forecast|/api/finance/forecast?from=2026-04-01&to=2026-04-10"
  "shipment-buyout-rates|/api/data/buyout-rates"
  "analytics-order-stats-day|/api/data/order-stats?from=2026-04-10&to=2026-04-10"
  "analytics-order-stats-week|/api/data/order-stats?from=2026-03-30&to=2026-04-05"
)

if [ "$MODE" = "save" ]; then
  mkdir -p "$SNAP_DIR"
  echo "Сохраняю эталоны..."
  for entry in "${ENDPOINTS[@]}"; do
    name="${entry%%|*}"
    url="${entry#*|}"
    response=$(curl -s --max-time 15 "${BASE}${url}" 2>/dev/null)
    if [ -n "$response" ] && [ "$response" != "" ]; then
      echo "$response" > "${SNAP_DIR}/${name}.json"
      size=$(echo "$response" | wc -c | tr -d ' ')
      echo "  ✅ ${name}: ${size} bytes"
    else
      echo "  ❌ ${name}: пустой ответ"
    fi
  done
  echo "Эталоны сохранены в ${SNAP_DIR}/"
  exit 0
fi

# Режим test
if [ ! -d "$SNAP_DIR" ]; then
  echo "❌ Нет эталонов. Сначала запустите: ./scripts/test-api.sh save"
  exit 1
fi

echo "Тестирование API..."
echo "════════════════════════════"

for entry in "${ENDPOINTS[@]}"; do
  name="${entry%%|*}"
  url="${entry#*|}"
  snap="${SNAP_DIR}/${name}.json"

  if [ ! -f "$snap" ]; then
    echo "  ⚠️  ${name}: нет эталона, пропуск"
    continue
  fi

  response=$(curl -s --max-time 15 "${BASE}${url}" 2>/dev/null)

  if [ -z "$response" ]; then
    echo "  ❌ ${name}: пустой ответ (сервер не отвечает?)"
    FAIL=$((FAIL + 1))
    ERRORS="${ERRORS}\n  - ${name}: пустой ответ"
    continue
  fi

  if diff <(echo "$response") "$snap" > /dev/null 2>&1; then
    echo "  ✅ ${name}"
    PASS=$((PASS + 1))
  else
    echo "  ❌ ${name}: отличается от эталона"
    FAIL=$((FAIL + 1))
    ERRORS="${ERRORS}\n  - ${name}"
  fi
done

echo "════════════════════════════"
echo "Результат: ${PASS} прошли, ${FAIL} провалены"

if [ $FAIL -gt 0 ]; then
  echo -e "\nПровалены:${ERRORS}"
  exit 1
else
  echo "Все тесты пройдены ✅"
  exit 0
fi
