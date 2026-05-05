# MpHub — Полная инструкция по базам данных и памяти системы

> Этот документ описывает ВСЮ структуру хранения данных проекта MpHub.
> Его можно скормить AI-агенту для воспроизведения идентичной архитектуры с нуля.

---

## 1. Обзор архитектуры хранения

MpHub хранит данные в трёх слоях:

| Слой | Технология | Назначение |
|------|-----------|------------|
| **Серверная БД** | SQLite (WAL) | Финансы, заказы, отзывы, пользователи |
| **JSON-файлы** | Плоские файлы | Токены, статусы синхронизации, мониторинг |
| **Статические данные** | JSON в public/ | Документация, changelog, здоровье сервисов |

Клиентский IndexedDB **не используется** (легаси очищается при запуске).

### Файловая карта

```
data/
  finance.db              ← Главная БД (1.5 ГБ): финансы + отгрузка + отзывы + пользователи
  finance.db-shm          ← WAL shared memory
  finance.db-wal          ← Write-ahead log
  weekly_reports.db       ← Excel-отчёты из ЛК WB (294 МБ)
  weekly_reports.db-shm
  weekly_reports.db-wal
  wb-tokens.json          ← Токены WB Seller Portal (authorizev3, wbSellerLk, cookies)
  wb-api-key.txt          ← API-ключ WB (JWT ES256)
  daily-sync-status.json  ← История синхронизации (последние 30 дней)
  wb-auth-log.json        ← Лог HTTP-запросов авторизации WB
  wb-sniffed-requests.json ← Перехваченные запросы браузера
  wb-cookies-full.json    ← CDP cookies всех доменов
  wb-cookies-meta.json    ← Метаданные cookies (savedAt)
  wb-localstorage.json    ← localStorage браузера WB
  *.log                   ← Логи cron-скриптов (без ротации)

public/data/
  docs.json               ← База знаний (разделы, блоки)
  changelog.json          ← История изменений
  monitor/
    status.json           ← Здоровье production-сервисов (PM2 + cron)
    monitor-registry.json ← Реестр production-сервисов
    data-health-cron.json ← Последний снимок здоровья данных
    repair-state.json     ← Состояние circuit breaker watchdog
    repair-log.json       ← История автовосстановлений (200 записей)
    changes.json          ← Журнал изменений скриптов
  finance/
    pnl.json, daily.json, articles.json, cogs.json, ...
    history/              ← Помесячные архивы P&L
```

---

## 2. finance.db — Главная база данных

**Файл:** `data/finance.db`
**Размер:** ~1.5 ГБ
**Режим журнала:** WAL (Write-Ahead Logging)
**Кэш:** 64 МБ (`PRAGMA cache_size = -64000`)

### Как открыть подключение

```typescript
import Database from "better-sqlite3";

// Только чтение (для API routes)
const db = new Database("data/finance.db", { readonly: true });
db.pragma("journal_mode = WAL");
db.pragma("cache_size = -64000");
db.pragma("busy_timeout = 5000");  // Ожидание 5 сек при блокировке

// Чтение + запись (для импорта данных)
const writeDb = new Database("data/finance.db");
writeDb.pragma("journal_mode = WAL");
```

**Паттерн подключения:** Каждый модуль имеет своё собственное подключение (модульная изоляция). Финансы, Отгрузка и Аналитика открывают независимые readonly-соединения к finance.db.

---

### 2.1 Таблица `realization` — Реализация WB

Главная таблица финансов. Содержит построчные данные отчёта реализации Wildberries.

```sql
CREATE TABLE realization (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rrd_id INTEGER,                          -- ID строки в отчёте WB
    realizationreport_id INTEGER,            -- ID отчёта (>=900000000 = daily, <900000000 = weekly)
    date_from TEXT,                          -- Начало периода отчёта
    date_to TEXT,                            -- Конец периода отчёта
    rr_dt TEXT,                              -- Дата записи в отчёт WB (для услуг: логистика, хранение)
    sale_dt TEXT,                            -- Дата продажи (для продаж/возвратов)
    order_dt TEXT,                           -- Дата заказа покупателем
    supplier_oper_name TEXT,                 -- Тип операции: "Продажа", "Возврат", "Логистика", "Коррекция логистики", "Коррекция продаж", "Хранение" и т.д.
    nm_id INTEGER,                           -- Номенклатура WB (артикул WB)
    sa_name TEXT,                            -- Артикул поставщика
    ts_name TEXT,                            -- Размер
    barcode TEXT,                            -- Баркод товара
    brand_name TEXT,                         -- Бренд
    subject_name TEXT,                       -- Предмет (категория)
    quantity INTEGER DEFAULT 0,              -- Количество
    retail_price REAL DEFAULT 0,             -- Розничная цена
    retail_price_withdisc_rub REAL DEFAULT 0, -- Цена со скидкой
    retail_amount REAL DEFAULT 0,            -- Сумма реализации
    ppvz_for_pay REAL DEFAULT 0,             -- К перечислению продавцу
    ppvz_sales_commission REAL DEFAULT 0,    -- Комиссия WB
    acquiring_fee REAL DEFAULT 0,            -- Эквайринг
    delivery_rub REAL DEFAULT 0,             -- Стоимость доставки
    delivery_amount INTEGER DEFAULT 0,       -- Кол-во доставок
    return_amount INTEGER DEFAULT 0,         -- Кол-во возвратов
    storage_fee REAL DEFAULT 0,              -- Хранение
    penalty REAL DEFAULT 0,                  -- Штрафы
    acceptance REAL DEFAULT 0,               -- Приёмка
    rebill_logistic_cost REAL DEFAULT 0,     -- Возмещение логистики
    additional_payment REAL DEFAULT 0,       -- Разовые доплаты
    commission_percent REAL DEFAULT 0,       -- Процент комиссии
    ppvz_spp_prc REAL DEFAULT 0,             -- СПП %
    ppvz_kvw_prc_base REAL DEFAULT 0,        -- кВВ базовый %
    ppvz_kvw_prc REAL DEFAULT 0,             -- кВВ итоговый %
    ppvz_supplier_name TEXT,                 -- Юрлицо продавца
    site_country TEXT,                       -- Страна
    office_name TEXT,                        -- Офис доставки
    deduction REAL DEFAULT 0,                -- Удержания
    bonus_type_name TEXT DEFAULT "",          -- Тип бонуса (Джем/лояльность)
    source TEXT DEFAULT 'weekly'             -- Источник: 'weekly', 'daily', 'weekly_final'
);

-- Индексы для быстрого поиска
CREATE INDEX idx_real_sale_dt ON realization(sale_dt);
CREATE INDEX idx_real_rr_dt ON realization(rr_dt);
CREATE INDEX idx_real_op_sale_dt ON realization(supplier_oper_name, sale_dt);
CREATE INDEX idx_real_op_rr_dt ON realization(supplier_oper_name, rr_dt);
CREATE INDEX idx_real_op_nm ON realization(supplier_oper_name, nm_id, sa_name, brand_name, subject_name);
CREATE INDEX idx_real_op_supplier ON realization(supplier_oper_name, ppvz_supplier_name);
CREATE INDEX idx_real_source_dates ON realization(source, date_from, date_to);
```

