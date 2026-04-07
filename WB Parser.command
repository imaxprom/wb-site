#!/bin/bash
cd /Users/octopus/Projects/website

# Запуск dev-сервера в фоне
npm run dev &
DEV_PID=$!

echo ""
echo "=================================="
echo "  WB Parser"
echo "  Dev-сервер: http://localhost:3000"
echo "=================================="
echo ""

# Запуск Claude Code
claude

# При выходе из Claude — остановить dev-сервер
kill $DEV_PID 2>/dev/null
echo "Dev-сервер остановлен."
