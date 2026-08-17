#!/usr/bin/env node
/**
 * Скачивает еженедельный отчёт из ЛК WB → PostgreSQL weekly_reports/weekly_rows
 * 
 * Логика:
 * - Запрашивает список еженедельных отчётов из ЛК
 * - Проверяет какие уже есть в PostgreSQL
 * - Если есть новый — скачивает Excel (type1 + type2), парсит, загружает в БД
 * - Если нового нет — выходит с кодом 0 и сообщением "нет новых отчётов"
 * 
 * Запуск по крону: пн-ср каждый час с 10:00 до 23:00
 * Как только отчёт скачан — крон останавливается до следующего понедельника
 */
const path = require("path");
const fs = require("fs");
const AdmZip = require("adm-zip");
const { Pool } = require("pg");
const { readFirstSheetRows } = require("./lib/excel-rows");
const { ensureOrganizationDataDir, organizationDataPath, organizationPoolOptions, requireOrganizationId } = require("./lib/organization-runtime");

const PROJECT_DIR = path.join(__dirname, "..");
const ORGANIZATION_ID = requireOrganizationId();
ensureOrganizationDataDir(PROJECT_DIR, ORGANIZATION_ID);
const TOKENS_PATH = organizationDataPath(PROJECT_DIR, "wb-tokens.json", ORGANIZATION_ID);
const LOG_PATH = organizationDataPath(PROJECT_DIR, "weekly-sync.log", ORGANIZATION_ID);

function appendLog(level, args) {
  const line = args.map((arg) => {
    if (arg instanceof Error) return arg.stack || arg.message;
    if (typeof arg === "string") return arg;
    try { return JSON.stringify(arg); } catch { return String(arg); }
  }).join(" ");
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, `[${new Date().toISOString()}] ${level} ${line}\n`);
  } catch { /* logging must not break sync */ }
}

const originalConsoleLog = console.log.bind(console);
const originalConsoleError = console.error.bind(console);
console.log = (...args) => {
  appendLog("INFO", args);
  originalConsoleLog(...args);
};
console.error = (...args) => {
  appendLog("ERROR", args);
  originalConsoleError(...args);
};

function loadEnvFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return;
    for (const line of fs.readFileSync(filePath, "utf-8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const idx = trimmed.indexOf("=");
      const key = trimmed.slice(0, idx).trim();
      const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, "");
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch { /* ignore */ }
}

loadEnvFile(path.join(__dirname, "..", ".env.production.local"));

let pgPool = null;

function getPgPool() {
  if (!pgPool) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required when MPHUB_DB_ENGINE=postgres");
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: organizationPoolOptions(ORGANIZATION_ID),
      max: Number(process.env.PGPOOL_MAX || 5),
      application_name: process.env.PGAPPNAME || "mphub-weekly-sync",
    });
  }
  return pgPool;
}

async function initWeeklyImportStatus(db) {
  const result = await getPgPool().query("SELECT to_regclass('weekly_import_status') AS table_name");
  if (!result.rows[0]?.table_name) throw new Error("Database migration missing: weekly_import_status");
}

async function setWeeklyImportStatus(db, patch) {
  const payload = {
    id: "weekly-reports",
    status: patch.status || "ok",
    loaded: Number(patch.loaded || 0),
    total: Number(patch.total || 0),
    message: patch.message || "",
    details: patch.details || {},
  };
  try {
    await initWeeklyImportStatus(null);
    await getPgPool().query(`
      INSERT INTO weekly_import_status (id, status, loaded, total, message, details_json, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        loaded = EXCLUDED.loaded,
        total = EXCLUDED.total,
        message = EXCLUDED.message,
        details_json = EXCLUDED.details_json,
        updated_at = CURRENT_TIMESTAMP
    `, [
      payload.id,
      payload.status,
      payload.loaded,
      payload.total,
      payload.message,
      JSON.stringify(payload.details),
    ]);
  } catch (error) {
    console.log(`⚠️ weekly_import_status: ${error.message}`);
  }
}

