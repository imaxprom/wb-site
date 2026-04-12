#!/bin/bash
# Пересборка и перезапуск production-сервера
# Вызывается из Claude Code hook после редактирования src/ файлов
#
# Порядок: выгрузить launchd → билд → загрузить launchd
# Это исключает конфликт портов (launchd не поднимает старый процесс во время билда)

cd /Users/octopus/Projects/website
PLIST="$HOME/Library/LaunchAgents/com.mphub.website.plist"
SVC="gui/$(id -u)/com.mphub.website"

# 1. Остановить launchd-службу (выгрузить полностью)
launchctl bootout $SVC 2>/dev/null
sleep 2

# 2. Билд (порт свободен, конфликтов нет)
npm run build --silent 2>&1 | tail -3
if [ $? -ne 0 ]; then
  # Билд упал — вернуть сервер на старом коде
  launchctl bootstrap $SVC "$PLIST" 2>/dev/null || launchctl load "$PLIST" 2>/dev/null
  echo "BUILD FAILED — server restored"
  exit 1
fi

# 3. Загрузить launchd-службу (поднимет новый билд)
launchctl bootstrap $SVC "$PLIST" 2>/dev/null || launchctl load "$PLIST" 2>/dev/null

echo "REBUILD OK — server restarted"
