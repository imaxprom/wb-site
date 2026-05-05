# WB Ads — Техническая документация

> Дашборд управления рекламой Wildberries  
> Проект: `/Users/octopus/Projects/wb-ads`  
> Порт: 3001  
> Последнее обновление: апрель 2026

---

## 1. Общая архитектура

```
┌─────────────────────────────────────────────────────────┐
│                    Браузер (клиент)                       │
│  page.tsx → AdsNavigation + AdsFilters + AdsTable        │
│           → ControlPanel (sync, auto, theme)             │
│           → SettingsPanel (auth, API-token)               │
└────────────────────┬────────────────────────────────────┘
                     │ fetch()
                     ▼
┌─────────────────────────────────────────────────────────┐
│              Next.js API Routes (сервер)                  │
│                                                          │
│  GET /api/dashboard?days=N    ← главный endpoint          │
│  GET/POST /api/settings       ← настройки в БД            │
│  POST /api/sync/*             ← синхронизация с WB API    │
│  POST /api/wb/auth/*          ← авторизация WB            │
│  GET/POST /api/accounts       ← управление аккаунтами     │
└────────────────────┬────────────────────────────────────┘
                     │
          ┌──────────┼──────────┐
          ▼          ▼          ▼
    ┌──────────┐ ┌────────┐ ┌──────────────┐
    │ SQLite   │ │ WB API │ │ Puppeteer    │
    │ ads.db   │ │ (HTTP) │ │ (auth CDP)   │
    └──────────┘ └────────┘ └──────────────┘
```

**Стек:** Next.js 16 + TypeScript + Tailwind CSS 4 + SQLite (better-sqlite3) + Puppeteer + recharts

---

## 2. База данных (SQLite)

**Файл:** `data/ads.db` — 22 таблицы

### 2.1. Основные таблицы (данные из WB API)

#### `campaigns` — Рекламные кампании
```sql
CREATE TABLE campaigns (
    advert_id INTEGER PRIMARY KEY,
    name TEXT,
    type INTEGER,              -- NULL (не сохраняется из WB API)
    status INTEGER,            -- 9=активна, 11=пауза, 7=завершена
    daily_budget REAL,
    payment_type TEXT,         -- 'cpm' | 'cpc'
    create_time TEXT,
    change_time TEXT,
    start_time TEXT,
    end_time TEXT,
    nms_json TEXT,             -- JSON массив nm_id товаров: [322000486]
    subject_id INTEGER,
    bid_kopecks INTEGER,       -- текущая ставка (добавлено, из adverts API nm_settings)
    updated_at TEXT
);
```
**Источник:** `POST /api/sync/campaigns` → WB `advert-api` promotion/count + adverts v2  
**Записей:** ~332 (7 активных, 17 на паузе, 308 завершённых)  
**Важно:** `type` всегда NULL. Тип определяется по имени: "АВТО"→auto, "ПОИСК"→search

#### `campaign_stats_daily` — Статистика кампаний по дням
```sql
CREATE TABLE campaign_stats_daily (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    advert_id INTEGER,
    date TEXT,
    views INTEGER, clicks INTEGER, ctr REAL, cpc REAL, cpm REAL,
    sum REAL,              -- расход (руб)
    atbs INTEGER,          -- добавления в корзину (из рекламы)
    orders INTEGER,
    shks INTEGER,
    sum_price REAL,        -- сумма заказов
    cr REAL, canceled INTEGER,
    UNIQUE(advert_id, date)
);
```
**Источник:** `POST /api/sync/stats` → WB `advert-api` fullstats v3  
**Важно:** Sync включает паузированные кампании (status IN (9,11)). Используется как основной источник для adOrders/adCarts/adSpend (а НЕ campaign_stats_by_nm — тот теряет ~15% данных)

#### `campaign_stats_by_nm` — Статистика по товарам в кампаниях
```sql
CREATE TABLE campaign_stats_by_nm (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    advert_id INTEGER, nm_id INTEGER, date TEXT,
    views INTEGER, clicks INTEGER, ctr REAL, cpc REAL, cpm REAL,
    sum REAL, orders INTEGER, sum_price REAL, cr REAL,
    atbs INTEGER,          -- добавлено (корзины с рекламы per nm per day)
    UNIQUE(advert_id, nm_id, date)
);
```
**Источник:** fullstats v3 → apps[].nms[] агрегация  
**Важно:** Неполные данные (~85% от campaign_stats_daily). Используется только для fallback.