// Маппинг колонок еженедельного отчёта WB → PostgreSQL weekly_rows.
const COLUMN_MAP = [
  { excel: "№", db: "row_num", type: "TEXT" },
  { excel: "Номер поставки", db: "supply_id", type: "TEXT" },
  { excel: "Предмет", db: "subject", type: "TEXT" },
  { excel: "Код номенклатуры", db: "nm_id", type: "TEXT", critical: true },
  { excel: "Бренд", db: "brand", type: "TEXT" },
  { excel: "Артикул поставщика", db: "sa_name", type: "TEXT" },
  { excel: "Название", db: "product_name", type: "TEXT" },
  { excel: "Размер", db: "size", type: "TEXT" },
  { excel: "Баркод", db: "barcode", type: "TEXT", critical: true },
  { excel: "Тип документа", db: "doc_type", type: "TEXT" },
  { excel: "Обоснование для оплаты", db: "supplier_oper_name", type: "TEXT", critical: true },
  { excel: "Дата заказа покупателем", db: "order_dt", type: "TEXT" },
  { excel: "Дата продажи", db: "sale_dt", type: "TEXT", critical: true },
  { excel: "Кол-во", db: "quantity", type: "REAL", critical: true },
  { excel: "Цена розничная", db: "retail_price", type: "REAL" },
  { excel: "Вайлдберриз реализовал Товар (Пр)", db: "retail_amount", type: "REAL", critical: true },
  { excel: "Согласованный продуктовый дисконт, %", db: "product_discount_pct", type: "REAL" },
  { excel: "Промокод, %", db: "promo_code_pct", type: "REAL" },
  { excel: "Итоговая согласованная скидка, %", db: "total_discount_pct", type: "REAL" },
  { excel: "Цена розничная с учетом согласованной скидки", db: "retail_price_withdisc_rub", type: "REAL", critical: true },
  { excel: "Размер снижения кВВ из-за рейтинга, %", db: "kvv_rating_reduction_pct", type: "REAL" },
  { excel: "Размер изменения кВВ из-за акции, %", db: "kvv_promo_change_pct", type: "REAL" },
  { excel: "Скидка постоянного Покупателя (СПП), %", aliases: ["Платформенные скидки, %"], db: "spp_pct", type: "REAL" },
  { excel: "Размер кВВ, %", db: "kvv_pct", type: "REAL" },
  { excel: "Размер  кВВ без НДС, % Базовый", aliases: ["Размер кВВ без НДС, % Базовый"], db: "kvv_base_no_vat_pct", type: "REAL" },
  { excel: "Итоговый кВВ без НДС, %", db: "kvv_final_no_vat_pct", type: "REAL" },
  { excel: "Вознаграждение с продаж до вычета услуг поверенного, без НДС", db: "ppvz_sales_commission", type: "REAL" },
  { excel: "Возмещение за выдачу и возврат товаров на ПВЗ", db: "ppvz_pvz_reward", type: "REAL" },
  { excel: "Эквайринг/Комиссии за организацию платежей", aliases: ["Компенсация платёжных услуг/Комиссия за интеграцию платёжных сервисов"], db: "acquiring_fee", type: "REAL", critical: true },
  { excel: "Размер комиссии за эквайринг/Комиссии за организацию платежей, %", aliases: ["Размер компенсации платёжных услуг/Комиссии за интеграцию платёжных сервисов, %"], db: "acquiring_pct", type: "REAL" },
  { excel: "Тип платежа за Эквайринг/Комиссии за организацию платежей", aliases: ["Тип платежа: компенсация платёжных услуг/Комиссия за интеграцию платёжных сервисов"], db: "acquiring_type", type: "TEXT" },
  { excel: "Вознаграждение Вайлдберриз (ВВ), без НДС", db: "vv_no_vat", type: "REAL" },
  { excel: "НДС с Вознаграждения Вайлдберриз", db: "vv_vat", type: "REAL" },
  { excel: "К перечислению Продавцу за реализованный Товар", db: "ppvz_for_pay", type: "REAL", critical: true },
  { excel: "Количество доставок", db: "delivery_amount", type: "REAL", critical: true },
  { excel: "Количество возврата", db: "return_amount", type: "REAL" },
  { excel: "Услуги по доставке товара покупателю", db: "delivery_rub", type: "REAL", critical: true },
  { excel: "Дата начала действия фиксации", db: "fix_date_from", type: "TEXT" },
  { excel: "Дата конца действия фиксации", db: "fix_date_to", type: "TEXT" },
  { excel: "Признак услуги платной доставки", db: "paid_delivery_flag", type: "TEXT" },
  { excel: "Общая сумма штрафов", db: "penalty", type: "REAL", critical: true },
  { excel: "Корректировка Вознаграждения Вайлдберриз (ВВ)", db: "vv_correction", type: "REAL" },
  { excel: "Виды логистики, штрафов и корректировок ВВ", db: "operation_type", type: "TEXT" },
  { excel: "Стикер МП", db: "sticker_mp", type: "TEXT" },
  { excel: "Наименование банка-эквайера", db: "acquiring_bank", type: "TEXT" },
  { excel: "Номер офиса", db: "office_id", type: "TEXT" },
  { excel: "Наименование офиса доставки", db: "office_name", type: "TEXT" },
  { excel: "ИНН партнера", db: "partner_inn", type: "TEXT" },
  { excel: "Партнер", db: "partner", type: "TEXT" },
  { excel: "Склад", db: "warehouse", type: "TEXT" },
  { excel: "Страна", db: "country", type: "TEXT" },
  { excel: "Тип коробов", db: "box_type", type: "TEXT" },
  { excel: "Номер таможенной декларации", db: "customs_declaration", type: "TEXT" },
  { excel: "Номер сборочного задания", db: "assembly_id", type: "TEXT" },
  { excel: "Код маркировки", db: "marking_code", type: "TEXT" },
  { excel: "ШК", db: "shk", type: "TEXT" },
  { excel: "Srid", db: "srid", type: "TEXT", critical: true },
  { excel: "Возмещение издержек по перевозке/по складским операциям с товаром", db: "rebill_logistic_cost", type: "REAL" },
  { excel: "Организатор перевозки", db: "carrier", type: "TEXT" },
  { excel: "Хранение", db: "storage_fee", type: "REAL", critical: true },
  { excel: "Удержания", db: "deduction", type: "REAL" },
  { excel: "Операции на приемке", db: "acceptance", type: "REAL", critical: true },
  { excel: "chrtId", db: "chrt_id", type: "INTEGER" },
  { excel: "Фиксированный коэффициент склада по поставке", db: "warehouse_coeff", type: "REAL" },
  { excel: "Признак продажи юридическому лицу", db: "b2b_flag", type: "TEXT" },
  { excel: "ТМЦ", db: "tmc_flag", type: "TEXT" },
  { excel: "Номер короба для обработки товара", db: "box_num", type: "TEXT" },
  { excel: "Скидка по программе софинансирования", db: "cofinancing_discount", type: "REAL" },
  { excel: "Скидка Wibes, %", db: "wibes_discount_pct", type: "REAL" },
  { excel: "Компенсация скидки по программе лояльности", db: "loyalty_compensation", type: "REAL" },
  { excel: "Стоимость участия в программе лояльности", db: "loyalty_participation_cost", type: "REAL" },
  { excel: "Сумма удержанная за начисленные баллы программы лояльности", aliases: ["Сумма баллов, удержанных по программе лояльности"], db: "loyalty_points_deduction", type: "REAL" },
  { excel: "Id корзины заказа", db: "cart_id", type: "TEXT" },
  { excel: "Разовое изменение срока перечисления денежных средств", db: "additional_payment", type: "TEXT" },
  { excel: "Способы продажи и тип товара", db: "sale_method", type: "TEXT" },
  { excel: "Id собственной акции продавца с дополнительной скидкой", db: "seller_promo_id", type: "REAL" },
  { excel: "Размер дополнительной скидки по собственной акции продавца, %", db: "seller_promo_pct", type: "REAL" },
  { excel: "Уникальный идентификатор скидки лояльности от продавца", db: "seller_loyalty_id", type: "REAL" },
  { excel: "Размер скидки лояльности от продавца,%", aliases: ["Размер скидки лояльности от продавца, %"], db: "seller_loyalty_pct", type: "REAL" },
  { excel: "Id промокода", db: "promo_id", type: "TEXT" },
  { excel: "Скидка за промокод, %", db: "promo_discount_pct", type: "REAL" },
  { excel: "Id подменного артикула", db: "replacement_nm_id", type: "TEXT" },
  { excel: "Скидка по подменному артикулу, %", db: "replacement_discount_pct", type: "REAL" },
  { excel: "Оптовая скидка для бизнеса, %", db: "wholesale_discount_pct", type: "REAL" },
];

