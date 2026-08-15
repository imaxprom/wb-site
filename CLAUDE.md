# MpHub — Правила работы

## Проект
- Рабочая директория: `/Users/octopus/Projects/website`
- Git: https://github.com/imaxprom/wb-site
- Production: https://hub.imaxprom.site
- Production source of truth: `ssh wb-site`, active release `/home/makson/current`

## Стек технологий
- Next.js 16 + TypeScript + Tailwind CSS 4
- PostgreSQL — единственная runtime БД MpHub (VM 107, database `mphub`); file-DB fallback отсутствует
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
2. **Разработка:** локально в `/Users/octopus/Projects/website`. Если нужны актуальные данные, сначала поднять PostgreSQL SSH-туннель: проверить `nc -zv 127.0.0.1 55432`; если закрыт — `ssh -N -L 55432:127.0.0.1:5432 -J proxmox-jump -i ~/.ssh/id_ed25519_backup makson@192.168.55.107`. Только после живого туннеля запускать/перезапускать `PGPOOL_MAX=2 npm run dev -- -H 127.0.0.1 -p 3000`. Для MpHub не использовать буквенный hostname `localhost`. Если Next 16/Turbopack падает на компиляции CSS (`globals.css`, connection reset), перезапустить dev в webpack-режиме: `PGPOOL_MAX=2 npm run dev -- --webpack -H 127.0.0.1 -p 3000`.
3. **Проверка:** минимум `npm run build` перед выкладкой.
4. **Деплой:** основной путь — `SOURCE_MODE=local bash scripts/release-deploy.sh`; для первого/аварийного bootstrap из текущего production-кода — `SOURCE_MODE=remote-current bash scripts/release-deploy.sh`.
5. **После деплоя:** проверять PM2, health-check и конкретный изменённый endpoint.
- `npm run save-session-state` обновляет `SESSION_STATE.md` через `scripts/save-session-state.js`: сверяет production PostgreSQL/runtime/crontab через `ssh wb-site`, делает `rsync --dry-run` и пишет короткую карту старта. Локальный PostgreSQL snapshot отключён. Ручные пункты Current Focus / Continue From Here лежат в `scripts/session-state-notes.json`; PM2 парсится из `pm2 jlist` JSON, а генератор подсвечивает runtime-проблемы и непустой deploy dry-run.
- В Codex sandbox этот скрипт может требовать escalated permissions, потому что внутри вызывает `ssh` и `rsync`.
- `KnowledgeBase.tsx` в репозитории сейчас отсутствует; база знаний сайта живёт в `src/app/docs/page.tsx` и `public/data/docs.json`.
- Локальные симптомы `Unexpected end of JSON input`, вечная загрузка, пустые страницы или API `500` чаще всего означают, что туннель `127.0.0.1:55432` к production PostgreSQL не поднят/оборвался или локальный пул перегружает SSH-туннель. Первым делом проверять туннель, затем API, и только потом frontend.
- С 2026-08-13 новый Git baseline должен соответствовать production-коду. Перед каждым deploy обязательны чистый `git status`, успешный build и пустая checksum/parity-разница под deploy exclusions. Runtime data/env, generated reports, Android build/APK/ключ подписи, `.codex` и локальные test-макеты в production release не входят.