#### `sales_funnel_daily` — Воронка продаж по товарам
```sql
CREATE TABLE sales_funnel_daily (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nm_id INTEGER, date TEXT,
    open_card_count INTEGER,      -- просмотры карточки
    add_to_cart_count INTEGER,    -- корзины (общие: орг + рекл)
    orders_count INTEGER,         -- заказы (общие)
    orders_sum REAL,              -- сумма заказов
    buyouts_count INTEGER,        -- выкупы
    buyouts_sum REAL,
    cancel_count INTEGER,
    add_to_cart_conversion REAL,
    cart_to_order_conversion REAL,
    buyout_percent REAL,
    UNIQUE(nm_id, date)
);
```
**Источник:** `POST /api/sync/funnel?days=N` → WB `seller-analytics-api` sales-funnel/products  
**Важно:** WB кэширует данные ~15 мин. При sync/all запрашивается только за 1 день (быстро).  
**Ограничение:** НЕТ viewCount (показы в выдаче). Для viewCount → auth_wb_funnel_daily.

#### `auth_wb_funnel_daily` — Воронка Джем (закрытый API seller-content)
```sql
CREATE TABLE auth_wb_funnel_daily (
    nm_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    view_count INTEGER DEFAULT 0,           -- показы в выдаче (УНИКАЛЬНО!)
    open_card_count INTEGER DEFAULT 0,      -- переходы в карточку
    add_to_cart_count INTEGER DEFAULT 0,    -- добавления в корзину
    add_to_wishlist_count INTEGER DEFAULT 0,-- добавления в избранное
    orders_count INTEGER DEFAULT 0,         -- заказы, шт.
    orders_sum REAL DEFAULT 0,              -- заказы, руб.
    buyouts_count INTEGER DEFAULT 0,        -- выкупы, шт.
    buyouts_sum REAL DEFAULT 0,             -- выкупы, руб.
    cancel_count INTEGER DEFAULT 0,         -- отмены, шт.
    cancel_sum REAL DEFAULT 0,              -- отмены, руб.
    view_to_open_conversion REAL DEFAULT 0, -- CTR (показы→переходы), %
    open_to_cart_conversion REAL DEFAULT 0, -- CR в корзину, %
    cart_to_order_conversion REAL DEFAULT 0,-- CR в заказ, %
    buyout_percent REAL DEFAULT 0,          -- процент выкупа, %
    PRIMARY KEY (nm_id, date)
);
```
**Источник:** `POST /api/sync/auth-wb-funnel?days=N` → WB `seller-content.wildberries.ru`  
**Endpoint:** `/ns/analytics-api/content-analytics/api/v1/sales-funnel/report/product/history`  
**Авторизация:** Puppeteer-браузер + заголовок `Authorizev3` (JWT из `localStorage["wb-eu-passport-v2.access-token"]`) + `credentials: "include"`  
**Rate limit:** ~1 req/sec (по одному товару), фоновое обновление каждые 5 часов  

**Отличие от `sales_funnel_daily`:**
| Метрика | sales_funnel_daily (открытый) | auth_wb_funnel_daily (закрытый) |
|---------|------------------------------|-------------------------------|
| viewCount (показы в выдаче) | НЕТ | ЕСТЬ |
| buyoutCount/Sum | есть | есть |
| cancelCount/Sum | есть | есть |
| addToWishlistCount | нет | ЕСТЬ |
| Авторизация | API-токен (серверный) | Puppeteer + Authorizev3 |
| Зависимость | нет | нужен запущенный браузер |

**Как это работает:**
1. Запускается снифер-браузер (`POST /api/wb/sniff`) → Puppeteer открывает Chrome
2. Браузер авторизуется на `seller.wildberries.ru`
3. Из контекста страницы (`page.evaluate`) читается токен из localStorage
4. Из контекста страницы делается `fetch()` к seller-content с заголовком `Authorizev3`
5. WB отдаёт полную воронку включая viewCount
6. Данные сохраняются в `auth_wb_funnel_daily`

**Почему нельзя без Puppeteer:** WB защищает seller-content от серверных запросов. Прямой HTTP → 401 или нули. Решение найдено через реверс-инжиниринг расширения EVIRMA 2 (Chrome Web Store, ID: deonmlokidjdcbcihdjdoebmihbmnfdc).