function normalizeExcelHeader(value) {
  return String(value || "").replace(/[\s\u00A0]+/g, " ").trim();
}

function getColumnNames(column) {
  return [column.excel, ...(column.aliases || [])];
}

function getMappedValue(row, column) {
  for (const excelName of getColumnNames(column)) {
    if (Object.prototype.hasOwnProperty.call(row, excelName)) {
      const value = row[excelName];
      return value === undefined || value === null || value === "" ? null : value;
    }
  }
  const normalizedNames = new Set(getColumnNames(column).map(normalizeExcelHeader));
  for (const [key, value] of Object.entries(row)) {
    if (normalizedNames.has(normalizeExcelHeader(key))) {
      return value === undefined || value === null || value === "" ? null : value;
    }
  }
  return null;
}

function getRowsHeaders(rows) {
  const headers = new Set();
  for (const row of rows.slice(0, 20)) {
    for (const header of Object.keys(row)) {
      const normalized = normalizeExcelHeader(header);
      if (normalized) headers.add(normalized);
    }
  }
  return headers;
}

function toNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined || value === "") return 0;
  const normalized = String(value).replace(/\s/g, "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sumBy(rows, dbColumn, predicate = () => true) {
  const column = COLUMN_MAP.find((c) => c.db === dbColumn);
  if (!column) return 0;
  return rows.reduce((total, row) => {
    if (!predicate(row)) return total;
    return total + toNumber(getMappedValue(row, column));
  }, 0);
}