## Инфраструктура
- **VPS wb-site** (192.168.55.104): production, PM2, cron-задачи
- **VM codex-cli** (192.168.55.106): Codex gateway для генерации AI-текстов через прокси; старый alias `claude-cli` может существовать, но актуальный сервис — `codex-cli`
- **Proxy CT 105** (`192.168.55.105`): внешний HTTPS-прокси; AI/регионально заблокированные сервисы ходят через прокси/Германию
- **SSH:** `ssh wb-site`, `ssh codex-cli` (`ssh claude-cli` использовать только если нужно проверить старый alias)
- Codex gateway на `codex-cli` — это systemd-сервис `codex-gateway.service`, код `/opt/codex-gateway/server.js`, env `/etc/codex-gateway.env`, внутренний URL `http://192.168.55.106:8080`. Секрет `CODEX_GATEWAY_TOKEN`, `~/.codex/auth.json`, access/refresh токены и OAuth-ссылки не выводить и не сохранять в документы.
- 2026-07-27: Codex CLI на `codex-cli` обновлён до `0.145.0`; gateway и MpHub переключены на `gpt-5.6-sol` (`CODEX_MODEL` и `CODEX_GATEWAY_MODEL`). Проверены `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`; alias `gpt-5.6` не использовать, он отклоняется текущим ChatGPT-аккаунтом Codex.
- Gateway и ручные проверки Codex CLI должны идти через `HTTP_PROXY=http://127.0.0.1:8888 HTTPS_PROXY=http://127.0.0.1:8888`: прямой доступ с внешнего IP `46.19.118.18` может получать Cloudflare/OpenAI `403`, даже когда сервис исправен.
- Если на `codex-cli` произошёл разлогин: сделать backup `~/.codex/auth.json`, поднять на Mac временный callback-туннель `ssh -N -L 1455:127.0.0.1:1455 codex-cli`, на VM запустить обычный `codex login` с proxy env, пройти browser OAuth, закрыть туннель, затем проверить `codex login status`, proxy `codex exec` и gateway `/v1/chat/completions`. `codex login --device-auth` на 2026-06-13 давал `403` и не является первым рабочим путём.

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
- С 2026-06-08 основной production deploy — release-based:
  - `scripts/release-deploy.sh` создаёт новый `/home/makson/releases/<stamp>`, подключает shared `data`, env и `node_modules`, сохраняет общий `.next/cache`, собирает новую версию, поднимает preflight `next start` на `127.0.0.1:3100`, затем атомарно переключает `/home/makson/current` и перезапускает PM2.
  - При старте PM2/preflight release-скрипт сначала source-ит `.env.local`, затем `.env.production.local`: production env должен перекрывать локальные значения. Это критично, потому что `.env.local` может содержать локальный туннель `127.0.0.1:55432`, который на проде ломает login/DB.
  - PM2 `mphub` и production cron работают из `/home/makson/current`, не из жёсткого `/home/makson/website`.
  - При ручном точечном deploy нельзя ограничиваться `pm2 restart mphub`: PM2 сохранит старый `exec cwd` и будет отдавать старые JS chunks. После переключения `/home/makson/current` стартуй процесс из current через `pm2 delete mphub`, `cd /home/makson/current`, source env и `pm2 start node_modules/.bin/next --name mphub -- start -p 3000 -H 127.0.0.1`; затем проверь, что `pm2 describe mphub` показывает `exec cwd = readlink -f /home/makson/current`.
  - `scripts/release-rollback.sh` возвращает `/home/makson/current` на предыдущий release; если второго release ещё нет, fallback — `/home/makson/website`.
  - `data/deploy.lock` заставляет `vps-watchdog.py` пропускать проверки во время деплоя.
- `SOURCE_MODE=local bash scripts/release-deploy.sh` — обычный deploy из локального worktree. Перед ним обязательно смотреть `git status`, потому что worktree часто dirty.
- `SOURCE_MODE=remote-current bash scripts/release-deploy.sh` — bootstrap/rebuild из уже работающего production-кода без подтягивания локальных dirty-файлов.
- Старый `bash scripts/deploy.sh` + `scripts/prod-safe-build.sh` оставлены как fallback/clean rebuild: он останавливает PM2 до build, удаляет `.next` и поэтому медленнее/с большим простоем.
- Старый `scripts/rebuild-server.sh` относится к локальной/macOS схеме и не является production deploy.
- По состоянию на 2026-08-13 01:05 МСК production runtime работает в PostgreSQL mode (`MPHUB_DB_ENGINE=postgres`) и release-based deploy mode. Проверенный clean-baseline release: `/home/makson/releases/20260812-220325`, marker `production-baseline-2026-08-13-final`; PM2 `mphub` online, cwd совпадает с active release, неожиданных рестартов нет. Размер source release снижен с 399 МБ примерно до 71 МБ.
- `scripts/release-deploy.sh` валидирует обязательные файлы до build: `/api/data/products`, `/api/data/stock`, `/api/data/orders-aggregated`, `/api/data/meta`, `/api/data/sync`, `/shipment`, `DataProvider`, `public/data/docs.json`. Это защита от повторного вырезания `src/app/api/data/*` при staging/rsync.