#### `products` — Карточки товаров
```sql
CREATE TABLE products (
    nm_id INTEGER PRIMARY KEY,
    vendor_code TEXT, title TEXT, subject TEXT, brand TEXT,
    colors TEXT,              -- через запятую
    rating REAL,              -- 4.8 (из sales-funnel/products feedbackRating)
    feedbacks INTEGER,        -- 0 (API для подсчёта недоступен)
    price INTEGER,            -- полная цена (руб, из WB Prices API)
    discount INTEGER,         -- скидка поставщика % (из WB Prices API)
    sale_price INTEGER,       -- цена покупателю (0 — card.wb.ru отключён)
    spp REAL,                 -- СПП % (0 — нет данных)
    updated_at TEXT
);
```
**Источник:** `POST /api/sync/products` → WB Content API + Prices API + sales-funnel/products  
**Записей:** 29

#### `stocks` — Остатки по складам
```sql
CREATE TABLE stocks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nm_id INTEGER, warehouse TEXT,
    quantity INTEGER, quantity_full INTEGER,
    price REAL, discount INTEGER,
    updated_at TEXT
);
```
**Источник:** `POST /api/sync/stocks` → WB Statistics API stocks (полная перезапись при каждом sync)

#### `search_cluster_stats` — Поисковые кластеры
```sql
CREATE TABLE search_cluster_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    advert_id INTEGER, nm_id INTEGER,
    norm_query TEXT,           -- поисковый запрос
    date TEXT,
    views INTEGER, clicks INTEGER, ctr REAL, cpc REAL, cpm REAL,
    orders INTEGER, avg_pos REAL, atbs INTEGER,
    UNIQUE(advert_id, nm_id, norm_query, date)
);
```
**Источник:** `POST /api/sync/clusters` → WB `advert-api` normquery/stats v0  
**Важно:** Weekly snapshot (агрегат за 7 дней). В dashboard берётся по MAX(date).

### 2.2. Таблицы настроек

#### `settings` — Настройки приложения (key-value)
```
dashboard_period    — выбранный период (1/2/3/5/7/10/14/30/60/90)
active_tab          — активный таб (cards/settings)
theme               — тема (violet/arctic/neon)
auto_sync_enabled   — автообновление (true/false)
auto_sync_interval  — интервал в минутах (5/10/15/30/60)
col_widths          — JSON ширин столбцов
col_order           — JSON порядка столбцов
col_hidden          — JSON скрытых столбцов
```

#### `accounts` — Авторизованные аккаунты WB
```sql
CREATE TABLE accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT UNIQUE,
    name TEXT, connection TEXT, access TEXT,
    supplier_id TEXT, supplier_name TEXT, store_name TEXT,
    created_at TEXT
);
```

### 2.3. Прочие таблицы

| Таблица | Статус | Описание |
|---|---|---|
| `balance_history` | Используется | Баланс рекламного кабинета |
| `campaign_budgets` | Используется | Текущие бюджеты кампаний |
| `search_cluster_bids` | Используется | Ставки по кластерам |
| `bid_history` | Частично | История рекомендованных ставок |
| `product_promotions` | Пустая | Акции (наши товары не участвуют) |
| `minus_phrases` | Не отображается | 3754 минус-фразы (в дашборде не показываются) |
| `expense_history` | Пустая | История списаний |
| `payment_history` | Пустая | История пополнений |
| `positions` | Пустая | Для будущего wb-parser |
| `competitors` | Пустая | Для будущего анализа конкурентов |
| `competitor_positions` | Пустая | Позиции конкурентов |
| `automation_rules` | Пустая | Для будущей автоматизации ставок |
| `automation_log` | Пустая | Лог автоматизации |

---

## 3. WB API — Используемые endpoints

### 3.1. Advertising API (`advert-api.wildberries.ru`)

| Метод | Endpoint | Что получаем | Rate Limit |
|---|---|---|---|
| GET | `/adv/v1/promotion/count` | ID всех кампаний | 5 req/s |
| GET | `/api/advert/v2/adverts?ids=...` | Детали кампаний + nm_settings + bids_kopecks | 5 req/s |
| GET | `/adv/v3/fullstats?ids=...&beginDate=...&endDate=...` | Дневная статистика + разбивка по nm + atbs | — |
| GET | `/adv/v1/balance` | Баланс рекламного кабинета | 1 req/s |
| GET | `/adv/v1/budget?id=...` | Бюджет кампании | 4 req/s |
| POST | `/adv/v0/normquery/stats` | Статистика кластеров (weekly aggregated) | 10 req/min |
| POST | `/adv/v0/normquery/get-bids` | Ставки по кластерам | 5 req/s |

### 3.2. Analytics API (`seller-analytics-api.wildberries.ru`)

