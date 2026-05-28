# MpHub — Правила работы

## Проект
- Рабочая директория: `/Users/octopus/Projects/website`
- Git: https://github.com/imaxprom/wb-site
- Production: https://hub.imaxprom.site
- Production source of truth: `ssh wb-site`, `/home/makson/website`

## Стек технологий
- Next.js 16 + TypeScript + Tailwind CSS 4
- PostgreSQL — основная production БД MpHub (VM 107, database `mphub`)
- SQLite (better-sqlite3) — legacy/local fallback, старые snapshots и отдельные импорты вроде `weekly_reports.db`
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
2. **Разработка:** локально в `/Users/octopus/Projects/website`, `npm run dev -- -H 127.0.0.1 -p 3000` при необходимости. Для MpHub не использовать буквенный hostname `localhost`.
3. **Проверка:** минимум `npm run build` перед выкладкой.
4. **Деплой:** `bash scripts/deploy.sh` (rsync → `scripts/prod-safe-build.sh` на VPS).
5. **После деплоя:** проверять PM2, health-check и конкретный изменённый endpoint.
- `npm run save-session-state` обновляет `SESSION_STATE.md` через `scripts/save-session-state.js`: читает local legacy SQLite, production PostgreSQL/runtime/crontab через `ssh wb-site`, делает `rsync --dry-run` и пишет короткую карту старта. Ручные пункты Current Focus / Continue From Here лежат в `scripts/session-state-notes.json`; PM2 парсится из `pm2 jlist` JSON, а генератор подсвечивает local/prod drift, runtime-проблемы и непустой deploy dry-run.
- В Codex sandbox этот скрипт может требовать escalated permissions, потому что внутри вызывает `ssh` и `rsync`.
- `KnowledgeBase.tsx` в репозитории сейчас отсутствует; база знаний сайта живёт в `src/app/docs/page.tsx` и `public/data/docs.json`.

## Инфраструктура
- **VPS wb-site** (192.168.55.104): production, PM2, cron-задачи
- **VM codex-cli** (192.168.55.106): Codex gateway для генерации AI-текстов через прокси; старый alias `claude-cli` может существовать, но актуальный сервис — `codex-cli`
- **Proxy CT 105** (`192.168.55.105`): внешний HTTPS-прокси; AI/регионально заблокированные сервисы ходят через прокси/Германию
- **SSH:** `ssh wb-site`, `ssh codex-cli` (`ssh claude-cli` использовать только если нужно проверить старый alias)

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
- По состоянию на 2026-05-27 production runtime уже работает в PostgreSQL mode (`MPHUB_DB_ENGINE=postgres`). Локальный worktree намеренно dirty после миграции и последних production-правок; перед любым деплоем сначала смотреть `git status` и выкатывать только явно разрешённый пользователем scope. Broad deploy делается через `bash scripts/deploy.sh`; production-правки делать только по явной просьбе пользователя.