## FBS склад
- Отдельный складской портал: `https://fbs.imaxprom.site`; он использует собственную авторизацию и показывает только FBS-сборку, управление остатками, принтер и разрешённые админом настройки.
- Организации изолированы: ИП Беликова использует PostgreSQL schema `public`, второе юрлицо — `organization_2`. FBS-токены лежат отдельно в `data/organizations/<id>/`; заказы, поставки, события, очереди и print-agent записи не должны пересекаться между схемами.
- Рабочий процесс FBS: новые заказы → сборка/печать → контроль маркировки → отгрузка. Пачечная печать является рабочим режимом; единичная повторная печать доступна после первичной пачки.
- Поля сканера в FBS-сборке, контроле маркировки и Архиве КИЗ читают физические HID-клавиши как US-layout: при включённой русской раскладке Windows в поле сразу показываются английские символы. Сервер дополнительно исправляет уже поступившие кириллические символы; ASCII 29/FNC1 Data Matrix нельзя удалять или заменять.
- Ошибка сканирования в FBS-сборке и Архиве КИЗ воспроизводит общий двухтональный Web Audio сигнал с gain `0.95`: полная громкость удерживается 0,5 с и затухает только последние 0,2 с. Успешное сканирование остаётся бесшумным; штатный запрос сопоставления нового GTIN не считается ошибкой.
- Ответ WB `deadlineExceeded` по SGTIN является завершённой неуспешной проверкой, а не вечным pending. Для очереди маркировки FBS система автоматически восстанавливает тот же КИЗ из live-метаданных WB, безопасно сверяет его с хешем исходного сканирования, удаляет метаданные и повторно закрепляет код; всего допускается 3 отправки, после третьего тайм-аута ставится красный статус `Не проверено WB` и preflight блокирует отгрузку.
- `/fbs/kiz-archive` — архив уже нанесённых КИЗ. Полный Data Matrix хранится зашифрованно в organization-scoped `fbs_kiz_archive` и не возвращается в UI. GTIN Честного знака нельзя считать равным WB barcode: первое неизвестное значение явно связывается с точным артикулом/размером и сохраняется в tenant-scoped `fbs_kiz_gtin_mappings`; следующие КИЗ с тем же GTIN определяются автоматически. Пакетная печать резервирует уникальные коды по точному артикулу/размеру и использует общую durable print-agent queue; после подтверждения каждой физической этикетки encrypted source и rendered payload уничтожаются, а хеш и аудит сохраняются. При paused/uncertain печати нельзя автоматически списывать или повторять КИЗ: сотрудник указывает последнюю физически вышедшую позицию. Локальная проверка формата/GTIN отображается отдельно от подтверждения TrueAPI; без `FBS_KIZ_TRUEAPI_URL` + `FBS_KIZ_TRUEAPI_TOKEN` нельзя показывать зелёный онлайн-статус.
- Состав открытой поставки всегда сверять с WB после create/add. WB может сразу после успешного PATCH временно вернуть пустой состав: в этом случае FBS backend до 3 раз перепроверяет live membership и безопасно повторяет добавление только отсутствующих заказов. Сохранять только фактически прикреплённые WB заказы; частичный успех не превращать в полный отказ, а отклонённые заказы оставлять в «Новых».
- Для ПВЗ перед доставкой обязательны созданные и напечатанные QR грузомест. После передачи в доставку печатается также основной QR поставки; цикл нельзя завершить до подтверждённой печати основного QR. Проверенный кейс второго юрлица: supply `WB-GI-264053929`, cargo place `WB-MP-48974219`.
- В `FBS Управление остатками` список складов сверяется с живым `GET /api/v3/warehouses`: удалённые в WB склады автоматически отключаются локально и не должны давать повторяющийся `WB API 404`. Удаление управляемого товара сначала обнуляет его на всех действующих FBS-складах и только после подтверждения WB удаляет локальную конфигурацию.
- Печать выполняет durable Windows print-agent через PostgreSQL queue. Не сбрасывать/повторять задания вслепую, пока не проверены physical output, agent log, DB job и Windows spooler.
- Удалённое администрирование складского Windows-компьютера пока не настроено. Предложенная схема после отдельного разрешения пользователя: Tailscale + Windows OpenSSH + отдельный key-only admin account; физический замятие этикетки всё равно требует сотрудника рядом.