| Метод | Endpoint | Что получаем |
|---|---|---|
| POST | `/api/analytics/v3/sales-funnel/products` | Корзины, заказы, выручка по товарам + feedbackRating + stocks |

**Важно:** WB кэширует ответ ~15 мин. Одинаковые параметры → одинаковый ответ.

### 3.3. Content API (`content-api.wildberries.ru`)

| Метод | Endpoint | Что получаем |
|---|---|---|
| POST | `/content/v2/get/cards/list` | Карточки товаров: nmId, vendorCode, title, subjectName, colors, characteristics |

### 3.4. Prices API (`discounts-prices-api.wildberries.ru`)

| Метод | Endpoint | Что получаем |
|---|---|---|
| GET | `/api/v2/list/goods/filter?limit=1000` | Цены: price, discount, discountedPrice по размерам |

### 3.5. Statistics API (`statistics-api.wildberries.ru`)

| Метод | Endpoint | Что получаем |
|---|---|---|
| GET | `/api/v1/supplier/stocks?dateFrom=...` | Остатки по складам: nmId, quantity, warehouseName, Price, Discount |

### 3.6. Promotions API (`dp-calendar-api.wildberries.ru`)

| Метод | Endpoint | Что получаем |
|---|---|---|
| GET | `/api/v1/calendar/promotions?startDateTime=...&endDateTime=...` | Список акций |
| GET | `/api/v1/calendar/promotions/nomenclatures?promotionID=...&inAction=true` | Товары в акции |

**Токен:** нужен scope "Цены и скидки". Rate limit: 10 req / 6 sec.

### 3.7. Auth API (`seller-auth.wildberries.ru`)

Авторизация через CDP (Puppeteer headless browser):
1. Открываем `seller-auth.wildberries.ru` → антибот F.A.C.C.T. генерирует `captcha_token`
2. Вводим номер телефона через UI страницы → WB отправляет SMS
3. Вводим код из SMS → получаем `authorizev3` токен + cookies
4. Обмениваем на `wb-seller-lk` токен через `seller.wildberries.ru/ns/suppliers-auth/...`

**Файлы:**
- `wb-auth-cdp.ts` — Puppeteer CDP (работает)
- `wb-auth-http.ts` — чистый HTTP (НЕ работает — WB требует captcha_token)
- `wb-seller-api.ts` — refresh токенов, проверка сессии

### 3.8. Недоступные API

| Что нужно | Почему нет |
|---|---|
| Buyer price (salePriceU) | card.wb.ru отключён (миграция *.wb.ru → *.wildberries.ru) |
| СПП (скидка WB) | Только через card.wb.ru |
| Feedbacks count | feedbacks-api требует scope "Отзывы и вопросы" (наш токен не имеет) |
| Дневные кластеры | v1 normquery/stats возвращает null для наших кампаний |
| Имя ИП/магазина | WB supplier endpoints возвращают ошибки |

---

## 4. Dashboard API — логика агрегации

**Endpoint:** `GET /api/dashboard?days=N`

### 4.1. Расчёт дат
```typescript
const dateTo = today
const dateFrom = today - (days - 1) days
// "Сегодня" (days=1): dateFrom = dateTo = today
// "Неделя" (days=7): dateFrom = 6 дней назад
```

### 4.2. SQL-запросы (выполняются параллельно)

1. **products** — `SELECT * FROM products`
2. **Ad stats** — `campaign_stats_daily` за период, маппинг на nm_id через `campaigns.nms_json`
   - Включает ВСЕ кампании с nms_json (не только status 9/11)
   - adSpend, adOrders, adCarts агрегируются из campaign_stats_daily
3. **Funnel** — `sales_funnel_daily` за период по nm_id → carts, orders, ordersSum
4. **Stocks** — `stocks` агрегация по nm_id → stockQty
5. **Campaigns** — `campaigns WHERE status IN (9,11) OR advert_id IN (с расходом за период)`
6. **Campaign spend** — `campaign_stats_daily` за период по advert_id
7. **Budgets** — `campaign_budgets` → dailyBudget для кампаний
8. **Bids** — `bid_history` последняя запись (fallback для bid_kopecks из campaigns)
9. **Visibility** — `search_cluster_stats WHERE date = MAX(date)` → queriesCount
10. **Ad carts** — `search_cluster_stats WHERE date = MAX(date)` → fallback для adCarts
11. **Promotions** — `product_promotions` → labels

### 4.3. Объединение
- Все nm_id собираются из products + adStats + funnel + stocks + campaigns
- Для каждого nm_id формируется `DashboardProduct`
- ДРР рассчитывается: `adSpend / ordersSum * 100`
- stockValue: `stockQty * deliveryPrice` (из products.price * (100-discount)/100)

