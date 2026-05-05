# MpHub — Правила работы

## Проект
- Рабочая директория: `/Users/octopus/Projects/website`
- Git: https://github.com/imaxprom/wb-site
- Production: https://hub.imaxprom.site
- Production source of truth: `ssh wb-site`, `/home/makson/website`

## Стек технологий
- Next.js 16 + TypeScript + Tailwind CSS 4
- SQLite (better-sqlite3) — основная БД (data/finance.db)
- exceljs — чтение Excel-отчётов WB; xlsx-js-style — клиентский Excel-экспорт с стилями
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
1. **Диагностика:** сначала сверять production (`ssh wb-site`), потому что локальный MacBook может отличаться от продовой схемы.
2. **Разработка:** локально в `/Users/octopus/Projects/website`, `npm run dev` на localhost:3000 при необходимости.
3. **Проверка:** минимум `npm run build` перед выкладкой.
4. **Деплой:** `bash scripts/deploy.sh` (rsync → `scripts/prod-safe-build.sh` на VPS).
5. **После деплоя:** проверять PM2, health-check и конкретный изменённый endpoint.

## Инфраструктура
- **VPS wb-site** (192.168.55.104): production, PM2, cron-задачи
- **VM claude-cli** (192.168.55.106): Claude Code CLI через Германию (89.125.73.111)
- **SSH:** `ssh wb-site`, `ssh claude-cli`

## Production сеть
- Публичный URL: `https://hub.imaxprom.site`
- DNS: `hub.imaxprom.site` → `46.19.118.18` (внешний nginx/HTTPS-прокси)
- Внешний HTTPS-прокси: Proxmox CT `105` (`proxy`, `192.168.55.105`), `server_tokens off`
- Runtime на VPS: локальный nginx слушает `0.0.0.0:80` и проксирует в Next.js на `127.0.0.1:3000`
- Next.js под PM2 (`mphub`) запущен от пользователя `makson`; root PM2 для сайта не используется
- На VPS локальный порт 443 не слушается приложением; HTTPS терминируется внешним прокси на `46.19.118.18`
- Снаружи проверять публичный сайт через `https://hub.imaxprom.site`
- Изнутри VPS health-check приложения делать через `http://127.0.0.1:3000/login`; публичный вход через локальный nginx можно проверять `http://127.0.0.1/login`
- Не использовать `https://hub.imaxprom.site` как внутренний health-check с самого VPS: обратный доступ к внешнему IP `46.19.118.18` из сети VPS таймаутится
- Подробности: `docs/production-network.md`

## Production deploy
- Основной скрипт: `bash scripts/deploy.sh`
- `deploy.sh` синхронизирует код через `rsync`, исключая `node_modules`, `.next`, `.deploy-backups`, `.git`, `/data/` и runtime JSON мониторинга.
- На VPS всегда используется `bash scripts/prod-safe-build.sh`.
- `prod-safe-build.sh` делает backup текущей `.next`, останавливает PM2 пользователя `makson`, запускает `npm run build`, перезапускает PM2 и проверяет `http://127.0.0.1:3000/login`.
- Если build/start/health-check падает, скрипт восстанавливает предыдущую `.next` и перезапускает PM2.
- Старый `scripts/rebuild-server.sh` относится к локальной/macOS схеме и не является production deploy.

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
- НЕ использовать `https://hub.imaxprom.site` как внутренний health-check с `wb-site`
- НЕ чистить production logs без отдельного решения: старые записи нужны для диагностики

## API security
- `src/proxy.ts` защищает UI по наличию `mphub-token`.
- Серверные API с данными проверяют JWT и роль admin через `src/lib/api-auth.ts`.
- `/api/monitor/*` использует `src/lib/monitor-auth.ts`, сейчас это тот же admin-check.
- Закрытые группы: `/api/finance/*`, `/api/data/*`, `/api/reviews/*`, `/api/wb/*`, `/api/monitor/*`.
- В production `JWT_SECRET` обязателен во время runtime. Dev fallback допустим только вне production runtime.
- Login rate-limit хранится в SQLite `auth_login_attempts`, а не в памяти процесса.
- Security headers задаются в `next.config.ts`: noindex, nosniff, DENY frame, referrer/permissions policy, HSTS и CSP в production.
- Локальный nginx на VPS должен иметь `server_tokens off`.
- SQL со значениями из переменных писать через параметры `?`, не через строковую вставку.

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