**Ключевое правило:** Продажи фильтруются по `sale_dt`, а услуги (логистика, хранение, штрафы) — по `rr_dt`. Это **разные даты**.

**Источники данных (`source`):**
- `'daily'` — ежедневный отчёт через API (realizationreport_id >= 900000000)
- `'weekly'` — еженедельный отчёт через API
- `'weekly_final'` — финальный Excel из ЛК WB

---

### 2.2 Таблица `advertising` — Рекламные расходы

```sql
CREATE TABLE advertising (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT,                   -- Дата (YYYY-MM-DD)
    campaign_name TEXT,          -- Название кампании
    campaign_id INTEGER,         -- ID кампании WB
    amount REAL DEFAULT 0,       -- Сумма расхода
    payment_type TEXT,           -- Тип оплаты
    nm_id INTEGER DEFAULT 0     -- Артикул WB (маппинг campaign→nm_id через /api/advert/v2/adverts)
);

CREATE INDEX idx_ad_date ON advertising(date);
```

**Маппинг nm_id:** При синке рекламы campaign_id маппится в nm_id через WB API `/api/advert/v2/adverts`. Если маппинг не сработал — nm_id = 0, синк помечается как нестабильный (повторится на следующем цикле).

---

### 2.3 Таблица `orders_funnel` — Воронка заказов

```sql
CREATE TABLE orders_funnel (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT UNIQUE,            -- Дата (YYYY-MM-DD), одна строка на день
    order_sum REAL DEFAULT 0,    -- Сумма заказов
    order_count INTEGER DEFAULT 0, -- Количество заказов
    buyout_sum REAL DEFAULT 0,   -- Сумма выкупов
    buyout_count INTEGER DEFAULT 0 -- Количество выкупов
);

CREATE INDEX idx_funnel_date ON orders_funnel(date);
```

---

### 2.4 Таблица `cogs` — Себестоимость

```sql
CREATE TABLE cogs (
    barcode TEXT PRIMARY KEY,    -- Баркод товара
    cost REAL DEFAULT 0          -- Себестоимость единицы
);
```

**Управление:** через API `GET/PUT /api/finance/cogs`.

---

### 2.5 Таблица `settings` — Глобальные настройки

```sql
CREATE TABLE settings (
    key TEXT PRIMARY KEY,        -- Ключ настройки
    value TEXT                   -- Значение (JSON-строка)
);
```

---

### 2.6 Таблица `tax_settings` — Налоговые ставки

```sql
CREATE TABLE tax_settings (
    key TEXT PRIMARY KEY,        -- 'nds_rate', 'usn_rate'
    value REAL                   -- Ставка (например 5.0, 1.0)
);
```

---

### 2.7 Таблица `users` — Пользователи

```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,          -- Логин (уникальный)
    password_hash TEXT NOT NULL,         -- Формат: "pbkdf2-sha256:iterations:salt:hash"
    name TEXT,                           -- Отображаемое имя
    role TEXT DEFAULT 'user',            -- 'admin' или 'user'
    created_at TEXT DEFAULT (datetime('now'))
);
```

**Пароль:** новые хэши пишутся как `pbkdf2-sha256:iterations:salt:hash`.
**Проверка:** `crypto.timingSafeEqual()` для защиты от timing-атак; legacy `salt:sha256hash` поддерживается только для обратной совместимости и обновляется при следующем успешном входе.
**Важно:** production больше не создаёт дефолтного `admin/admin`; админ-пользователь должен быть создан или выдан осознанно.

---

### 2.8 Таблица `user_settings` — Настройки пользователя

```sql
CREATE TABLE user_settings (
    user_id INTEGER NOT NULL,
    key TEXT NOT NULL,                   -- 'buyoutMode', 'buyoutRate', 'regionMode', 'uploadDays', 'boxDimensions'
    value TEXT,                          -- JSON-строка
    PRIMARY KEY(user_id, key),
    FOREIGN KEY(user_id) REFERENCES users(id)
);
```

**Ключи настроек:**
- `buyoutMode` — режим расчёта выкупа
- `buyoutRate` — процент выкупа
- `regionMode` — режим регионов
- `uploadDays` — дней для загрузки
- `boxDimensions` — размеры коробов (JSON)

---

### 2.9 Таблица `product_overrides` — Пользовательские настройки товаров

```sql
CREATE TABLE product_overrides (
    user_id INTEGER NOT NULL,
    article_wb TEXT NOT NULL,            -- Артикул WB
    barcode TEXT NOT NULL,               -- Баркод
    custom_name TEXT,                    -- Кастомное имя товара
    per_box INTEGER,                     -- Штук в коробе
    disabled INTEGER DEFAULT 0,          -- Отключён ли размер
    PRIMARY KEY(user_id, article_wb, barcode),
    FOREIGN KEY(user_id) REFERENCES users(id)
);
```

---

### 2.10 Таблица `shipment_orders` — Заказы (отгрузка)

```sql
CREATE TABLE shipment_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT,                           -- Дата заказа (YYYY-MM-DD)
    warehouse TEXT,                      -- Склад WB
    federal_district TEXT,               -- Федеральный округ
    region TEXT,                         -- Регион покупателя
    article_seller TEXT,                 -- Артикул поставщика
    article_wb INTEGER,                  -- Артикул WB (nm_id)
    barcode TEXT,                        -- Баркод
    category TEXT,                       -- Категория
    subject TEXT,                        -- Предмет
    brand TEXT,                          -- Бренд
    size TEXT,                           -- Размер
    total_price REAL,                    -- Полная цена
    discount_percent REAL,               -- Скидка %
    spp REAL,                            -- СПП
    finished_price REAL,                 -- Итоговая цена
    price_with_disc REAL,                -- Цена со скидкой
    is_cancel INTEGER,                   -- Отменён (0/1)
    cancel_date TEXT,                    -- Дата отмены
    UNIQUE(barcode, date, warehouse)
);
```

**Источник:** WB Statistics API `/api/v1/supplier/orders`.
**Синхронизация:** `shipment-sync.sh` → `POST /api/data/sync` → INSERT с ON CONFLICT DO UPDATE (обновляет is_cancel и cancel_date при повторном синке).

---

### 2.11 Таблица `shipment_stock` — Остатки на складах