## Отзывы WB и жалобы
- Основной аккаунт отзывов на production: `ИП Белякова А. Л. / IMSI`, `supplier_id=1166225`.
- Источник истины по данным отзывов: production PostgreSQL, таблицы `review_accounts`, `reviews`, `review_complaints`, `sync_status`, `reviews_archive_sync_state`.
- После 2026-05-17 sync отзывов должен читать не только `GET /api/v1/feedbacks`, но и `GET /api/v1/feedbacks/archive`: WB хранит там обработанные и rating-only отзывы. Без архива динамика после 2026-04-23 выглядит ложно заниженной.
- `scripts/reviews-sync.js` в обычном режиме работает как slow archive tick: один запрос к WB archive за запуск, запись progress/retry в `reviews_archive_sync_state`.
- `scripts/reviews-sync.js` имеет lock-файл `data/reviews-sync.lock` и DB-retry state на WB `429`.
- Production cron отзывов: `*/15 * * * * cd /home/makson/website && /usr/bin/node scripts/reviews-sync.js > /dev/null 2>&1`.
- Watchdog для `reviews-sync` должен учитывать 15-минутный cron с запасом: `max_age_min=45`.
- 2026-05-17 архивный backfill обработал 15000 архивных записей и добавил 3660 новых отзывов: всего стало 146670, `sync_status` содержит `Архив: +3 660`.
- 2026-05-27 production snapshot: `reviews=147971`, `review_complaints=572`; последний успешный archive tick добавил 61 новый отзыв, следующий запуск был ограничен WB `429` до `2026-05-26T21:30:01.951Z`.
- Жалобы генерируются через Codex gateway (`data/codex-gateway.env`, default URL `http://192.168.55.106:8080`), не через Claude CLI.
- Для WB жалоб текст должен отправляться в `feedbackComplaint.explanation`, не в `feedbackComplaint.text`. Перед отправкой нужно запрашивать доступные причины `/complaints/{feedbackId}` и выбирать только `explanationRequired=true`; для fallback предпочитать reason `19`.
- `review_accounts.wb_seller_lk` хранит LK JWT для заголовка `wb-seller-lk`; публичный API не должен отдавать этот токен.
- SMS-авторизация WB через `scripts/wb-seller-login.py` синхронизирует `authorizev3`, `wbx-validation-key`, `wb_seller_lk` в `review_accounts` по `supplier_id`. Если у номера несколько юрлиц, выбор должен запрашиваться у пользователя, не выбирается автоматически.

## Расчёт отгрузки
- 2026-05-19 точечно выкачены на production правки расчёта отгрузки:
  - картинки товаров используют fallback-кандидаты WB CDN basket (`getWbImageUrlCandidates`), потому что новые nmID могут лежать в соседнем `basket`; проверенный пример `770762506`: старая ссылка `basket-35` давала 404, `basket-36` отдаёт 200;
  - селектор артикулов в V2/V3 стал шире и показывает custom name из `product_overrides`/`overrides`, WB article и seller name;
  - V2 Excel summary получает из UI ручные значения `Всего на складе`, ручные правки региональных ячеек и строки `образец`;
  - V3 smart export получил ручное поле `Всего на складе` в детализации и передаёт его в `export-excel-v2.ts`.
- Эти shipment-правки были задеплоены не общим `scripts/deploy.sh`, а точечным `rsync` файлов + `npm run build` + `pm2 restart mphub`, потому что пользователь явно просил выкатывать только конкретный участок.
- Production shipment DB на 2026-05-24: `shipment_products=30`, `shipment_stock=5211`, `shipment_orders=166775`, max order date `2026-05-24T01:41:46`.
- `/shipment` → `Товары` использует левый/правый `ProductsSplitView`: слева поиск и артикулы, справа размерная таблица выбранного артикула; старая раскрывающаяся таблица не используется в основной вкладке. В основной вкладке скрыта внутренняя дублирующая шапка, `/shipment/products-test` оставлен как тестовый маршрут.
- В товарах редактирование custom name включается только через карандаш; `Остатки по складам` свёрнуты по умолчанию.
- `/warehouse` deployed на production: Google Sheets → PostgreSQL складской учёт, левый/правый вид, поиск `Артикул или название`, план упаковки на базе 30 дней × множитель `1/1.25/1.5/2`. Production содержит 127 размерных строк готового склада.