function formatAuditNumber(value) {
  return Math.round(value).toLocaleString("ru-RU");
}

function validateWeeklyRows(rows, reportId) {
  const headers = getRowsHeaders(rows);
  const knownHeaders = new Set(COLUMN_MAP.flatMap(getColumnNames).map(normalizeExcelHeader));
  const unknownHeaders = [...headers].filter((header) => !knownHeaders.has(header));
  const missingCritical = COLUMN_MAP
    .filter((column) => column.critical)
    .filter((column) => !getColumnNames(column).some((name) => headers.has(normalizeExcelHeader(name))));
  const aliasHits = COLUMN_MAP
    .filter((column) => column.aliases?.length)
    .map((column) => ({
      db: column.db,
      primary: normalizeExcelHeader(column.excel),
      usedAlias: column.aliases.find((alias) => headers.has(normalizeExcelHeader(alias))),
    }))
    .filter((item) => item.usedAlias && !headers.has(item.primary));

  if (missingCritical.length > 0) {
    const missing = missingCritical.map((column) => `${column.db}: ${getColumnNames(column).join(" / ")}`).join("; ");
    throw new Error(`Не найдены критичные колонки WB: ${missing}; старые данные не удалены`);
  }

  if (unknownHeaders.length > 0) {
    console.log(`  ⚠️ Отчёт #${reportId}: новые/неиспользуемые колонки WB (${unknownHeaders.length}): ${unknownHeaders.slice(0, 20).join(" | ")}${unknownHeaders.length > 20 ? " | ..." : ""}`);
  }
  if (aliasHits.length > 0) {
    console.log(`  ℹ️ Отчёт #${reportId}: использованы alias-колонки: ${aliasHits.map((item) => `${item.db} ← ${item.usedAlias}`).join("; ")}`);
  }
  return {
    unknownHeaders,
    aliasHits,
  };
}