```sql
CREATE TABLE shipment_stock (
    barcode TEXT,                         -- Баркод
    article_wb TEXT,                      -- Артикул WB
    article_seller TEXT,                  -- Артикул поставщика
    brand TEXT,                           -- Бренд
    size TEXT,                            -- Размер
    warehouse TEXT,                       -- Склад
    quantity INTEGER,                     -- Количество на складе
    updated_at TEXT,                      -- Дата обновления
    PRIMARY KEY(barcode, warehouse)
);
```

**Обновление:** полная перезапись (REPLACE) при каждой синхронизации.

---

### 2.12 Таблица `shipment_products` — Каталог товаров

```sql
CREATE TABLE shipment_products (
    article_wb TEXT PRIMARY KEY,          -- Артикул WB (nm_id как текст)
    name TEXT,                            -- Название
    brand TEXT,                           -- Бренд
    category TEXT,                        -- Категория
    sizes_json TEXT                       -- JSON массив размеров [{techSize, barcode, ...}]
);
```

**Источник:** WB Content API `/content/v2/get/cards/list` (пагинация по 100).

---

### 2.13 Таблица `shipment_meta` — Метаданные отгрузки

```sql
CREATE TABLE shipment_meta (
    key TEXT PRIMARY KEY,                 -- 'uploadDate'
    value TEXT                            -- ISO дата последней синхронизации
);
```

---

### 2.14 Таблица `paid_storage` — Платное хранение

```sql
CREATE TABLE paid_storage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT NOT NULL,                   -- Дата (YYYY-MM-DD)
    nm_id INTEGER NOT NULL,              -- Артикул WB
    barcode TEXT,                         -- Баркод
    warehouse TEXT,                       -- Склад
    warehouse_price REAL DEFAULT 0,      -- Стоимость хранения
    barcodes_count INTEGER DEFAULT 0,    -- Кол-во баркодов
    vendor_code TEXT,                    -- Артикул поставщика
    subject TEXT,                        -- Предмет
    volume REAL DEFAULT 0               -- Объём
);

CREATE INDEX idx_ps_date_nm ON paid_storage(date, nm_id);
```

**Источник:** WB API `/api/v1/paid_storage` (создание задачи → poll → download).
**Синхронизация:** `src/lib/sync/storage.ts`, ежедневно.

---

### 2.15a Таблица `buyout_rates` — Процент выкупа по артикулам

```sql
CREATE TABLE buyout_rates (
    article_wb TEXT PRIMARY KEY,          -- Артикул WB (nm_id)
    orders INTEGER,                       -- Заказы (доставки из Логистики)
    buyouts INTEGER,                      -- Выкупы (Продажи)
    buyout_rate REAL,                     -- % выкупа = buyouts / orders
    updated_at TEXT DEFAULT (datetime('now'))
);
```

**Источник данных:** `realization` (delivery_amount из Логистики = заказы, quantity из Продажи = выкупы). Дедупликация weekly_final > weekly > daily.
**Обновление:** при загрузке еженедельных отчётов (`sync-weekly-report.js`) и доступен через API `GET /api/data/buyout-rates`.
**Используется:** расчёт отгрузки (модуль Shipment) для определения % выкупа по артикулам.

---

### 2.15b Таблица `weekly_buyout_stats` — Статистика выкупов по неделям

```sql
CREATE TABLE weekly_buyout_stats (
    period_from TEXT,                     -- Начало недели (YYYY-MM-DD)
    period_to TEXT,                       -- Конец недели
    orders INTEGER,                       -- Заказы (доставки)
    buyouts INTEGER,                      -- Выкупы (продажи)
    returns INTEGER,                      -- Возвраты = orders - buyouts
    return_rate REAL,                     -- % возвратов
    PRIMARY KEY(period_from, period_to)
);
```

**Обновление:** при загрузке еженедельных отчётов (`sync-weekly-report.js`).

---

### 2.14 Таблица `review_accounts` — Аккаунты отзывов

```sql
CREATE TABLE review_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,                   -- Имя аккаунта
    store_name TEXT,                      -- Название магазина
    inn TEXT,                             -- ИНН
    supplier_id TEXT,                     -- ID поставщика WB
    api_key TEXT NOT NULL,                -- WB API ключ (Bearer token)
    cookie_status TEXT DEFAULT 'inactive', -- Статус cookie-авторизации
    api_status TEXT DEFAULT 'inactive',   -- Статус API
    auto_replies INTEGER DEFAULT 0,       -- Автоответы вкл/выкл
    auto_dialogs INTEGER DEFAULT 0,       -- Автодиалоги вкл/выкл
    auto_complaints INTEGER DEFAULT 0,    -- Автожалобы вкл/выкл
    use_auto_proxy INTEGER DEFAULT 1,     -- Использовать прокси
    settings_json TEXT,                   -- JSON с настройками (лимиты, причины, исключения)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    wb_authorize_v3 TEXT,                 -- Токен авторизации WB (для complaints API)
    wb_validation_key TEXT,               -- Validation key для cookies
    wb_cookie_updated_at DATETIME,        -- Когда обновлены cookies
    wb_seller_lk TEXT                     -- Seller LK токен
);
```

**settings_json пример:**
```json
{
  "daily_limit": 50,
  "complaint_reasons": [11, 13, 16, 18, 20],
  "excluded_articles": "артикул1\nартикул2",
  "manager_names": ["Анна", "Мария", "Елена"]
}
```

---

### 2.15 Таблица `reviews` — Отзывы

```sql
CREATE TABLE reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER REFERENCES review_accounts(id),
    wb_review_id TEXT UNIQUE,             -- Уникальный ID отзыва в WB
    date DATETIME,                        -- Дата отзыва
    rating INTEGER,                       -- Оценка (1-5)
    product_name TEXT,                    -- Название товара
    product_article TEXT,                 -- Артикул товара
    brand TEXT,                           -- Бренд
    review_text TEXT,                     -- Текст отзыва
    pros TEXT,                            -- Достоинства
    cons TEXT,                            -- Недостатки
    buyer_name TEXT,                      -- Имя покупателя
    buyer_chat_id TEXT,                   -- ID чата с покупателем
    price REAL,                           -- Цена покупки (обогащение из Orders API)
    status TEXT DEFAULT 'new',            -- 'new', 'replied'
    complaint_status TEXT,                -- 'pending', 'submitted', 'approved', 'rejected'
    is_hidden INTEGER DEFAULT 0,          -- Скрыт ли отзыв
    is_updated INTEGER DEFAULT 0,         -- Был ли обновлён
    is_excluded_rating INTEGER DEFAULT 0, -- Исключён из рейтинга
    purchase_type TEXT,                   -- Тип покупки
    store_name TEXT,                      -- Магазин
    pickup_point TEXT,                    -- ПВЗ (обогащение из Orders API)
    comment TEXT,                         -- Комментарий
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    shk_id INTEGER,                       -- Стикер (ШК) для связи с заказом
    order_date DATETIME,                  -- Дата заказа (обогащение)
    bables TEXT                           -- JSON с бейджами покупателя
);
```

