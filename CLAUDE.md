# MpHub — Правила работы

## Проект
- Рабочая директория: `/Users/octopus/Projects/website`
- Git: https://github.com/imaxprom/wb-site
- Production: https://hub.imaxprom.site (VPS 192.168.55.104)

## Стек технологий
- Next.js 16 + TypeScript + Tailwind CSS 4
- SQLite (better-sqlite3) — основная БД (data/finance.db)
- xlsx-js-style — генерация Excel с стилями
- recharts — графики
- Playwright (Python) — авторизация WB seller

## Структура проекта
```
src/
  app/           — страницы (Next.js App Router)
  components/    — React компоненты
  modules/       — модули (shipment, finance, analytics)
  lib/           — бизнес-логика, утилиты, API
  types/         — TypeScript типы
scripts/         — sync-скрипты, watchdog, deploy, auth
data/            — БД, логи, токены (НЕ в git)
public/          — статические файлы
docs/            — ТЗ и документация
```

## Рабочий процесс
1. **Разработка:** `npm run dev` на MacBook (localhost:3000, hot reload)
2. **Утверждение:** пользователь проверяет изменения
3. **Коммит:** `git commit` + `git push origin main`
4. **Деплой:** `bash scripts/deploy.sh` (rsync → build → pm2 restart на VPS)

## Инфраструктура
- **VPS wb-site** (192.168.55.104): production, PM2, 7 cron-задач
- **VM claude-cli** (192.168.55.106): Claude Code CLI через Германию (89.125.73.111)
- **SSH:** `ssh wb-site`, `ssh claude-cli`

## Разрешения
- Читать файлы из Telegram tmp ТОЛЬКО по запросу пользователя
- SSH к VPS (wb-site, claude-cli) для деплоя и администрирования
- `npm install` (локально) для зависимостей
- Обращаться к WB API через серверные роуты

## Запреты
- НЕ деплоить каждое мелкое изменение — сначала dev, потом пачкой
- НЕ модифицировать data/ на VPS при деплое (данные изолированы)
- НЕ устанавливать глобальные пакеты (`npm install -g`)
- НЕ коммитить БД, логи, токены (в .gitignore)

## Режим работы
- Перед каждым ответом используй extended thinking (глубокий анализ)
- Рассмотри минимум 2-3 варианта решения перед выбором
- Проверь свои предположения перед действием
- Не угадывай — читай код и данные
- Даты всегда ДД.ММ (день.месяц), не ММ.ДД

## Dev сервер
- Порт: 3000
- Запуск: `npm run dev`
- Билд: `npm run build`