## Отзывы WB и жалобы
- Основной аккаунт отзывов на production: `ИП Белякова А. Л. / IMSI`, `supplier_id=1166225`.
- Источник истины по данным отзывов: production PostgreSQL, таблицы `review_accounts`, `reviews`, `review_complaints`, `sync_status`, `reviews_archive_sync_state`.
- После 2026-05-17 sync отзывов должен читать не только `GET /api/v1/feedbacks`, но и `GET /api/v1/feedbacks/archive`: WB хранит там обработанные и rating-only отзывы. Без архива динамика после 2026-04-23 выглядит ложно заниженной.
- `scripts/reviews-sync.js` в обычном режиме каждые 15 минут запускает sync; archive-запрос к WB делает не чаще 1 раза в 30 минут по верхней странице (`skip=0&order=dateDesc`), а цену/ПВЗ обогащает сначала из `shipment_orders` по `reviews.shk_id = shipment_orders.sticker`, затем через Orders API; глубокий архивный обход не используется для runtime.
- `scripts/reviews-sync.js` имеет lock-файл `data/reviews-sync.lock` и DB-retry state на WB `429`.
- Production cron отзывов: `*/15 * * * * cd /home/makson/current && /usr/bin/node scripts/reviews-sync.js > /dev/null 2>&1`.
- 2026-07-25: UI manual full-sync controls removed from `/reviews` and account connection settings. Do not re-add a button that calls `/api/reviews?sync=true/full`; PostgreSQL runtime returns `409 reviews_sync_disabled_pg` by design and sync belongs to production cron.
- Watchdog для `reviews-sync` должен учитывать 15-минутный cron с запасом: `max_age_min=45`.
- 2026-05-17 архивный backfill обработал 15000 архивных записей и добавил 3660 новых отзывов: всего стало 146670, `sync_status` содержит `Архив: +3 660`.
- 2026-08-12 23:44 МСК production snapshot: `reviews=159734`, `review_complaints=612`; `sync_status=done`, total/loaded `159734`, archive top tick state `archive_skip=0`, last status `ok`, last success `2026-08-12T20:30:06.780Z`, retry window до `2026-08-12T20:59:06.780Z` UTC.
- Жалобы генерируются через Codex gateway (`data/codex-gateway.env`, default URL `http://192.168.55.106:8080`), не через Claude CLI.
- Для WB жалоб текст должен отправляться в `feedbackComplaint.explanation`, не в `feedbackComplaint.text`. Перед отправкой нужно запрашивать доступные причины `/complaints/{feedbackId}` и выбирать только `explanationRequired=true`; для fallback предпочитать reason `19`.
- Автожалобы имеют защитную паузу `review_complaint_pauses`: если свежие последние 5 обработанных жалоб за 24 часа все `rejected`, ставится пауза на 24 часа. Не использовать all-time проверку последних 5, она создаёт вечный стоп на старых отказах. `approved` при синке статусов снимает паузу; ручная жалоба может идти с `force=true`.
- `review_accounts.wb_seller_lk` хранит LK JWT для заголовка `wb-seller-lk`; публичный API не должен отдавать этот токен.
- SMS-авторизация WB через `scripts/wb-seller-login.py` синхронизирует `authorizev3`, `wbx-validation-key`, `wb_seller_lk` в `review_accounts` по `supplier_id`. Если у номера несколько юрлиц, выбор должен запрашиваться у пользователя, не выбирается автоматически.

## Расчёт отгрузки
- 2026-05-19 точечно выкачены на production правки расчёта отгрузки:
  - картинки товаров используют fallback-кандидаты WB CDN basket (`getWbImageUrlCandidates`), потому что новые nmID могут лежать в соседнем `basket`; проверенный пример `770762506`: старая ссылка `basket-35` давала 404, `basket-36` отдаёт 200;
  - селектор артикулов в V2/V3 стал шире и показывает custom name из `product_overrides`/`overrides`, WB article и seller name;
  - V2 Excel summary получает из UI ручные значения `Всего на складе`, ручные правки региональных ячеек и строки `образец`;
  - V3 smart export получил ручное поле `Всего на складе` в детализации и передаёт его в `export-excel-v2.ts`.