**Обогащение:** `reviews-sync.js` по `shk_id` находит заказ в Orders API и добавляет `price`, `pickup_point`, `order_date`.

---

### 2.16 Таблица `review_complaints` — Жалобы на отзывы

```sql
CREATE TABLE review_complaints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    review_id INTEGER REFERENCES reviews(id),
    account_id INTEGER REFERENCES review_accounts(id),
    wb_review_id TEXT NOT NULL,           -- ID отзыва в WB
    complaint_reason_id INTEGER NOT NULL, -- Код причины (11, 12, 13, 16, 18, 19, 20)
    explanation TEXT,                     -- Текст жалобы (600-1000 символов, от Claude AI)
    status TEXT DEFAULT 'pending',        -- 'pending' → 'submitted' → 'approved'/'rejected'/'error'
    error_message TEXT,                   -- Текст ошибки
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    submitted_at DATETIME,               -- Когда отправлена
    resolved_at DATETIME,                -- Когда получен ответ
    manager_name TEXT                     -- Имя «менеджера» (для ротации стиля)
);
```

**Коды причин:**
- 11 — Ненормативная лексика
- 12 — Спам/реклама
- 13 — Не о товаре
- 16 — Содержит персональные данные
- 18 — Повторный отзыв
- 19 — Ошибочная оценка
- 20 — Шантаж/угрозы

---

### 2.17 Таблица `review_stats` — Статистика отзывов

```sql
CREATE TABLE review_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER REFERENCES review_accounts(id),
    date DATE,                            -- Дата
    total_reviews INTEGER DEFAULT 0,      -- Всего отзывов
    negative_reviews INTEGER DEFAULT 0,   -- Негативных
    complaints INTEGER DEFAULT 0,         -- Жалоб подано
    UNIQUE(account_id, date)
);
```

---

### 2.18 Таблица `sync_status` — Статус синхронизации отзывов