---

## 5. Фронтенд — компонентная архитектура

```
page.tsx
├── ControlPanel (fixed top-right)
│   ├── 🔄 Sync button → SyncModal
│   ├── Auto-sync (checkbox + interval + countdown)
│   └── Theme switcher (Violet/Arctic/Neon)
│
├── AdsNavigation (tabs)
│   ├── "Выдача WB" (disabled)
│   ├── "Карточки" → dashboard content
│   ├── "Реклама" (disabled)
│   └── "Настройки" → SettingsPanel
│
├── [tab=cards] AdsFilters + ColumnSettings(⚙) + AdsTable
│   │
│   ├── AdsFilters
│   │   ├── 🔄 sync button
│   │   ├── Search input (nmId/vendorCode)
│   │   ├── Grouping select (stub)
│   │   ├── Archive checkbox
│   │   ├── Period select (saves to DB)
│   │   └── Summary (ordersSum / adsSpend)
│   │
│   ├── ColumnSettings (⚙ gear icon)
│   │   └── Checkboxes to hide/show columns
│   │
│   └── AdsTable
│       ├── AdsTableHeader (14 columns)
│       │   ├── Tooltips on hover
│       │   ├── Sort (click: none→desc→asc→none)
│       │   ├── Drag-to-reorder columns
│       │   └── Resize handles (2px, col-resize cursor)
│       │
│       └── AdsTableRow × N
│           ├── ProductCell (sticky left, photo + title + nmId)
│           ├── SubjectCell
│           ├── ColorsCell
│           ├── LabelsCell (stub "—")
│           ├── RatingCell (★ 4.8)
│           ├── PriceCell (~1083₽)
│           ├── StockCell (qty шт.)
│           ├── OrdersCell (CartIcon + BoxIcon, aligned)
│           ├── DrrCell (colored %)
│           ├── AdsSpendCell (carts×cost, orders×cost, total)
│           ├── CampaignCell × 3 (Auto/Auction/CPC)
│           │   └── StatusBadge (green play / gray pause)
│           └── VisibilityCell (catalog + queries)
│
├── [tab=settings] SettingsPanel
│   ├── TopActions (phone input + API token button)
│   ├── AccountsTable (phone, name, connection, access, ID)
│   └── StoresTable (user, API-token, data, name)
│
└── SyncModal
    └── 8 steps with progress (✓ / ✕ / spinner)
```

---

## 6. Sync-модули

### Порядок выполнения (sync/all)
1. **campaigns** — список кампаний + ставки
2. **products** — карточки + цены + рейтинг
3. **stocks** — остатки (полная перезапись)
4. **stats** — fullstats за 7 дней (active + paused)
5. **balance** — баланс + бюджеты
6. **clusters** — поисковые кластеры
7. **funnel?days=1** — воронка за сегодня

### Rate limits соблюдаются
- advert-api: 200ms между batch-запросами
- analytics-api (funnel): 3000ms между запросами (429 retry с 10-20s delay)
- budget: 250ms между запросами
- calendar-api (promotions): 700ms между запросами

---

## 7. Авторизация и безопасность

### API-ключ
- Хранится: `data/wb-api-key.txt`
- Права на production: `600`, каталог `data` закрыт `700`
- Управление: `GET/PUT/DELETE /api/settings/apikey`
- JWT payload содержит: oid (1166225), sid, uid — но НЕ имя магазина

### Browser Auth (Puppeteer CDP)
- Токены: `data/wb-tokens.json` (authorizev3, wbSellerLk, supplierId, cookies)
- Права на production: `600`; debug-артефакты авторизации не хранить постоянно
- wb-seller-lk обновляется автоматически при истечении (refresh через suppliers-auth API)
- Аккаунты: таблица `accounts` в БД (поддержка нескольких номеров)

### Supplier IDs
- **262998** — из browser auth (supplierId)
- **1166225** — из API-ключа (oid)
- Это разные ID одного кабинета (262998 = seller ID, 1166225 = organization ID)

---

## 8. Товары в системе

13 уникальных nm_id из рекламных кампаний:
```
163785912, 165140159, 178439058, 322000486, 333768802,
386566779, 388156471, 398657691, 399612115, 431925632,
431926725, 431927756, 580062620
```
+ 16 дополнительных из Content API (всего 29 в products)

**Бренд:** IMSI  
**Категория:** Трусы, Стринги  
**Магазин:** IMSI Каталог
