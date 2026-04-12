# MpHub — План рефакторинга

> Документ подготовлен на основе полного аудита кодовой базы (04.04.2026)

---

## Оглавление

1. [Общая картина](#1-общая-картина)
2. [Фаза 0 — Критические баги и безопасность](#2-фаза-0--критические-баги-и-безопасность)
3. [Фаза 1 — Архитектура данных и БД](#3-фаза-1--архитектура-данных-и-бд)
4. [Фаза 2 — API-слой](#4-фаза-2--api-слой)
5. [Фаза 3 — Бизнес-логика (lib/)](#5-фаза-3--бизнес-логика-lib)
6. [Фаза 4 — Компоненты и страницы](#6-фаза-4--компоненты-и-страницы)
7. [Фаза 5 — Инфраструктура и DX](#7-фаза-5--инфраструктура-и-dx)
8. [Порядок выполнения](#8-порядок-выполнения)

---

## 1. Общая картина

### Статистика кодовой базы
| Слой | Файлов | ~LOC | Состояние |
|------|--------|------|-----------|
| API-роуты (`app/api/`) | 48 | ~4 500 | Много дублирования, нет валидации |
| Компоненты (`components/`) | 28 | ~7 000 | 5 компонентов >300 строк, god-объекты |
| Библиотеки (`lib/`) | 28 | ~7 250 | Дублирование, magic numbers, баги типов |
| Страницы (`app/*/page.tsx`) | 19 | ~4 600 | finance/page.tsx = 1209 строк |
| Типы (`types/`) | 1 | 149 | Неполные, несогласованные |
| **Итого** | **~124** | **~23 500** | |

### Ключевые проблемы
1. **Безопасность** — SQL-инъекции, слабый JWT-секрет, эндпоинты без авторизации
2. **Баги** — несовпадение типов articleWB (string vs number), async внутри транзакций
3. ~~**Дублирование** — 3 копии getDb()~~ → **РЕШЕНО 12.04.2026**: модульная архитектура — каждый модуль имеет своё подключение к БД по дизайну (изоляция)
4. ~~**God-объекты** — DataProvider (365 строк, 6 сущностей)~~ → **ЧАСТИЧНО РЕШЕНО 12.04.2026**: Аналитика отвязана от DataProvider (свой AnalyticsProvider)
5. **Magic numbers** — COGS=300, даты "2026-02-19", supplier_id "1166225" захардкожены
6. **Нет валидации** — ни один API-роут не валидирует входные данные

### Выполнено 12.04.2026
- Модульная архитектура: Finance, Shipment, Analytics — независимые модули
- Error Boundaries для всех разделов
- daily-sync разбит на 4 независимых sync-модуля
- Автотесты API (scripts/test-api.sh, 9 эндпоинтов)
- busy_timeout=5000 на всех DB-соединениях
- WAL checkpoint после записи в weekly_reports.db
- Процент выкупа из realization (delivery_amount/quantity) вместо shipment_orders.isCancel

---

## 2. Фаза 0 — Критические баги и безопасность

> Приоритет: **НЕМЕДЛЕННО**. Всё остальное можно делать параллельно, это — нет.

### 2.1 SQL-инъекция в db.ts

**Где:** `src/lib/db.ts`, строки ~64-67, ~157-159
**Что:** Строковая конкатенация в SQL-запросах
```typescript
// СЕЙЧАС (ОПАСНО):
const periodFilter = matchingPeriods.map(p =>
  `(period_from = '${p.period_from}' AND period_to = '${p.period_to}')`
).join(" OR ");

// ПОСЛЕ (БЕЗОПАСНО):
const placeholders = matchingPeriods.map(() => "(period_from = ? AND period_to = ?)").join(" OR ");
const params = matchingPeriods.flatMap(p => [p.period_from, p.period_to]);
```

**Где ещё:** `src/app/api/wb/adv/route.ts` — `source = '${source}'`

**Зачем:** Даже если данные приходят из БД, а не от пользователя — это мина замедленного действия. Один рефакторинг, и данные начнут приходить от клиента.

---

### 2.2 Слабый JWT-секрет

**Где:** `src/lib/auth.ts`, строка ~8
```typescript
// СЕЙЧАС:
const JWT_SECRET = process.env.JWT_SECRET || "mphub-dev-secret-2026";

// ПОСЛЕ:
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error("JWT_SECRET environment variable is required");
```

**Зачем:** Если забыть выставить переменную окружения, любой может подделать токен.

---

### 2.3 Эндпоинты без авторизации

**Где:** Все `/api/monitor/*` роуты — **нет проверки токена**
**Риск:** Кто угодно может перезапускать/останавливать сервисы

**Что делать:** Добавить проверку `mphub-token` cookie (как в остальных роутах) или обновить middleware.

---

### 2.4 Захардкоженные пути разработчика

**Где:**
- `src/app/api/reviews/accounts/route.ts` — `/Users/octopus/.openclaw/agents/...`
- `src/app/api/reviews/route.ts` — тот же путь

**Что делать:** Вынести в переменную окружения `WB_TOKEN_PATH` или читать из БД.

---

### 2.5 Баг типов: articleWB string vs number

**Где:** `src/lib/wb-transformers.ts`
```typescript
// transformCards() — articleWB = String(card.nmID)  → STRING
// transformOrders() — articleWB = o.nmId             → NUMBER
```

**Последствия:** JOIN/сравнение заказов с карточками может не работать (строгое сравнение `===`).

**Что делать:** Привести к единому типу `string` во всех трансформерах.

---

### 2.6 Async внутри SQLite-транзакции

**Где:** `src/lib/daily-sync.ts`, строка ~241
```typescript
// СЕЙЧАС (ОПАСНО):
db.transaction(() => {
  await fetchSomething(); // async внутри sync транзакции!
  db.prepare(...).run();
})();

// ПОСЛЕ:
const data = await fetchSomething(); // сначала fetch
db.transaction(() => {
  db.prepare(...).run(data); // потом sync запись
})();
```

**Зачем:** better-sqlite3 транзакции — синхронные. Async внутри них может привести к блокировке БД.

---

## 3. Фаза 1 — Архитектура данных и БД

### 3.1 Единый модуль подключения к БД

**Проблема:** 3 файла (shipment-db.ts, db.ts, reviews-db.ts) каждый создают свой singleton `getDb()` с разными настройками.

**Что делать:** Создать `src/lib/database/connection.ts`
```
src/lib/database/
  connection.ts      — единый getDb(name, readonly?) + graceful shutdown
  migrations.ts      — все CREATE TABLE / ALTER TABLE в одном месте
  shipment-repo.ts   — CRUD для shipment_orders, shipment_stock, shipment_products
  finance-repo.ts    — P&L запросы, daily, articles
  reviews-repo.ts    — reviews, accounts, complaints
  auth-repo.ts       — users, sessions
```

**Зачем:**
- Одна точка конфигурации (pragma, WAL, cache_size)
- Миграции запускаются 1 раз при старте, а не при каждом запросе
- Каждый репозиторий отвечает за свою доменную область
- Легко добавить connection pooling или переехать на другую БД

---

### 3.2 Убрать initReviewTables() из каждой функции

**Проблема:** `reviews-db.ts` вызывает `initReviewTables()` в ~35 функциях. Каждый вызов выполняет 8 ALTER TABLE с try-catch.

**Что делать:** Вызывать 1 раз при инициализации модуля. Убрать из всех функций.

---

### 3.3 Централизовать хардкод-константы

**Проблема:** Разбросаны по всему коду:
- `300` (дефолтная себестоимость) — 6+ мест
- `'1166225'` (supplier_id) — 3 места
- `28`, `90`, `365` дней — разные файлы
- `"2026-02-19"`, `"2019-01-01"` — захардкоженные даты

**Что делать:** Создать `src/lib/constants.ts`
```typescript
export const DEFAULTS = {
  COGS_PER_UNIT: 300,           // руб., себестоимость по умолчанию
  UPLOAD_DAYS: 28,              // дней для выборки заказов
  STOCK_LOOKBACK_DAYS: 7,       // дней для запроса остатков
  REVIEW_ENRICHMENT_DAYS: 90,   // дней для обогащения отзывов
  TREND_THRESHOLD: 0.05,        // 5% порог для тренда
  TREND_MULTIPLIER_CLAMP: [0.1, 3.0], // диапазон множителя
  TOKEN_TTL_DAYS: 30,           // время жизни JWT
  MSK_OFFSET_HOURS: 3,          // часовой пояс Москвы
};
```

---

### 3.4 Типы: расширить и согласовать

**Проблема:** `types/index.ts` — всего 149 строк. Многие типы определены локально в компонентах или отсутствуют.

**Что делать:**
```
src/types/
  index.ts          — реэкспорт
  product.ts        — Product, StockItem, SizeConfig
  order.ts          — OrderRecord
  shipment.ts       — ShipmentRow, ShipmentCalculation, RegionConfig, RegionGroup
  finance.ts        — PnlResult, DailyRow, ArticleRow (сейчас в finance/page.tsx)
  review.ts         — Review, ReviewAccount, ReviewFilters, ReviewStat
  settings.ts       — AppSettings, ProductOverrides
  wb-api.ts         — WBCard, WBStockItem, WBOrder, WBWarehouse
```

**Зачем:** 9 интерфейсов определены локально в `finance/page.tsx`. Их невозможно переиспользовать.

---

## 4. Фаза 2 — API-слой

### 4.1 Единый формат ответа

**Проблема:** Роуты возвращают данные в разных форматах:
- Одни: `{ data: [...] }`
- Другие: голый массив
- Третьи: `{ ok: true, data: [...] }`
- Четвёртые: `{ ...filters, data: [...], total: N }`

**Что делать:** Создать `src/lib/api-response.ts`
```typescript
// Успех:
{ ok: true, data: T }
{ ok: true, data: T[], total: number }  // для пагинации

// Ошибка:
{ ok: false, error: string }
```

---

### 4.2 Валидация входных данных

**Проблема:** Ни один роут не валидирует параметры. `per_page=1000000` — и сервер упадёт.

**Что делать:** Создать простые валидаторы (без тяжёлых библиотек):
```typescript
// src/lib/api-validate.ts
export function validateDateRange(from: string, to: string): { from: string; to: string }
export function validatePagination(page: unknown, perPage: unknown): { page: number; perPage: number }
export function validateId(id: unknown): number
```

Применить во всех роутах, принимающих параметры.

---

### 4.3 Разбить "толстые" роуты

| Роут | Строк | Проблема | Решение |
|------|-------|----------|---------|
| `/api/reviews/complaints/route.ts` | 463 | AI-генерация + WB API + БД | Вынести генерацию в `lib/complaint-generator.ts` |
| `/api/reviews/route.ts` | 318 | Sync + enrichment + пагинация | Вынести sync в `lib/reviews-sync.ts` |
| `/api/finance/reconciliation/route.ts` | 219 | 3 источника данных + метрики | Вынести метрики в `lib/finance-repo.ts` |
| `/api/wb/adv/route.ts` | 211 | Fetch + batch + save | Вынести в `lib/advertising-sync.ts` |
| `/api/data/sync/route.ts` | 134 | Fetch + transform + save | Уже нормально, но transform вынести в lib |

---

### 4.4 Консистентная обработка ошибок

**Проблема:** 3 разных паттерна обработки ошибок:
```typescript
// Паттерн 1: String(error)
{ error: String(error) }

// Паттерн 2: instanceof Error
{ error: err instanceof Error ? err.message : "Unknown" }

// Паттерн 3: пустой catch
catch { /* */ }
```

**Что делать:** Единый хелпер:
```typescript
export function apiError(err: unknown, status = 500): NextResponse {
  const message = err instanceof Error ? err.message : "Internal server error";
  console.error("[API Error]", err);
  return NextResponse.json({ ok: false, error: message }, { status });
}
```

---

## 5. Фаза 3 — Бизнес-логика (lib/)

### 5.1 Убрать дублирование V1/V2 в calculation-engine.ts

**Проблема:** `calculateShipment()` и `calculateShipmentV2()` — почти идентичный код (~60 строк дублирования). Разница — множитель тренда.

**Что делать:**
```typescript
function _calculateRows(params: CalcParams, trendMultiplier = 1): ShipmentRow[] {
  // общая логика
}

export function calculateShipment(params) {
  return _calculateRows(params, 1);
}

export function calculateShipmentV2(params) {
  const trend = calculateTrend(params.orders);
  return _calculateRows(params, trend.multiplier);
}
```

---

### 5.2 Объединить auth-модули (CDP + HTTP)

**Проблема:** `wb-auth-cdp.ts` (446 строк) и `wb-auth-http.ts` (345 строк) дублируют:
- `saveAuthTokens()` — почти идентичный код
- Cookie-парсинг
- Global state через `globalThis`

**Что делать:**
```
src/lib/wb-auth/
  tokens.ts       — saveAuthTokens(), loadTokens(), refreshToken()
  cdp-driver.ts   — Puppeteer-логика
  http-driver.ts  — HTTP-логика
  index.ts        — единый интерфейс authenticate()
```

---

### 5.3 Убрать дублирование hashPassword

**Проблема:** Идентичная функция в `shipment-db.ts` и `auth.ts`.

**Что делать:** Оставить только в `auth.ts`, импортировать в `shipment-db.ts`.

---

### 5.4 Рефакторинг export-excel-v2.ts

**Проблема:** 398 строк, из них ~250 — стили (magic numbers: RGB-цвета, размеры шрифтов, ширины колонок).

**Что делать:**
```typescript
// src/lib/excel/styles.ts
export const EXCEL_STYLES = {
  header: { font: { sz: 18, bold: true }, fill: { rgb: "92D050" } },
  regionColumn: { font: { sz: 11 }, fill: { rgb: "D9E1F2" } },
  // ...
};

// src/lib/excel/export-shipment.ts — логика формирования
// src/lib/excel/export-finance.ts  — если появится
```

---

### 5.5 Разбить daily-sync.ts (486 строк)

**Что делать:**
```
src/lib/sync/
  daily-sync.ts        — оркестратор (cron, статус, логирование)
  report-fetcher.ts    — скачивание отчётов с WB
  advertising-sync.ts  — синхронизация рекламы
  orders-sync.ts       — синхронизация заказов
```

---

## 6. Фаза 4 — Компоненты и страницы

### 6.1 Разбить god-компоненты

| Компонент | Строк | Разбить на |
|-----------|-------|------------|
| `AccountSettings.tsx` | 942 | `AccountInfoCard`, `AccountKeysSection`, `SyncPanel`, `AutoComplaintsConfig` |
| `ShipmentCalcV3.tsx` | 699 | `useShipmentCalc()` хук + `PackingCards`, `PackingTable`, `WeeklyChart` |
| `ShipmentSettings.tsx` | 613 | `useRegionGroups()` хук + `RegionGroupEditor`, `BoxDimensionsForm` |
| `ShipmentCalcV2.tsx` | 412 | Аналогично V3 |

---

### 6.2 Разбить finance/page.tsx (1209 строк)

**Сейчас:** Один файл = 8 вкладок + 9 локальных интерфейсов + 10 хелперов.

**Что делать:**
```
src/app/finance/
  page.tsx              — layout + табы (< 100 строк)
  _components/
    PnlDashboard.tsx    — P&L водопад
    DailyTable.tsx      — по дням
    ArticlesTable.tsx   — по артикулам  
    CampaignsTab.tsx    — рекламные кампании
    ReconciliationTab.tsx — сверка (уже отдельный компонент)
    ForecastTab.tsx     — прогноз
```

Типы вынести в `src/types/finance.ts`.

---

### 6.3 Разделить DataProvider

**Сейчас:** Один контекст хранит 6 сущностей + 6 методов.

**Что делать:**
```
src/providers/
  ShipmentDataProvider.tsx  — stock, orders, products, refreshData, syncFromWB
  SettingsProvider.tsx       — settings, updateSettings
  OverridesProvider.tsx      — overrides, updateProductPerBox, toggleSizeDisabled
```

Или (проще): оставить один DataProvider, но добавить selector-хуки:
```typescript
export const useShipmentData = () => {
  const { stock, orders, products } = useData();
  return { stock, orders, products };
};

export const useAppSettings = () => {
  const { settings, updateSettings } = useData();
  return { settings, updateSettings };
};
```

---

### 6.4 Извлечь переиспользуемые UI-компоненты

**Сейчас:** Toggle switch реализован 3 раза, модальное окно — 4 раза.

**Что делать:**
```
src/components/ui/
  ToggleSwitch.tsx    — единый переключатель
  ConfirmDialog.tsx   — модальное окно подтверждения
  StatusBadge.tsx     — индикатор статуса (active/error/warning)
  DataTable.tsx       — базовая таблица с сортировкой
```

---

## 7. Фаза 5 — Инфраструктура и DX

### 7.1 Переменные окружения

Создать `.env.example`:
```env
JWT_SECRET=             # обязательно
WB_API_KEY=             # или хранить в БД
WB_TOKEN_PATH=          # путь к токену WB
DEFAULT_SUPPLIER_ID=    # дефолтный поставщик
DEFAULT_COGS=300        # себестоимость по умолчанию
MSK_TIMEZONE_OFFSET=3   # часовой пояс
```

### 7.2 Структурированное логирование

**Сейчас:** `console.log` / `console.error` без контекста.

**Что делать:** Простой логгер (без библиотек):
```typescript
// src/lib/logger.ts
export function log(level: "info" | "warn" | "error", module: string, message: string, data?: unknown) {
  const entry = { ts: new Date().toISOString(), level, module, message, ...data };
  console[level === "error" ? "error" : "log"](JSON.stringify(entry));
}
```

### 7.3 Глобальный обработчик ошибок в API

Обёртка для роутов:
```typescript
export function withErrorHandler(handler: RouteHandler): RouteHandler {
  return async (req, ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      log("error", "api", "Unhandled error", { path: req.url, err });
      return apiError(err);
    }
  };
}
```

---

## 8. Порядок выполнения

```
Фаза 0  ──────────────────────────────  [1-2 дня]
│ SQL-инъекции, JWT, типы articleWB,
│ async в транзакциях, авторизация monitor
│
Фаза 1  ──────────────────────────────  [3-4 дня]
│ database/connection.ts, миграции,
│ constants.ts, расширение типов
│
Фаза 2  ──────────────────────────────  [2-3 дня]
│ api-response.ts, валидация,
│ разбить толстые роуты, единый error handler
│
Фаза 3  ──────────────────────────────  [3-4 дня]
│ Дедупликация calculation-engine,
│ объединение auth-модулей,
│ разбить daily-sync, excel
│
Фаза 4  ──────────────────────────────  [4-5 дней]
│ Разбить god-компоненты,
│ finance/page.tsx → route group,
│ DataProvider → selector хуки,
│ UI-компоненты (Toggle, Modal, etc.)
│
Фаза 5  ──────────────────────────────  [1-2 дня]
│ .env.example, логгер, withErrorHandler
│
                                    Итого: ~14-20 дней
```

---

## Принципы рефакторинга

1. **Не ломать работающее.** Каждая фаза — отдельная ветка, тесты перед мержем.
2. **Один файл — одна ответственность.** Максимум 300 строк для компонентов, 200 для утилит.
3. **Нет magic numbers.** Всё в `constants.ts` или `.env`.
4. **Валидация на границе.** API-роуты валидируют вход, lib/ доверяет параметрам.
5. **Типы, а не `as`.** Убрать type assertions, добавить runtime-валидацию для данных из БД.