function logWeeklyAudit(rows, reportId) {
  const operColumn = COLUMN_MAP.find((c) => c.db === "supplier_oper_name");
  const isOperation = (name) => (row) => normalizeExcelHeader(getMappedValue(row, operColumn)) === name;
  const audit = {
    sales: sumBy(rows, "retail_price_withdisc_rub", isOperation("Продажа")),
    returns: sumBy(rows, "retail_price_withdisc_rub", isOperation("Возврат")),
    logistics: sumBy(rows, "delivery_rub"),
    storage: sumBy(rows, "storage_fee"),
    penalty: sumBy(rows, "penalty"),
    acceptance: sumBy(rows, "acceptance"),
    acquiring: sumBy(rows, "acquiring_fee"),
    ppvz: sumBy(rows, "ppvz_for_pay", isOperation("Продажа")) - sumBy(rows, "ppvz_for_pay", isOperation("Возврат")),
  };
  console.log(
    `  Σ Отчёт #${reportId}: продажи ${formatAuditNumber(audit.sales)} ₽; возвраты ${formatAuditNumber(audit.returns)} ₽; ` +
    `логистика ${formatAuditNumber(audit.logistics)} ₽; хранение ${formatAuditNumber(audit.storage)} ₽; ` +
    `штрафы ${formatAuditNumber(audit.penalty)} ₽; приемка ${formatAuditNumber(audit.acceptance)} ₽; ` +
    `платёжные услуги ${formatAuditNumber(audit.acquiring)} ₽; к перечислению ${formatAuditNumber(audit.ppvz)} ₽`
  );
  return audit;
}

async function getAuthHeaders() {
  const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, "utf-8"));
  const refreshRes = await fetch(
    "https://seller.wildberries.ru/ns/suppliers-auth/suppliers-portal-core/auth/token",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorizev3: tokens.authorizev3,
        cookie: tokens.cookies,
        origin: "https://seller.wildberries.ru",
        referer: "https://seller.wildberries.ru/",
      },
      body: JSON.stringify({ params: {}, jsonrpc: "2.0", id: "json-rpc_1" }),
    }
  );
  const sellerLk = (await refreshRes.json()).result?.data?.token;
  if (!sellerLk) throw new Error("Не удалось получить токен ЛК WB");

  return {
    authorizev3: tokens.authorizev3,
    "wb-seller-lk": sellerLk,
    cookie: tokens.cookies,
    origin: "https://seller.wildberries.ru",
    referer: "https://seller.wildberries.ru/",
  };
}

async function getWeeklyReports(headers) {
  const res = await fetch(
    "https://seller-services.wildberries.ru/ns/reports/seller-wb-balance/api/v1/reports-weekly?type=6&skip=0&limit=15",
    { headers }
  );
  if (!res.ok) throw new Error("Ошибка списка отчётов: " + res.status);
  const data = await res.json();
  return data?.data?.reports || [];
}