- Эти shipment-правки были задеплоены не общим `scripts/deploy.sh`, а точечным `rsync` файлов + `npm run build` + `pm2 restart mphub`, потому что пользователь явно просил выкатывать только конкретный участок.
- Production shipment DB на 2026-08-12 23:44 МСК: `shipment_products=69`, `shipment_stock=922`, `shipment_orders=263364`, max order date `2026-08-12T23:12:27`. `shipment_orders` дедуплицируются по WB identity `order_uid` (`srid`/`gNumber`/`sticker`, fallback `barcode:date:warehouse`), не по старому `barcode,date,warehouse`; sync удаляет старую fallback-строку, если тот же заказ пришёл с настоящим WB identity.
- Остатки WB для `/shipment` идут через новый `warehouse_remains`: `/api/data/sync` создаёт Analytics-отчёт, ждёт `done`, скачивает полный снимок, исключает виртуальные строки WB (`Всего находится на складах`, `В пути до получателей`, `В пути возвраты на склад WB`) из обычных складов и перезаписывает `shipment_stock` реальными складами. Ручная кнопка `Загрузить всё из WB` и hourly `scripts/shipment-sync.sh` используют этот путь. Старый `GET /api/v1/supplier/stocks` отключён WB и не должен возвращаться как production-источник; при ошибке нового отчёта sync отдаёт `stockSkipped:true` и сохраняет предыдущий `shipment_stock`.
- `scripts/supply-reports-sync.sh` должен ходить напрямую в Next.js (`http://127.0.0.1:3000`, затем `:3002`, затем fallback `http://127.0.0.1`), а не сначала через локальный nginx. Это исправлено 27.07 после `504 Gateway Time-out` на длинном POST `/api/supply-reports/sync`; ручной production run в 16:18 МСК вернул OK, data-health overall=OK.
- Monitor/data-health по остаткам обязан проверять свежесть, а не только наличие строк: `shipment_stock` смотрит `MAX(updated_at)` и последний `shipment-sync.log`; cron-check `shipment-sync` зелёный только при `"stockSkipped":false`, а `"stockSkipped":true` должен давать красный статус за этот час.
- `/api/finance/cogs` PATCH/PUT не должен выполнять owner-only DDL на существующей `cogs_history` при обычном сохранении себестоимости. Production bug fixed 2026-07-06 in `2290e97`: API проверяет `to_regclass('public.cogs_history')` и создаёт схему только когда таблицы нет. Проверено на prod синтетическим `PATCH` с ответом 200 и без созданных строк.
- `/finance#forecast` больше не содержит сценарий повышения комиссии WB. Прогноз считает только текущую юнит-экономику и фактическую комиссию из данных; `/api/finance/forecast` не принимает `commissionShiftPp`/`commissionShiftFrom` и не отдаёт `commission_delta_total`/`estimated_profit_baseline`.
- `/shipment` → `Товары` использует левый/правый `ProductsSplitView`: слева поиск и артикулы, справа размерная таблица выбранного артикула; старая раскрывающаяся таблица не используется в основной вкладке. В основной вкладке скрыта внутренняя дублирующая шапка, `/shipment/products-test` оставлен как тестовый маршрут.
- В товарах редактирование custom name включается только через карандаш; `Остатки по складам` свёрнуты по умолчанию.
- `/warehouse` deployed на production: Google Sheets → PostgreSQL складской учёт, левый/правый вид, поиск `Артикул или название`, план упаковки на базе 30 дней × множитель `1/1.25/1.5/2`. Production содержит 127 размерных строк готового склада.
- План упаковки вычитает активные поставки как `упаковано - поступило в продажу`, чтобы товары, уже попавшие в WB-остатки, не учитывались дважды. Для коробочных поставок, где WB отдаёт `readyForSaleQuantity` только итогом по поставке, значение распределяется по баркодам пропорционально упакованному количеству.
- В расчёте отгрузки V2/V3 активен ручной режим `Учитывать отгрузки`: пользователь выбирает поставки из списка, их состав вычитается по barcode только из ФО/региональной группы склада назначения поставки. Если склад поставки не сопоставлен ни с одной группой, количество не вычитается и считается несопоставленным. Старая автоматическая дедукция из раздела `/supplies` не должна использоваться как основной путь планирования.
- В нижней сводной таблице расчёта отгрузки федеральные округа подписаны как `Короб / Штук / Факт / План` в режиме коробов и `Штук / Факт / План` в режиме штук. Это только переименование колонок: `Штук` — планируемое количество по региону, `Факт` — базовый WB-остаток до ручных вычитаний, финальный `План` — остаточная потребность после выбранных поставок. В блоке `Отгружено` подпись `Штук` остаётся, потому что это итоговое количество отгрузки.
- В той же таблице в ячейке артикула показываются `ИЛ`, `ИРП` и применённый коэффициент тренда. Итог `Сверка` суммирует только отрицательные значения (`stock - shipped < 0`), плюсы и нули игнорируются; строковые значения по-прежнему показывают плюс/минус по конкретному артикулу. Для мобильной версии федеральные округа имеют рассчитанную минимальную ширину и должны уходить в горизонтальный скролл, а не схлопываться.

