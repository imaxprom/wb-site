#!/bin/bash
# Крон-проверки здоровья данных (медленные: WB API + API тесты)
# Запуск: каждый час через launchd или вручную
# Результат: public/data/monitor/data-health-cron.json

cd "$(dirname "$0")/.."

BASE="http://localhost:3000"
OUT="public/data/monitor/data-health-cron.json"
CHECKS="[]"
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

# Функция добавления проверки
add_check() {
  local id="$1" name="$2" status="$3" value="$4" detail="$5"
  if [ -n "$detail" ]; then
    CHECKS=$(echo "$CHECKS" | python3 -c "
import json,sys
d=json.load(sys.stdin)
d.append({'id':'$id','name':'$name','status':'$status','value':'$value','detail':'$detail'})
print(json.dumps(d, ensure_ascii=False))
")
  else
    CHECKS=$(echo "$CHECKS" | python3 -c "
import json,sys
d=json.load(sys.stdin)
d.append({'id':'$id','name':'$name','status':'$status','value':'$value'})
print(json.dumps(d, ensure_ascii=False))
")
  fi
}

# 15. Проверка WB API ключа
API_KEY=$(cat data/wb-api-key.txt 2>/dev/null || echo "")
if [ -n "$API_KEY" ]; then
  # Используем stocks с dateFrom=now — лёгкий запрос, возвращает пустой массив, но проверяет авторизацию
  DATE_NOW=$(date -u +%Y-%m-%dT%H:%M:%S)
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 \
    -H "Authorization: $API_KEY" \
    "https://statistics-api.wildberries.ru/api/v1/supplier/stocks?dateFrom=$DATE_NOW" 2>/dev/null || echo "000")

  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "201" ]; then
    add_check "wb_api_valid" "WB API ключ (онлайн)" "ok" "Валиден (HTTP $HTTP_CODE)"
  elif [ "$HTTP_CODE" = "401" ] || [ "$HTTP_CODE" = "403" ]; then
    add_check "wb_api_valid" "WB API ключ (онлайн)" "error" "Истёк или отозван (HTTP $HTTP_CODE)" "Нужно обновить ключ в ЛК WB"
  else
    add_check "wb_api_valid" "WB API ключ (онлайн)" "warn" "HTTP $HTTP_CODE" "Не удалось проверить"
  fi
else
  add_check "wb_api_valid" "WB API ключ (онлайн)" "error" "Отсутствует"
fi

# Сохраняем результат
echo "{\"checks\":$CHECKS,\"timestamp\":\"$TIMESTAMP\"}" | python3 -m json.tool > "$OUT"
echo "Data health cron: done ($(echo "$CHECKS" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))") checks)"
