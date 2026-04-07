#!/bin/bash
cd /Users/octopus/Projects/website

# Запуск dev-сервера в фоне
npm run dev &
DEV_PID=$!

echo "Dev-сервер запущен на http://localhost:3000 (PID: $DEV_PID)"
echo ""

# Запуск Claude Code
claude

# При выходе из Claude — остановить dev-сервер
kill $DEV_PID 2>/dev/null
echo "Dev-сервер остановлен."