## Финансы и daily sync
- `/finance` и forecast берут дневную сумму и количество заказов из `orders_funnel`. Tooltip метрики `Заказы` показывает сумму и `Кол-во`; динамика показателей не должна дублировать количество отдельно.
- `daily-sync` каждый запуск дополнительно сверяет последние 7 закрытых дней через WB Sales Funnel API (`seller-analytics-api ... /api/analytics/v3/sales-funnel/grouped/history`) независимо от `stable` и обновляет `order_sum`, `order_count`, `buyout_sum`, `buyout_count` в `orders_funnel`, если WB пересчитал прошлые дни.
- Результат этой сверки хранится в `data/daily-sync-status.json` как `ordersRefresh` (`ok`, `checked`, `updated`, `windowDays`) и показывается в monitor/data-health как `orders7d✓ checked 7, upd N`.
- На 2026-06-08 прямой WB API отклонил 30-дневный range для sales funnel с `invalid start day: excess limit on days`; не расширять окно переписывания заказов старше 7 дней без нового фактического подтверждения доступной глубины API.

## Закупки
- `/purchases` использует `src/app/purchases/test/page.tsx` как основную страницу; `/purchases/test` остаётся тем же калькулятором с тестовым заголовком.
- API `/api/purchases/stock` читает Google Sheets через `data/google-service-account.json`: таблицу закупочных остатков `1wJeiTYl6rRX3Ij7qcNfRFAV2DYIYj7PS-BR5L9QLyA4` и складскую таблицу `1BXtl8hX_mp2sbde9lzkF_uS43WCnnSn_wNNxcse9daM`.
- Категории закупок: `Трусы в рубчик`, `Трусы гладкие`, `Трусы-стринги в рубчик`; настройки позволяют включать/отключать артикулы и относить их к категории, `none` не участвует в расчёте.
- Расчёт: сначала по каждому артикулу/размеру считается потребность упаковки `max(0, заказы без отмен за 30 дней × коэффициент - WB-остаток этого же артикула/размера)`. Только остаток к упаковке раскладывается в сырьё по цветам; сырьевой склад Google Sheets вычитается уже по цвету/размеру. Готовый WB-товар не компенсирует закупку сырья для других артикулов.
- Размер `40-42` в закупках не отображается отдельной колонкой сырья, но потребность к упаковке этого готового размера переносится в сырьевой размер `42-44`; в складском учёте это остаются отдельные позиции.
- В Google Sheets закупок маленькие размеры используют `1 мешок = 600 пачек`, большие — `1 мешок = 300 пачек`; `1 короб = 50 пачек`, `1 пачка = 12 шт` по 3 размера × 4 шт.
- Верхние 6 summary-карточек `/purchases` должны идти одной горизонтальной строкой: `grid-cols-6` внутри строки `min-w-[1080px]`, карточки растягиваются по доступной ширине; `К закупке в штуках` и `К закупке в пачках` используют оранжевый `tone="need"`.

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
- Production logistics data на 2026-08-12 23:44 МСК: `shipment_stock=922`, `shipment_orders=263364`, `paid_storage=153081` max date `2026-08-11`, `warehouse_remains_volume=190`, `warehouse_measurements=81`, `logistics_tariff_cache=59`.
- UI показывает:
  - `Объём из карточки`;
  - `Объём из отчёта остатков`;
  - последние 3 замера WB;
  - складские тарифные колонки.