## Расчёт логистики
- Раздел `/logistics` и sidebar item `Расчёт логистики` выкачены на production 2026-05-21/22.
- Новейшие правки формулы ИЛ/ИРП и sidebar от 2026-05-22/23 выкачены на production 2026-05-23 полным `bash scripts/deploy.sh`; production build и health-check прошли.
- API: `/api/logistics/products`, `/api/logistics/tariffs`, `/api/logistics/alerts`.
- `/api/logistics/tariffs` использует WB acceptance coefficients `https://common-api.wildberries.ru/api/tariffs/v1/acceptance/coefficients`, а не старые stock tariffs. Для коробов `boxTypeID=2`, для паллет `boxTypeID=5`.
- Складские колонки сортируются по заказам/продажам за 90 дней из `shipment_orders`; ручной выбор складов и лимит колонок сохраняются в `user_settings` через `/api/settings` (`logisticsSelectedWarehouseNames`, `logisticsWarehouseLimit`), не в browser localStorage.
- Локальная формула `/api/logistics/products`: отчётная локальность считается по всем регионам/странам как в WB “Поставки по регионам”, а тарифные индексы `ИЛ/ИРП` считаются отдельно по RF-only базе за 13 полных завершённых недель без текущей недели и без WB exception categories.
- Локальный UI `/logistics`: верхний `Индекс локализации` форматируется как `1,00`; отдельно показываются `Индекс распределения продаж` и `Локальность отчёта WB`; в таблице по артикулам разделены `ИЛ/ИРП`, RF-locality и report-locality.
- Таблица логистики агрегируется по уникальному WB артикулу без размеров/баркодов.
- Отображаемая логистика считается от объёма карточки: `length_cm * width_cm * height_cm / 1000`, fallback — `paid_storage.volume`.
- Production `shipment_products` уже содержит `length_cm`, `width_cm`, `height_cm`.
- Production logistics data на 2026-05-24: `shipment_stock=5211`, `shipment_orders=166775`, `paid_storage=48352` max date `2026-05-22`, `warehouse_remains_volume=132`, `warehouse_measurements=32`, `logistics_tariff_cache=4`.
- UI показывает:
  - `Объём из карточки`;
  - `Объём из отчёта остатков`;
  - последние 3 замера WB;
  - складские тарифные колонки.
- Видимый столбец `Объём из хранения` удалён из UI; данные `paid_storage.volume` остаются fallback/source в API.
- Если последний замер WB больше объёма карточки, ячейка замеров подсвечивается красным.
- Sidebar показывает красный треугольник на `Расчёт логистики` с числом критичных замеров. Сейчас production count = 1: article `178439058`, WB `3.059 л` против карточки `2.5 л`.
- `/logistics` показывает плашку новых замеров WB за последние 7 дней и кнопку `Посмотреть новые`; свежие замеры получают синюю метку `NEW`. Последняя проверка production: новых замеров = 4.
- Автосинк логистических объёмов:
  - `scripts/logistics-volume-sync.js --source remains` — WB `GET /api/v1/warehouse_remains` + task download, cron `0 3,6,9,12,15,18 * * *` UTC (06:00/09:00/12:00/15:00/18:00/21:00 MSK);
  - `scripts/logistics-volume-sync.js --source measurements` — WB `GET /api/analytics/v1/warehouse-measurements`, cron `10 3,6,9,12,15,18 * * *` UTC (06:10/09:10/12:10/15:10/18:10/21:10 MSK).
- Monitoring registry и watchdog знают `warehouse-remains-sync` и `warehouse-measurements-sync`.
- `scripts/health-collector.py` форматирует cron-часы человекочитаемо (`каждый час`, `каждые 5 мин`, `в 06:00, 09:00, 12:00, 15:00, 18:00, 21:00 МСК`).
- Локальная правка sidebar: меню по умолчанию свернуто, раскрывается при hover, фиксируется pin-кнопкой сверху; нижняя стрелка снята; картинка логотипа заменена текстом `MPHub` (`MP` серым, `Hub` фиолетовым); в collapsed state текст скрыт, чтобы не было артефакта слева у pin.

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
- Login rate-limit хранится в БД (`auth_login_attempts`): в production PostgreSQL, в legacy/dev fallback SQLite; не в памяти процесса.
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
- Запуск: `JWT_SECRET=mphub-dev-secret-2026 npm run dev -- -H 127.0.0.1 -p 3000`
- Билд: `npm run build`