function getXlsxPartNumber(entryName) {
  const match = entryName.match(/\s-\s(\d+)\.xlsx$/i);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

async function downloadExcel(headers, reportId) {
  const url = `https://seller-services.wildberries.ru/ns/reports/seller-wb-balance/api/v1/reports-weekly/${reportId}/details/archived-excel?format=binary`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Ошибка скачивания #${reportId}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());

  if (buf.length < 1000) {
    console.log(`  ⚠️ Отчёт #${reportId}: файл слишком маленький (${buf.length} байт), пропускаю`);
    return null;
  }

  // Распаковка ZIP → все XLSX-части отчёта. WB режет крупные отчёты по 20000 строк.
  const zip = new AdmZip(buf);
  const xlsxEntries = zip
    .getEntries()
    .filter((entry) => !entry.isDirectory && entry.entryName.endsWith(".xlsx"))
    .sort((a, b) => {
      const partDiff = getXlsxPartNumber(a.entryName) - getXlsxPartNumber(b.entryName);
      return partDiff || a.entryName.localeCompare(b.entryName, "ru");
    });

  if (xlsxEntries.length > 0) {
    if (xlsxEntries.length > 1) {
      console.log(`  📦 Отчёт #${reportId}: найдено XLSX-частей: ${xlsxEntries.length}`);
    }
    return xlsxEntries.map((entry) => ({ name: entry.entryName, data: entry.getData() }));
  }
  throw new Error(`В ZIP нет .xlsx файла для #${reportId}`);
}

async function readExcelPartsRows(xlsxParts, reportId) {
  const rows = [];
  for (const part of xlsxParts) {
    const partRows = await readFirstSheetRows(part.data);
    if (xlsxParts.length > 1) {
      console.log(`    ${part.name}: ${partRows.length} строк`);
    }
    rows.push(...partRows);
  }
  if (xlsxParts.length > 1) {
    console.log(`  📦 Отчёт #${reportId}: всего строк из ZIP: ${rows.length}`);
  }
  return rows;
}

function buildPgBatchInsert(rows, reportId, reportType, periodFrom, periodTo) {
  const dbCols = COLUMN_MAP.map((c) => c.db);
  const allCols = ["report_id", "report_type", "period_from", "period_to", ...dbCols];
  const values = [];
  const rowSql = rows.map((r, rowIndex) => {
    const placeholders = allCols.map((_, colIndex) => `$${rowIndex * allCols.length + colIndex + 1}`);
    values.push(reportId, reportType, periodFrom, periodTo);
    for (const c of COLUMN_MAP) values.push(getMappedValue(r, c));
    return `(${placeholders.join(",")})`;
  });

  return {
    sql: `INSERT INTO weekly_rows (${allCols.join(",")}) VALUES ${rowSql.join(",")}`,
    values,
  };
}

async function loadExcelToPg(xlsxParts, reportId, reportType, periodFrom, periodTo, expectedRows = 0) {
  const rows = await readExcelPartsRows(xlsxParts, reportId);
  if (rows.length === 0) {
    console.log(`  ⚠️ Отчёт #${reportId}: Excel пустой`);
    return { rowsLoaded: 0, validation: { unknownHeaders: [], aliasHits: [] }, audit: {} };
  }
  if (expectedRows > 0 && rows.length < expectedRows) {
    throw new Error(`Excel содержит ${rows.length} строк из ${expectedRows}; старые данные не удалены`);
  }
  const validation = validateWeeklyRows(rows, reportId);
  const audit = logWeeklyAudit(rows, reportId);

  const client = await getPgPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM weekly_rows WHERE report_id = $1", [reportId]);
    await client.query("DELETE FROM reports WHERE report_id = $1", [reportId]);

    const batchSize = 250;
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = buildPgBatchInsert(rows.slice(i, i + batchSize), reportId, reportType, periodFrom, periodTo);
      await client.query(batch.sql, batch.values);
    }

    await client.query(`
      INSERT INTO reports (report_id, report_type, period_from, period_to, rows_count)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (report_id) DO UPDATE SET
        report_type = EXCLUDED.report_type,
        period_from = EXCLUDED.period_from,
        period_to = EXCLUDED.period_to,
        rows_count = EXCLUDED.rows_count,
        loaded_at = CURRENT_TIMESTAMP
    `, [reportId, reportType, periodFrom, periodTo, rows.length]);
    await client.query("COMMIT");
    return { rowsLoaded: rows.length, validation, audit };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function recalculateBuyoutRatesPg() {
  const client = await getPgPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM buyout_rates");
    await client.query("DELETE FROM weekly_buyout_stats");
    const buyoutResult = await client.query(`
      INSERT INTO buyout_rates (article_wb, orders, buyouts, buyout_rate, updated_at)
      SELECT nm_id,
        COUNT(DISTINCT CASE WHEN supplier_oper_name = 'Логистика' THEN srid END) as orders,
        COUNT(DISTINCT CASE WHEN supplier_oper_name = 'Продажа' THEN srid END) as buyouts,
        CASE
          WHEN COUNT(DISTINCT CASE WHEN supplier_oper_name = 'Логистика' THEN srid END) > 0
          THEN COUNT(DISTINCT CASE WHEN supplier_oper_name = 'Продажа' THEN srid END)::double precision
            / COUNT(DISTINCT CASE WHEN supplier_oper_name = 'Логистика' THEN srid END)
          ELSE 0
        END as buyout_rate,
        CURRENT_TIMESTAMP
      FROM weekly_rows
      WHERE supplier_oper_name IN ('Логистика', 'Продажа') AND nm_id != ''
      GROUP BY nm_id
      HAVING COUNT(DISTINCT CASE WHEN supplier_oper_name = 'Логистика' THEN srid END) >= 30
    `);
    const weeklyResult = await client.query(`
      INSERT INTO weekly_buyout_stats (period_from, period_to, orders, buyouts, returns, return_rate)
      SELECT period_from, period_to,
        COUNT(DISTINCT CASE WHEN supplier_oper_name = 'Логистика' THEN srid END) as orders,
        COUNT(DISTINCT CASE WHEN supplier_oper_name = 'Продажа' THEN srid END) as buyouts,
        COUNT(DISTINCT CASE WHEN supplier_oper_name = 'Логистика' THEN srid END)
          - COUNT(DISTINCT CASE WHEN supplier_oper_name = 'Продажа' THEN srid END) as returns,
        CASE
          WHEN COUNT(DISTINCT CASE WHEN supplier_oper_name = 'Логистика' THEN srid END) > 0
          THEN (
            COUNT(DISTINCT CASE WHEN supplier_oper_name = 'Логистика' THEN srid END)
              - COUNT(DISTINCT CASE WHEN supplier_oper_name = 'Продажа' THEN srid END)
          )::double precision / COUNT(DISTINCT CASE WHEN supplier_oper_name = 'Логистика' THEN srid END)
          ELSE 0
        END as return_rate
      FROM weekly_rows
      WHERE supplier_oper_name IN ('Логистика', 'Продажа')
      GROUP BY period_from, period_to
    `);
    await client.query("COMMIT");
    return { buyoutRows: buyoutResult.rowCount || 0, weeklyRows: weeklyResult.rowCount || 0 };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  console.log(`[${new Date().toISOString()}] Синхронизация еженедельных отчётов WB`);

  const db = null;
  await initWeeklyImportStatus(null);
  await setWeeklyImportStatus(db, {
    status: "syncing",
    message: "Weekly sync started",
    details: { started_at: new Date().toISOString() },
  });

  // Авторизация
  let headers;
  try {
    headers = await getAuthHeaders();
  } catch (e) {
    console.log("❌ Ошибка авторизации: " + e.message);
    await setWeeklyImportStatus(db, {
      status: "error",
      message: "Ошибка авторизации WB: " + e.message,
      details: { stage: "auth", error: e.message },
    });
    if (db) db.close();
    if (pgPool) await pgPool.end();
    process.exit(1);
  }

  // Список отчётов из ЛК
  const wbReports = await getWeeklyReports(headers);
  console.log(`Отчётов в ЛК: ${wbReports.length}`);

  // Какие уже загружены
  const loadedRows = (await getPgPool().query("SELECT report_id, rows_count FROM reports")).rows;
  const loaded = new Map(loadedRows.map((r) => [
    Number(r.report_id),
    { rowsCount: Number(r.rows_count || 0) },
  ]));
  console.log(`Уже загружено: ${loaded.size} отчётов`);

  // Группируем по периоду (type1 + type2)
  const periods = {};
  for (const r of wbReports) {
    const key = r.dateFrom?.slice(0, 10);
    if (!key) continue;
    if (!periods[key]) periods[key] = [];
    periods[key].push(r);
  }

  let newCount = 0;
  let hadErrors = false;
  const importedReports = [];
  const warnings = [];
  const errors = [];
  for (const [periodFrom, reports] of Object.entries(periods).sort()) {
    const allLoaded = reports.every((r) => {
      const loadedReport = loaded.get(Number(r.id));
      const expectedRows = Number(r.detailsCount || 0);
      return loadedReport && (expectedRows <= 0 || loadedReport.rowsCount >= expectedRows);
    });
    if (allLoaded) continue;

    // Новый период — скачиваем
    const periodTo = reports[0].dateTo?.slice(0, 10);
    console.log(`\n📥 Новый период: ${periodFrom} — ${periodTo}`);

    for (const report of reports) {
      const loadedReport = loaded.get(Number(report.id));
      const expectedRows = Number(report.detailsCount || 0);
      if (loadedReport && (expectedRows <= 0 || loadedReport.rowsCount >= expectedRows)) {
        console.log(`  type=${report.type}: уже загружен (#${report.id})`);
        continue;
      }
      if (loadedReport && expectedRows > loadedReport.rowsCount) {
        console.log(`  type=${report.type}: перезагружаю неполный отчёт (#${report.id}: ${loadedReport.rowsCount} из ${expectedRows} строк)`);
      }

      console.log(`  type=${report.type}: скачиваю (#${report.id}, ${report.detailsCount} строк)...`);
      try {
        const xlsxParts = await downloadExcel(headers, report.id);
        if (!xlsxParts) continue;

        const result = await loadExcelToPg(xlsxParts, report.id, report.type, periodFrom, periodTo, Number(report.detailsCount || 0));
        const rowsLoaded = result.rowsLoaded;
        console.log(`  ✅ type=${report.type}: загружено ${rowsLoaded} строк`);
        importedReports.push({
          report_id: Number(report.id),
          report_type: Number(report.type),
          period_from: periodFrom,
          period_to: periodTo,
          rows_loaded: rowsLoaded,
          expected_rows: expectedRows,
          audit: result.audit,
          unknown_headers: result.validation.unknownHeaders,
          alias_hits: result.validation.aliasHits,
        });
        if (result.validation.unknownHeaders.length > 0) {
          warnings.push({
            report_id: Number(report.id),
            type: "unknown_headers",
            message: `Новые/неиспользуемые колонки WB: ${result.validation.unknownHeaders.slice(0, 20).join(" | ")}`,
            count: result.validation.unknownHeaders.length,
          });
        }
        newCount++;
      } catch (e) {
        hadErrors = true;
        errors.push({
          report_id: Number(report.id),
          report_type: Number(report.type),
          period_from: periodFrom,
          period_to: periodTo,
          message: e.message,
        });
        console.log(`  ❌ type=${report.type}: ${e.message}`);
      }
    }
  }

  // Пересчёт buyout_rates в PostgreSQL
  if (newCount > 0) {
    try {
      const result = await recalculateBuyoutRatesPg();
      console.log(`✅ buyout_rates обновлены: ${result.buyoutRows} артикулов, ${result.weeklyRows} недель`);
    } catch (e) {
      console.log(`⚠️ buyout_rates: ${e.message}`);
    }
  }

  // Итог
  const total = (await getPgPool().query("SELECT COUNT(*)::int as c FROM weekly_rows")).rows[0];
  const reportsList = (await getPgPool().query("SELECT * FROM reports ORDER BY period_from DESC")).rows;

  console.log(`\n════════════════════════════`);
  if (newCount > 0) {
    console.log(`✅ Загружено новых: ${newCount}`);
  } else {
    console.log(`ℹ️ Новых отчётов нет`);
  }
  console.log(`Всего в базе: ${total.c} строк, ${reportsList.length} отчётов`);
  reportsList.slice(0, 6).forEach((r) =>
    console.log(`  #${r.report_id} type=${r.report_type}: ${r.period_from}—${r.period_to} (${r.rows_count} строк)`)
  );

  const finalStatus = hadErrors ? "error" : warnings.length > 0 ? "warn" : "ok";
  const finalMessage = hadErrors
    ? `Weekly sync completed with ${errors.length} error(s)`
    : warnings.length > 0
      ? `Weekly sync completed with ${warnings.length} warning(s)`
      : newCount > 0
        ? `Загружено новых отчётов: ${newCount}`
        : "Новых отчётов нет";
  await setWeeklyImportStatus(db, {
    status: finalStatus,
    loaded: newCount,
    total: reportsList.length,
    message: finalMessage,
    details: {
      total_rows: total.c,
      reports_count: reportsList.length,
      imported_reports: importedReports,
      warnings,
      errors,
      latest_reports: reportsList.slice(0, 6).map((r) => ({
        report_id: Number(r.report_id),
        report_type: Number(r.report_type),
        period_from: r.period_from,
        period_to: r.period_to,
        rows_count: Number(r.rows_count),
      })),
    },
  });

  if (db) db.close();
  if (pgPool) await pgPool.end();
  
  // Код выхода: 0 = есть новые или нет новых, 1 = ошибка
  process.exit(hadErrors ? 1 : 0);
}

main().catch((e) => {
  console.error("❌ Критическая ошибка:", e.message);
  setWeeklyImportStatus(null, {
    status: "error",
    message: "Критическая ошибка weekly sync: " + e.message,
    details: { stage: "critical", error: e.message },
  }).finally(async () => {
    if (pgPool) await pgPool.end().catch(() => {});
    process.exit(1);
  });
});