- Видимый столбец `Объём из хранения` удалён из UI; данные `paid_storage.volume` остаются fallback/source в API.
- Если последний замер WB больше объёма карточки, ячейка замеров подсвечивается красным всегда, независимо от текущего остатка и без минимального порога превышения. Причина: товар может появиться на остатке позже, и перезамер нужно держать на контроле заранее. Если `warehouse_remains_volume <= cardVolume`, считаем, что WB уже скорректировал фактический объём, и красный гаснет.
- В таблице `/logistics` критичные красные замеры сортируются сверху по убыванию расхождения `последний WB-замер − объём карточки`; остальные строки идут прежним порядком.
- Article `178439058` больше не критичный: WB latest measurement `3.059 л`, card volume `2.5 л`, remains volume `0.99 л`; новая логика даёт `new_red=false`.
- Sidebar показывает красный треугольник на `Расчёт логистики` с числом критичных замеров из `/api/logistics/alerts`.
- 2026-07-26 production check после возврата старой логики: `/api/logistics/alerts` показывает 8 критичных items.
- `/logistics` показывает плашку новых замеров WB за последние 7 дней и кнопку `Посмотреть новые`; свежие замеры получают синюю метку `NEW`. Последняя проверка production: новых замеров = 4.
- Автосинк логистических объёмов:
  - `scripts/logistics-volume-sync.js --source remains` — WB `GET /api/v1/warehouse_remains` + task download, cron `0 3,6,9,12,15,18 * * *` UTC (06:00/09:00/12:00/15:00/18:00/21:00 MSK);
  - `scripts/logistics-volume-sync.js --source measurements` — WB `GET /api/analytics/v1/warehouse-measurements`, cron `10 3,6,9,12,15,18 * * *` UTC (06:10/09:10/12:10/15:10/18:10/21:10 MSK).
- Monitoring registry и watchdog знают `warehouse-remains-sync` и `warehouse-measurements-sync`.
- `scripts/health-collector.py` форматирует cron-часы человекочитаемо (`каждый час`, `каждые 5 мин`, `в 06:00, 09:00, 12:00, 15:00, 18:00, 21:00 МСК`).
- Локальная правка sidebar: меню по умолчанию свернуто, раскрывается при hover, фиксируется pin-кнопкой сверху; нижняя стрелка снята; картинка логотипа заменена текстом `MPHub` (`MP` серым, `Hub` фиолетовым); в collapsed state текст скрыт, чтобы не было артефакта слева у pin.

## Разрешения
- Читать файлы из Telegram tmp ТОЛЬКО по запросу пользователя
- SSH к VPS/VM (`wb-site`, `codex-cli`) для деплоя и администрирования; `claude-cli` — только legacy alias, если нужно проверить старую привязку
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
- `/api/monitor/*` использует `src/lib/monitor-auth.ts`, сейчас это тот же admin-check. Исключение: `/api/monitor/auth-status` read-only доступен странице `/settings` без monitor-admin и отдаёт только `ok/dead/checkedAt`, без секретов.
- Закрытые группы: `/api/finance/*`, `/api/data/*`, `/api/reviews/*`, `/api/wb/*`, `/api/monitor/*`.
- В production `JWT_SECRET` обязателен во время runtime. Dev fallback допустим только вне production runtime.
- Login rate-limit хранится в PostgreSQL (`auth_login_attempts`), не в памяти процесса.
- Security headers задаются в `next.config.ts`: noindex, nosniff, DENY frame, referrer/permissions policy, HSTS и CSP в production.
- Локальный nginx на VPS должен иметь `server_tokens off`.
- SQL со значениями из переменных писать параметризованно: `?` для helpers `pgRows`/`pgGet`, `$1...` для raw `pg` client; не собирать значения строковой вставкой.

## Режим работы
- Перед каждым ответом используй extended thinking (глубокий анализ)
- Рассмотри минимум 2-3 варианта решения перед выбором
- Проверь свои предположения перед действием
- Не угадывай — читай код и данные
- Даты всегда ДД.ММ (день.месяц), не ММ.ДД

## Dev сервер
- Порт: 3000
- Запуск с актуальными данными: сначала туннель `127.0.0.1:55432`, затем `PGPOOL_MAX=2 npm run dev -- -H 127.0.0.1 -p 3000`
- Если Turbopack падает на CSS: `PGPOOL_MAX=2 npm run dev -- --webpack -H 127.0.0.1 -p 3000`
- Билд: `npm run build`