```sql
CREATE TABLE sync_status (
    id INTEGER PRIMARY KEY CHECK (id = 1), -- Всегда одна строка
    status TEXT NOT NULL DEFAULT 'idle',    -- 'idle', 'syncing', 'done', 'error'
    total INTEGER NOT NULL DEFAULT 0,       -- Всего отзывов
    loaded INTEGER NOT NULL DEFAULT 0,      -- Загружено
    message TEXT NOT NULL DEFAULT '',       -- Сообщение для UI
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

---

## 3. weekly_reports.db — Еженедельные Excel-отчёты

**Файл:** `data/weekly_reports.db`
**Размер:** ~294 МБ
**Режим журнала:** WAL
**Подключение:** readonly

### 3.1 Таблица `reports` — Метаданные отчётов

```sql
CREATE TABLE reports (
    id INTEGER PRIMARY KEY,
    report_id INTEGER NOT NULL UNIQUE,    -- ID отчёта в WB
    report_type INTEGER NOT NULL,         -- Тип (6 = реализация)
    period_from TEXT NOT NULL,            -- Начало периода (YYYY-MM-DD)
    period_to TEXT NOT NULL,              -- Конец периода
    rows_count INTEGER NOT NULL,          -- Количество строк
    loaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### 3.2 Таблица `weekly_rows` — Строки отчётов (86 колонок)

```sql
CREATE TABLE weekly_rows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL,           -- Ссылка на reports.report_id
    report_type INTEGER NOT NULL,
    period_from TEXT NOT NULL,
    period_to TEXT NOT NULL,

    -- Идентификация товара
    row_num TEXT,                          -- № строки в Excel
    supply_id TEXT,                        -- Номер поставки
    subject TEXT,                          -- Предмет
    nm_id TEXT,                            -- Номенклатура WB
    brand TEXT,                            -- Бренд
    sa_name TEXT,                          -- Артикул поставщика
    product_name TEXT,                     -- Название товара
    size TEXT,                             -- Размер
    barcode TEXT,                          -- Баркод

    -- Тип операции
    doc_type TEXT,                         -- Тип документа
    supplier_oper_name TEXT,              -- Продажа/Возврат/Логистика/...

    -- Даты
    order_dt TEXT,                         -- Дата заказа
    sale_dt TEXT,                          -- Дата продажи

    -- Финансы
    quantity REAL,
    retail_price REAL,                     -- Розничная цена
    retail_amount REAL,                    -- Сумма реализации
    product_discount_pct REAL,             -- Скидка на товар %
    promo_code_pct REAL,                   -- Промокод %
    total_discount_pct REAL,               -- Итоговая скидка %
    retail_price_withdisc_rub REAL,        -- Цена со скидкой

    -- Комиссии
    kvv_rating_reduction_pct REAL,         -- Снижение кВВ из-за рейтинга %
    kvv_promo_change_pct REAL,             -- Изменение кВВ из-за акции %
    spp_pct REAL,                          -- СПП %
    kvv_pct REAL,                          -- кВВ %
    kvv_base_no_vat_pct REAL,              -- кВВ базовый без НДС %
    kvv_final_no_vat_pct REAL,             -- кВВ итоговый без НДС %
    ppvz_sales_commission REAL,            -- Вознаграждение с продаж
    ppvz_pvz_reward REAL,                  -- Возмещение ПВЗ
    acquiring_fee REAL,                    -- Эквайринг
    acquiring_pct REAL,                    -- Эквайринг %
    acquiring_type TEXT,                   -- Тип платежа
    vv_no_vat REAL,                        -- ВВ без НДС
    vv_vat REAL,                           -- НДС с ВВ
    ppvz_for_pay REAL,                     -- К перечислению продавцу

    -- Логистика
    delivery_amount REAL,                  -- Кол-во доставок
    return_amount REAL,                    -- Кол-во возвратов
    delivery_rub REAL,                     -- Стоимость доставки

    -- Фиксация
    fix_date_from TEXT,
    fix_date_to TEXT,
    paid_delivery_flag TEXT,               -- Платная доставка

    -- Штрафы и коррекции
    penalty REAL,                          -- Штрафы
    vv_correction REAL,                    -- Корректировка ВВ
    operation_type TEXT,                   -- Вид логистики/штрафа

    -- Идентификаторы
    sticker_mp TEXT,                       -- Стикер МП
    acquiring_bank TEXT,                   -- Банк-эквайер
    office_id TEXT,
    office_name TEXT,                      -- Офис доставки
    partner_inn TEXT,
    partner TEXT,
    warehouse TEXT,                        -- Склад
    country TEXT,                          -- Страна
    box_type TEXT,                         -- Тип короба
    customs_declaration TEXT,              -- ГТД
    assembly_id TEXT,                      -- Сборочное задание
    marking_code TEXT,                     -- Код маркировки
    shk TEXT,                              -- ШК
    srid TEXT,

    -- Дополнительные расходы
    rebill_logistic_cost REAL,             -- Возмещение логистики
    carrier TEXT,                          -- Перевозчик
    storage_fee REAL,                      -- Хранение
    deduction REAL,                        -- Удержания
    acceptance REAL,                       -- Приёмка
    chrt_id INTEGER,

    -- Коэффициенты и флаги
    warehouse_coeff REAL,                  -- Коэффициент склада
    b2b_flag TEXT,                         -- Продажа юрлицу
    tmc_flag TEXT,                         -- ТМЦ
    box_num TEXT,                          -- Номер короба

    -- Программы лояльности и скидки
    cofinancing_discount REAL,             -- Софинансирование
    wibes_discount_pct REAL,               -- Скидка Wibes %
    loyalty_compensation REAL,             -- Компенсация лояльности
    loyalty_participation_cost REAL,       -- Стоимость участия в лояльности
    loyalty_points_deduction REAL,         -- Удержание за баллы лояльности
    cart_id TEXT,                          -- ID корзины
    additional_payment TEXT,               -- Разовое изменение срока
    sale_method TEXT,                      -- Способ продажи
    seller_promo_id REAL,                  -- ID акции продавца
    seller_promo_pct REAL,                 -- Скидка акции продавца %
    seller_loyalty_id REAL,                -- ID скидки лояльности
    seller_loyalty_pct REAL,               -- Скидка лояльности %
    promo_id TEXT,                         -- ID промокода
    promo_discount_pct REAL                -- Скидка промокода %
);

CREATE INDEX idx_wr_period ON weekly_rows(period_from, period_to);
CREATE INDEX idx_wr_report ON weekly_rows(report_id);
CREATE INDEX idx_wr_barcode ON weekly_rows(barcode);
CREATE INDEX idx_wr_nm ON weekly_rows(nm_id);
CREATE INDEX idx_wr_oper ON weekly_rows(supplier_oper_name);
CREATE INDEX idx_wr_sale_dt ON weekly_rows(sale_dt);
CREATE INDEX idx_wr_oper_srid ON weekly_rows(supplier_oper_name, srid);
CREATE INDEX idx_wr_saledt_oper ON weekly_rows(sale_dt, supplier_oper_name);
```

---

## 4. JSON-хранилища

### 4.1 wb-tokens.json — Токены WB Seller Portal

```json
{
  "authorizev3": "<JWT RS256 — долгоживущий, обновляется вручную>",
  "wbSellerLk": "<JWT EdDSA — живёт ~5 мин, обновляется автоматически>",
  "wbSellerLkExpires": 1712345678,
  "supplierId": "1166225",
  "supplierUuid": "uuid-string",
  "cookies": "wbx-validation-key=...; x-supplier-id-external=...",
  "savedAt": "2026-04-04T10:00:00.000Z"
}
```

**Права:** chmod 600
**Кто пишет:** `src/lib/wb-seller-api.ts` (saveTokens), `scripts/wb-auth-sniffer.py`
**Кто читает:** `scripts/daily-sync.js`, `scripts/sync-weekly-report.js`, `src/lib/wb-seller-api.ts`
**Обновление wbSellerLk:** автоматическое через `POST seller.wildberries.ru/.../auth/token` если до истечения < 30 сек

### 4.2 wb-api-key.txt — API-ключ WB

```
<JWT ES256 — один ключ, одна строка>
```

**Права:** chmod 600
**Управление:** `GET/PUT/DELETE /api/settings/apikey`
**Кто читает:** все `/api/wb/*` роуты, `scripts/daily-sync.js`

### 4.3 daily-sync-status.json — История синхронизации

```json
{
  "lastRun": "2026-04-04T17:00:00.000Z",
  "lastSuccess": "2026-04-04T17:00:00.000Z",
  "lastError": null,
  "running": false,
  "history": [
    {
      "date": "2026-04-03",
      "report": { "ok": true, "value": 2847, "stable": true, "prevValue": 2830, "lastAttempt": "..." },
      "advertising": { "ok": true, "value": 15230.50, "stable": true, "prevValue": 14900, "lastAttempt": "..." },
      "orders": { "ok": true, "value": 156, "stable": true, "prevValue": 148, "lastAttempt": "..." },
      "complete": true
    }
  ],
  "today": { "..." }
}
```

### 4.4 monitor-registry.json — Реестр сервисов

```json
[
  {
    "id": "daily-sync",
    "name": "Daily Sync",
    "description": "Каждый час тянет реализацию, рекламу, заказы, хранение из WB API",
    "project": "mphub",
    "type": "node",
    "scriptPath": "/home/makson/website/scripts/daily-sync.js",
    "cronPattern": "0 * * * *",
    "logPath": "/home/makson/website/data/daily-sync.log",
    "lifecycle": "active"
  }
]
```

Фактический production-реестр содержит 10 сервисов: `mphub-website`, `daily-sync`, `weekly-sync`, `shipment-sync`, `reviews-sync`, `reviews-complaints`, `mphub-watchdog`, `auth-check`, `paid-storage-sync`, `data-health-cron`. Production использует PM2 + cron; macOS `launchd` в этой схеме не используется.

### 4.5 repair-state.json — Состояние watchdog

```json
{
  "mphub-website": {
    "restart_count": 1,
    "last_restart": "2026-04-04T10:00:00",
    "last_stable": "2026-04-04T10:01:00",
    "circuit": "closed",
    "ai_last_called": null,
    "ai_diagnosis": null
  }
}
```

---

## 5. Авторизация и безопасность

### 5.1 JWT авторизация MpHub

```typescript
// src/lib/auth.ts
const IS_PRODUCTION_RUNTIME =
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PHASE !== "phase-production-build";

const JWT_SECRET = process.env.JWT_SECRET || (IS_PRODUCTION_RUNTIME ? "" : "mphub-dev-secret-2026");
if (!JWT_SECRET) {
  throw new Error("JWT_SECRET environment variable is required in production runtime");
}
const JWT_TTL = 30 * 24 * 60 * 60; // 30 дней

// Формат токена: base64url(header).base64url(payload).hmac-sha256
// Header: {"alg": "HS256", "typ": "JWT"}
// Payload: {"userId": number, "iat": number, "exp": number}
```

**Cookie:** `mphub-token`, httpOnly, sameSite=lax, secure в production, path=/, maxAge=30 дней
**Важно:** dev fallback секрета допустим только вне production runtime. На проде отсутствие `JWT_SECRET` должно останавливать приложение.

### 5.2 Пароли

```typescript
// Хэширование: PBKDF2-SHA256
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.pbkdf2Sync(password, salt, 310000, 32, "sha256").toString("hex");
  return `pbkdf2-sha256:310000:${salt}:${hash}`;
}

// Проверка: timingSafeEqual; legacy salt:sha256hash поддерживается для миграции
function verifyPassword(password: string, stored: string): boolean {
  // См. полную реализацию в src/lib/auth.ts:
  // PBKDF2 проверяется напрямую, legacy SHA256 — только для миграции.
}
```

### 5.3 Proxy и API-авторизация

```typescript
// src/proxy.ts
// UI-страницы: проверяет наличие cookie 'mphub-token', иначе → /login.
// JWT не валидируется на Edge: Node crypto недоступен.

// src/lib/api-auth.ts
// Server API: verifyToken + getUserById + role === "admin".

// src/lib/monitor-auth.ts
// Monitor API: сейчас тот же requireAdmin().
```

Закрытые группы API: `/api/finance/*`, `/api/data/*`, `/api/reviews/*`, `/api/wb/*`, `/api/monitor/*`. Auth API (`/api/auth/*`) остаётся публичным для входа/выхода.

### 5.4 Права доступа файлов

| Файл | chmod | Содержит |
|------|-------|----------|
| `data/finance.db` | 600 | Все данные + пароли |
| `data/weekly_reports.db` | 600 | Финансовые отчёты |
| `data/wb-api-key.txt` | 600 | API-ключ WB |
| `data/wb-tokens.json` | 600 рекомендуется | Токены WB |

---

## 6. Логи

| Файл | Кто пишет | Ротация |
|------|-----------|---------|
| `data/daily-sync.log` | daily-sync.js | Нет |
| `data/reviews-sync.log` | reviews-sync.js | Нет |
| `data/reviews-complaints.log` | reviews-complaints.js | Нет |
| `data/weekly-sync.log` | sync-weekly-report.js | Нет |
| `data/shipment-sync.log` | shipment-sync.sh | Нет |
| `data/watchdog.log` | vps-watchdog.py | Нет |
| `/root/.pm2/logs/mphub-out.log` | Next.js stdout под PM2 | PM2 |
| `/root/.pm2/logs/mphub-error.log` | Next.js stderr под PM2 | PM2 |
| `data/dev-server.log` | npm run dev | Нет |

Старые записи в PM2 error-log не считать новой ошибкой без проверки `stat` timestamp/size до и после диагностики.

---

## 7. Как воспроизвести структуру с нуля

### Шаг 1: Создать проект

```bash
mkdir mphub && cd mphub
npm init -y
npm install next react react-dom typescript better-sqlite3 recharts
npm install -D @types/better-sqlite3 tailwindcss
mkdir -p data public/data/monitor public/data/finance scripts src/{app,components,lib,types}
```

### Шаг 2: Инициализировать finance.db

```javascript
const Database = require("better-sqlite3");
const crypto = require("crypto");

const db = new Database("data/finance.db");
db.pragma("journal_mode = WAL");
db.pragma("cache_size = -64000");

// === ФИНАНСОВЫЕ ТАБЛИЦЫ ===
db.exec(`
  CREATE TABLE IF NOT EXISTS realization (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rrd_id INTEGER,
    realizationreport_id INTEGER,
    date_from TEXT, date_to TEXT, rr_dt TEXT, sale_dt TEXT, order_dt TEXT,
    supplier_oper_name TEXT,
    nm_id INTEGER, sa_name TEXT, ts_name TEXT, barcode TEXT,
    brand_name TEXT, subject_name TEXT,
    quantity INTEGER DEFAULT 0,
    retail_price REAL DEFAULT 0,
    retail_price_withdisc_rub REAL DEFAULT 0,
    retail_amount REAL DEFAULT 0,
    ppvz_for_pay REAL DEFAULT 0,
    ppvz_sales_commission REAL DEFAULT 0,
    acquiring_fee REAL DEFAULT 0,
    delivery_rub REAL DEFAULT 0,
    delivery_amount INTEGER DEFAULT 0,
    return_amount INTEGER DEFAULT 0,
    storage_fee REAL DEFAULT 0,
    penalty REAL DEFAULT 0,
    acceptance REAL DEFAULT 0,
    rebill_logistic_cost REAL DEFAULT 0,
    additional_payment REAL DEFAULT 0,
    commission_percent REAL DEFAULT 0,
    ppvz_spp_prc REAL DEFAULT 0,
    ppvz_kvw_prc_base REAL DEFAULT 0,
    ppvz_kvw_prc REAL DEFAULT 0,
    ppvz_supplier_name TEXT,
    site_country TEXT,
    office_name TEXT,
    deduction REAL DEFAULT 0,
    bonus_type_name TEXT DEFAULT "",
    source TEXT DEFAULT 'weekly'
  );

  CREATE INDEX IF NOT EXISTS idx_real_sale_dt ON realization(sale_dt);
  CREATE INDEX IF NOT EXISTS idx_real_rr_dt ON realization(rr_dt);
  CREATE INDEX IF NOT EXISTS idx_real_op_sale_dt ON realization(supplier_oper_name, sale_dt);
  CREATE INDEX IF NOT EXISTS idx_real_op_rr_dt ON realization(supplier_oper_name, rr_dt);
  CREATE INDEX IF NOT EXISTS idx_real_op_nm ON realization(supplier_oper_name, nm_id, sa_name, brand_name, subject_name);
  CREATE INDEX IF NOT EXISTS idx_real_op_supplier ON realization(supplier_oper_name, ppvz_supplier_name);

  CREATE TABLE IF NOT EXISTS advertising (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT, campaign_name TEXT, campaign_id INTEGER,
    amount REAL DEFAULT 0, payment_type TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_ad_date ON advertising(date);

  CREATE TABLE IF NOT EXISTS orders_funnel (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT UNIQUE,
    order_sum REAL DEFAULT 0, order_count INTEGER DEFAULT 0,
    buyout_sum REAL DEFAULT 0, buyout_count INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_funnel_date ON orders_funnel(date);

  CREATE TABLE IF NOT EXISTS cogs (
    barcode TEXT PRIMARY KEY,
    cost REAL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS tax_settings (key TEXT PRIMARY KEY, value REAL);
`);

// === ПОЛЬЗОВАТЕЛИ ===
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name TEXT,
    role TEXT DEFAULT 'user',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS user_settings (
    user_id INTEGER NOT NULL,
    key TEXT NOT NULL,
    value TEXT,
    PRIMARY KEY(user_id, key),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS product_overrides (
    user_id INTEGER NOT NULL,
    article_wb TEXT NOT NULL,
    barcode TEXT NOT NULL,
    custom_name TEXT, per_box INTEGER, disabled INTEGER DEFAULT 0,
    PRIMARY KEY(user_id, article_wb, barcode),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

// В production дефолтный admin/admin не создаётся.
// В dev допускается локальный bootstrap только если users пустая.

// === ОТГРУЗКА ===
db.exec(`
  CREATE TABLE IF NOT EXISTS shipment_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT, warehouse TEXT, federal_district TEXT, region TEXT,
    article_seller TEXT, article_wb INTEGER, barcode TEXT,
    category TEXT, subject TEXT, brand TEXT, size TEXT,
    total_price REAL, discount_percent REAL, spp REAL,
    finished_price REAL, price_with_disc REAL,
    is_cancel INTEGER, cancel_date TEXT,
    UNIQUE(barcode, date, warehouse)
  );

  CREATE TABLE IF NOT EXISTS shipment_stock (
    barcode TEXT, article_wb TEXT, article_seller TEXT,
    brand TEXT, size TEXT, warehouse TEXT,
    quantity INTEGER, updated_at TEXT,
    PRIMARY KEY(barcode, warehouse)
  );

  CREATE TABLE IF NOT EXISTS shipment_products (
    article_wb TEXT PRIMARY KEY,
    name TEXT, brand TEXT, category TEXT, sizes_json TEXT
  );

  CREATE TABLE IF NOT EXISTS shipment_meta (key TEXT PRIMARY KEY, value TEXT);
`);

// === ОТЗЫВЫ ===
db.exec(`
  CREATE TABLE IF NOT EXISTS review_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL, store_name TEXT, inn TEXT, supplier_id TEXT,
    api_key TEXT NOT NULL,
    cookie_status TEXT DEFAULT 'inactive', api_status TEXT DEFAULT 'inactive',
    auto_replies INTEGER DEFAULT 0, auto_dialogs INTEGER DEFAULT 0,
    auto_complaints INTEGER DEFAULT 0, use_auto_proxy INTEGER DEFAULT 1,
    settings_json TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    wb_authorize_v3 TEXT, wb_validation_key TEXT,
    wb_cookie_updated_at DATETIME, wb_seller_lk TEXT
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER REFERENCES review_accounts(id),
    wb_review_id TEXT UNIQUE,
    date DATETIME, rating INTEGER,
    product_name TEXT, product_article TEXT, brand TEXT,
    review_text TEXT, pros TEXT, cons TEXT,
    buyer_name TEXT, buyer_chat_id TEXT, price REAL,
    status TEXT DEFAULT 'new', complaint_status TEXT,
    is_hidden INTEGER DEFAULT 0, is_updated INTEGER DEFAULT 0,
    is_excluded_rating INTEGER DEFAULT 0,
    purchase_type TEXT, store_name TEXT, pickup_point TEXT, comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    shk_id INTEGER, order_date DATETIME, bables TEXT
  );

  CREATE TABLE IF NOT EXISTS review_complaints (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    review_id INTEGER REFERENCES reviews(id),
    account_id INTEGER REFERENCES review_accounts(id),
    wb_review_id TEXT NOT NULL, complaint_reason_id INTEGER NOT NULL,
    explanation TEXT, status TEXT DEFAULT 'pending', error_message TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    submitted_at DATETIME, resolved_at DATETIME, manager_name TEXT
  );

  CREATE TABLE IF NOT EXISTS review_stats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER REFERENCES review_accounts(id),
    date DATE, total_reviews INTEGER DEFAULT 0,
    negative_reviews INTEGER DEFAULT 0, complaints INTEGER DEFAULT 0,
    UNIQUE(account_id, date)
  );

  CREATE TABLE IF NOT EXISTS sync_status (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    status TEXT NOT NULL DEFAULT 'idle',
    total INTEGER NOT NULL DEFAULT 0, loaded INTEGER NOT NULL DEFAULT 0,
    message TEXT NOT NULL DEFAULT '',
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  INSERT OR IGNORE INTO sync_status (id) VALUES (1);
`);

db.close();
console.log("finance.db initialized with 20 tables");
```

### Шаг 3: Инициализировать weekly_reports.db

```javascript
const Database = require("better-sqlite3");

const db = new Database("data/weekly_reports.db");
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY,
    report_id INTEGER NOT NULL UNIQUE,
    report_type INTEGER NOT NULL,
    period_from TEXT NOT NULL,
    period_to TEXT NOT NULL,
    rows_count INTEGER NOT NULL,
    loaded_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS weekly_rows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NOT NULL, report_type INTEGER NOT NULL,
    period_from TEXT NOT NULL, period_to TEXT NOT NULL,
    row_num TEXT, supply_id TEXT, subject TEXT, nm_id TEXT,
    brand TEXT, sa_name TEXT, product_name TEXT, size TEXT, barcode TEXT,
    doc_type TEXT, supplier_oper_name TEXT, order_dt TEXT, sale_dt TEXT,
    quantity REAL, retail_price REAL, retail_amount REAL,
    product_discount_pct REAL, promo_code_pct REAL, total_discount_pct REAL,
    retail_price_withdisc_rub REAL,
    kvv_rating_reduction_pct REAL, kvv_promo_change_pct REAL,
    spp_pct REAL, kvv_pct REAL, kvv_base_no_vat_pct REAL, kvv_final_no_vat_pct REAL,
    ppvz_sales_commission REAL, ppvz_pvz_reward REAL,
    acquiring_fee REAL, acquiring_pct REAL, acquiring_type TEXT,
    vv_no_vat REAL, vv_vat REAL, ppvz_for_pay REAL,
    delivery_amount REAL, return_amount REAL, delivery_rub REAL,
    fix_date_from TEXT, fix_date_to TEXT, paid_delivery_flag TEXT,
    penalty REAL, vv_correction REAL, operation_type TEXT,
    sticker_mp TEXT, acquiring_bank TEXT, office_id TEXT, office_name TEXT,
    partner_inn TEXT, partner TEXT, warehouse TEXT, country TEXT,
    box_type TEXT, customs_declaration TEXT, assembly_id TEXT,
    marking_code TEXT, shk TEXT, srid TEXT,
    rebill_logistic_cost REAL, carrier TEXT, storage_fee REAL,
    deduction REAL, acceptance REAL, chrt_id INTEGER,
    warehouse_coeff REAL, b2b_flag TEXT, tmc_flag TEXT, box_num TEXT,
    cofinancing_discount REAL, wibes_discount_pct REAL,
    loyalty_compensation REAL, loyalty_participation_cost REAL,
    loyalty_points_deduction REAL, cart_id TEXT, additional_payment TEXT,
    sale_method TEXT, seller_promo_id REAL, seller_promo_pct REAL,
    seller_loyalty_id REAL, seller_loyalty_pct REAL,
    promo_id TEXT, promo_discount_pct REAL
  );

  CREATE INDEX IF NOT EXISTS idx_wr_period ON weekly_rows(period_from, period_to);
  CREATE INDEX IF NOT EXISTS idx_wr_report ON weekly_rows(report_id);
  CREATE INDEX IF NOT EXISTS idx_wr_barcode ON weekly_rows(barcode);
  CREATE INDEX IF NOT EXISTS idx_wr_nm ON weekly_rows(nm_id);
  CREATE INDEX IF NOT EXISTS idx_wr_oper ON weekly_rows(supplier_oper_name);
  CREATE INDEX IF NOT EXISTS idx_wr_sale_dt ON weekly_rows(sale_dt);
`);

db.close();
console.log("weekly_reports.db initialized with 2 tables");
```

### Шаг 4: Создать JSON-файлы

```bash
# Токены (заполняются после авторизации WB)
echo '{}' > data/wb-tokens.json
chmod 600 data/wb-tokens.json

# API-ключ (заполняется вручную)
touch data/wb-api-key.txt
chmod 600 data/wb-api-key.txt

# Статус синхронизации
echo '{"lastRun":null,"lastSuccess":null,"lastError":null,"running":false,"history":[]}' > data/daily-sync-status.json

# Мониторинг
echo '[]' > public/data/monitor/monitor-registry.json
echo '{}' > public/data/monitor/status.json
echo '{}' > public/data/monitor/repair-state.json
echo '[]' > public/data/monitor/repair-log.json
echo '[]' > public/data/monitor/changes.json

# Логи
touch data/{daily-sync,reviews-sync,reviews-complaints,weekly-sync,shipment-sync,watchdog,watchdog-error,website,website-error}.log
```

### Шаг 5: Настроить права доступа

```bash
chmod 600 data/finance.db data/weekly_reports.db
chmod 600 data/wb-api-key.txt data/wb-tokens.json
chmod 600 public/data/monitor/*.json
chmod 600 public/data/finance/*.json
```

---

## 8. Связи между таблицами

```
users.id ─────→ user_settings.user_id
users.id ─────→ product_overrides.user_id

review_accounts.id ─→ reviews.account_id
review_accounts.id ─→ review_complaints.account_id
review_accounts.id ─→ review_stats.account_id
reviews.id ────────→ review_complaints.review_id

realization.barcode ←→ cogs.barcode (JOIN по себестоимости)
realization.nm_id ←──→ shipment_products.article_wb (связь номенклатуры)
shipment_orders.barcode ←→ shipment_stock.barcode (связь остатков с заказами)

weekly_rows.report_id ──→ reports.report_id
weekly_rows ←────────────→ realization (сверка: Excel vs API данные)
```

---

## 9. Важные нюансы

1. **Продажи vs Услуги:** В таблице `realization` продажи/возвраты фильтруются по `sale_dt`, а услуги (логистика, хранение, штрафы, приёмка) — по `rr_dt`. Это РАЗНЫЕ даты с разницей до нескольких дней.

2. **Источники данных (source):** daily-sync записывает с source='weekly' (ежедневные отчёты из ЛК). Еженедельные отчёты — source='weekly_final'. При расчёте P&L недели с финальным отчётом (weekly_final) исключают daily/weekly-данные за тот же период через `getExcludeDailyFilter()`.

3. **Единая БД:** finance.db содержит ВСЕ домены: финансы, отгрузку, отзывы, пользователей. Каждый модуль открывает своё readonly-соединение с `busy_timeout = 5000`.

4. **WAL режим:** Обязателен для параллельного чтения (API) и записи (sync-скрипты). После записи в weekly_reports.db выполняется `PRAGMA wal_checkpoint(TRUNCATE)` для предотвращения разрастания WAL-файла.

5. **Дефолтный админ:** В production не создаётся. Если в старой БД есть `admin/admin`, его нужно удалить или заменить пароль вручную.

6. **sync_status — синглтон:** Таблица содержит ровно одну строку (id=1, CHECK constraint). Используется для отображения прогресса синхронизации отзывов на UI.

7. **Процент выкупа:** Рассчитывается из `realization`: заказы = SUM(delivery_amount) из Логистики, выкупы = SUM(quantity) из Продажи. Формула совпадает с эталоном ЛК WB (~82%). Данные доступны для всех дней, включая текущую незакрытую неделю (из ежедневных отчётов ЛК).

8. **Коррекция логистики:** WB пересчитывает логистику задним числом и записывает как `supplier_oper_name = 'Коррекция логистики'`. В PnL и прогнозе учитывается вместе с основной логистикой: `supplier_oper_name IN ('Логистика', 'Коррекция логистики')`. Аналогично существует `'Коррекция продаж'` (мелкие суммы, пока не учитывается).

9. **Аналитика — заказы/доставки/отказы/выкупы:**
   - Заказы: из `orders_funnel.order_count` (WB Sales Funnel API), fallback на `shipment_orders`
   - Доставки: SUM(delivery_amount) из `realization` Логистики
   - Отказы: SUM(return_amount) из `realization` Логистики
   - Выкупы: SUM(quantity) из `realization` Продажи

---

## 10. Модульная архитектура (с 12.04.2026)

Проект разделён на независимые модули. Каждый модуль имеет свои запросы к БД, компоненты и бизнес-логику. Изменения в одном модуле не затрагивают другие.

```
src/
  modules/
    finance/
      lib/queries.ts          ← getPnl, getDaily, getFilters (свои копии из db.ts)
      components/             ← ReconciliationTab, ForecastTab
    shipment/
      lib/engine.ts           ← calculation-engine (расчёт отгрузки)
      lib/use-effective-buyout.ts  ← процент выкупа из API
      lib/use-effective-regions.ts ← регионы из настроек
      components/             ← ShipmentCalcV2/V3, Settings, Products, Upload, Warehouse*
    analytics/
      lib/db.ts               ← своё подключение к БД + getExcludeDailyFilter
      lib/engine.ts           ← getOrderStats, calculateShipment (свои копии)
      lib/AnalyticsProvider.tsx ← независимый провайдер данных
      components/             ← RegionalMatrix
    reviews/                  ← полностью независим, не использует общие модули

  shared (src/components/):   ← только стабильные UI: StatCard, DateRangePicker, Sidebar, Charts

  lib/
    sync/                     ← Независимые sync-модули
      types.ts                ← общие типы и утилиты
      realization.ts          ← синк ежедневных отчётов из ЛК
      advertising.ts          ← синк рекламных расходов
      orders.ts               ← синк воронки продаж
      storage.ts              ← синк платного хранения
    daily-sync.ts             ← оркестратор (каждый модуль в try/catch)
```

**Правила:**
- Модуль НЕ импортирует из другого модуля
- Каждый модуль имеет своё подключение к БД
- Error Boundary на каждый раздел (error.tsx)
- Автотесты API: `scripts/test-api.sh` (9 эндпоинтов)
- DataProvider — только для Отгрузки; Аналитика имеет свой AnalyticsProvider

7. **Обогащение отзывов:** reviews-sync.js по полю `shk_id` сопоставляет отзыв с заказом из Orders API, чтобы добавить цену и регион (горизонт 90 дней).
