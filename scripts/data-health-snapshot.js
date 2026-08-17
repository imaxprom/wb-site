#!/usr/bin/env node
/**
 * Production data health snapshot for /monitor.
 *
 * This script is intentionally independent from Next.js API auth/proxy. Cron
 * runs it locally and writes public/data/monitor/data-health-cron.json.
 */

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
const { ensureOrganizationDataDir, organizationDataPath, organizationPoolOptions, requireOrganizationId } = require("./lib/organization-runtime");

const PROJECT_DIR = path.join(__dirname, "..");
const ORGANIZATION_ID = requireOrganizationId();
const DATA_DIR = ensureOrganizationDataDir(PROJECT_DIR, ORGANIZATION_ID);
const API_KEY_PATH = organizationDataPath(PROJECT_DIR, "wb-api-key.txt", ORGANIZATION_ID);

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

loadEnvFile(path.join(PROJECT_DIR, ".env.production.local"));

let pgPool = null;

function getPgPool() {
  if (!pgPool) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required when MPHUB_DB_ENGINE=postgres");
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: organizationPoolOptions(ORGANIZATION_ID),
      max: Number(process.env.PGPOOL_MAX || 5),
      application_name: process.env.PGAPPNAME || "mphub-data-health",
    });
  }
  return pgPool;
}

function mskDate(offsetDays = 0) {
  const d = new Date(Date.now() + 3 * 60 * 60 * 1000);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function mskHour() {
  return new Date(Date.now() + 3 * 60 * 60 * 1000).getUTCHours();
}

function parseTimestamp(value) {
  if (!value) return null;
  let text = String(value).trim();
  if (!text) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) text += "T00:00:00Z";
  if (/^\d{4}-\d{2}-\d{2} \d/.test(text)) text = text.replace(" ", "T");
  text = text.replace(/(\.\d{3})\d+/, "$1");
  text = text.replace(/([+-]\d{2})$/, "$1:00");
  const dt = new Date(text);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function ageMinutes(value) {
  const dt = parseTimestamp(value);
  if (!dt) return 999999;
  return Math.round((Date.now() - dt.getTime()) / 60000);
}

function formatAge(minutes) {
  if (minutes >= 999999) return "нет даты";
  if (minutes < 0) return "только что";
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} ч назад`;
  return `${Math.floor(hours / 24)} д назад`;
}

function formatDbTimestamp(value) {
  if (!value) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function addCheck(checks, id, name, status, value, detail) {
  const check = { id, name, status, value };
  if (detail) check.detail = detail;
  checks.push(check);
}

function readFileTrim(filePath) {
  try { return fs.readFileSync(filePath, "utf-8").trim(); } catch { return ""; }
}

function latestLogState(filePath, okPattern, errorPattern) {
  try {
    const lines = fs.readFileSync(filePath, "utf-8").trim().split(/\r?\n/).slice(-400);
    let lastOk = null;
    let lastError = null;
    const remember = (current, line, timestamp) => {
      if (timestamp || !current || !current.timestamp) return { line, timestamp };
      return current;
    };
    for (const line of lines) {
      const timeMatch = line.match(/\[(\d{4}-\d{2}-\d{2}[T ][^\]]+)\]/);
      const timestamp = timeMatch ? timeMatch[1] : null;
      if (okPattern.test(line)) lastOk = remember(lastOk, line, timestamp);
      if (errorPattern.test(line)) lastError = remember(lastError, line, timestamp);
    }
    return { lastOk, lastError };
  } catch {
    return { lastOk: null, lastError: null };
  }
}

function isSameOrAfter(left, right) {
  const l = parseTimestamp(left);
  const r = parseTimestamp(right);
  if (!l || !r) return Boolean(left && !right);
  return l.getTime() >= r.getTime();
}

function checkLogFreshness(checks, { id, name, logPath, okPattern, errorPattern, maxOkAgeMin }) {
  const state = latestLogState(logPath, okPattern, errorPattern);
  const lastOkAge = ageMinutes(state.lastOk?.timestamp);
  const errorAfterOk = state.lastError?.timestamp && isSameOrAfter(state.lastError.timestamp, state.lastOk?.timestamp);

  if (errorAfterOk) {
    addCheck(checks, id, name, "error", "Последний запуск с ошибкой", state.lastError.line);
    return;
  }
  if (!state.lastOk) {
    addCheck(checks, id, name, "error", "Нет успешных запусков", `Лог: ${logPath}`);
    return;
  }
  if (lastOkAge > maxOkAgeMin) {
    addCheck(checks, id, name, "error", `OK был ${formatAge(lastOkAge)}`, state.lastOk.line);
    return;
  }
  addCheck(checks, id, name, "ok", `OK ${formatAge(lastOkAge)}`, state.lastOk.line);
}

function checkShipmentSyncLog(checks) {
  checkLogFreshness(checks, {
    id: "cron_shipment_sync",
    name: "Cron shipment-sync",
    logPath: path.join(DATA_DIR, "shipment-sync.log"),
    okPattern: /Sync OK: .*"stockSkipped"\s*:\s*false/i,
    errorPattern: /"stockSkipped"\s*:\s*true|ERROR: sync failed|ERROR: API key|ERROR: MpHub app/i,
    maxOkAgeMin: 130,
  });
}

async function pgGet(sql, params = []) {
  const result = await getPgPool().query(sql, params);
  return result.rows[0];
}

async function getMonitorCapabilities() {
  const settingRows = await getPgPool().query(
    "SELECT key, value FROM settings WHERE key IN ($1, $2)",
    ["monitor_fbo_enabled", "monitor_reviews_enabled"]
  );
  const settings = new Map(settingRows.rows.map((row) => [String(row.key), String(row.value).toLowerCase()]));
  const reviews = await pgGet("SELECT COUNT(*)::int AS cnt FROM review_accounts WHERE COALESCE(api_key, '') <> ''");
  const flag = (key, fallback) => settings.has(key) ? settings.get(key) === "true" : fallback;
  return {
    fbo: flag("monitor_fbo_enabled", true),
    reviews: flag("monitor_reviews_enabled", Number(reviews?.cnt || 0) > 0),
  };
}

async function checkWbApi(checks) {
  const apiKey = readFileTrim(API_KEY_PATH);
  if (!apiKey) {
    addCheck(checks, "wb_api_valid", "WB API ключ (онлайн)", "error", "Отсутствует");
    return;
  }

  try {
    const res = await fetch("https://statistics-api.wildberries.ru/ping", {
      headers: { Authorization: apiKey },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 200 || res.status === 201) {
      addCheck(checks, "wb_api_valid", "WB API ключ (онлайн)", "ok", `Валиден (HTTP ${res.status})`);
    } else if (res.status === 401 || res.status === 403) {
      addCheck(checks, "wb_api_valid", "WB API ключ (онлайн)", "error", `Истёк или отозван (HTTP ${res.status})`);
    } else {
      addCheck(checks, "wb_api_valid", "WB API ключ (онлайн)", "warn", `HTTP ${res.status}`);
    }
  } catch (err) {
    addCheck(checks, "wb_api_valid", "WB API ключ (онлайн)", "warn", "Не удалось проверить", String(err));
  }
}

async function checkPgData(checks, capabilities) {
  const yd = mskDate(-1);
  const today = mskDate(0);
  await pgGet("SELECT 1");
  addCheck(checks, "postgres_db", "PostgreSQL", "ok", "Доступна");

  const realization = await pgGet(
    "SELECT COUNT(*)::int AS cnt FROM realization WHERE LEFT(COALESCE(NULLIF(sale_dt,''), NULLIF(rr_dt,''), ''), 10) = $1",
    [yd]
  );
  addCheck(
    checks,
    "fresh_realization_yesterday",
    `Реализация за ${yd}`,
    realization.cnt > 0 ? "ok" : "error",
    `${realization.cnt} строк`,
    realization.cnt === 0 ? "Ежедневный отчёт не загружен за вчера" : undefined
  );

  const ads = await pgGet(
    "SELECT COUNT(*)::int AS cnt, COALESCE(SUM(amount),0)::float AS sum FROM advertising WHERE date = $1",
    [yd]
  );
  addCheck(
    checks,
    "fresh_advertising_yesterday",
    `Реклама за ${yd}`,
    ads.cnt > 0 ? "ok" : "error",
    ads.cnt > 0 ? `${Math.round(ads.sum).toLocaleString("ru-RU")}₽, ${ads.cnt} строк` : "Нет данных"
  );

  const orders = await pgGet(
    "SELECT COALESCE(SUM(order_count),0)::int AS cnt FROM orders_funnel WHERE date = $1",
    [yd]
  );
  addCheck(
    checks,
    "fresh_orders_funnel_yesterday",
    `Заказы воронки за ${yd}`,
    orders.cnt > 0 ? "ok" : "error",
    orders.cnt > 0 ? `${orders.cnt} заказов` : "Нет данных"
  );

  if (capabilities.fbo) {
    const storage = await pgGet(
      "SELECT COUNT(*)::int AS cnt, COALESCE(SUM(warehouse_price),0)::float AS sum FROM paid_storage WHERE date = $1",
      [yd]
    );
    const storageMissingStatus = mskHour() >= 6 ? "error" : "warn";
    addCheck(
      checks,
      "fresh_paid_storage_yesterday",
      `Хранение за ${yd}`,
      storage.cnt > 0 ? "ok" : storageMissingStatus,
      storage.cnt > 0 ? `${Math.round(storage.sum).toLocaleString("ru-RU")}₽, ${storage.cnt} строк` : "Нет данных",
      storage.cnt === 0 ? "После 06:00 МСК отсутствие хранения за вчера считается ошибкой" : undefined
    );
  } else {
    addCheck(checks, "fresh_paid_storage_yesterday", "Хранение FBO", "disabled", "Не используется этим юрлицом");
  }

  const shipmentOrders = await pgGet(
    "SELECT MAX(date) AS max_date, COUNT(*) FILTER (WHERE LEFT(date,10) = $1)::int AS today_cnt, COUNT(*) FILTER (WHERE LEFT(date,10) = $2)::int AS yd_cnt FROM shipment_orders",
    [today, yd]
  );
  const maxOrderAge = ageMinutes(shipmentOrders.max_date);
  const shipmentStatus = shipmentOrders.today_cnt > 0 || shipmentOrders.yd_cnt > 0 ? "ok" : "error";
  addCheck(
    checks,
    "fresh_shipment_orders",
    "Заказы отгрузки",
    shipmentStatus,
    `сегодня ${shipmentOrders.today_cnt}, вчера ${shipmentOrders.yd_cnt}`,
    shipmentOrders.max_date ? `Последний заказ: ${shipmentOrders.max_date} (${formatAge(maxOrderAge)})` : "Нет заказов"
  );

  if (capabilities.fbo) {
    const stock = await pgGet("SELECT COUNT(*)::int AS cnt, MAX(updated_at) AS updated_at FROM shipment_stock");
    const stockAge = ageMinutes(stock.updated_at);
    addCheck(
      checks,
      "fresh_shipment_stock",
      "Остатки отгрузки",
      stock.cnt > 0 && stockAge <= 150 ? "ok" : stock.cnt > 0 && stockAge <= 240 ? "warn" : "error",
      `${stock.cnt} позиций`,
      stock.updated_at ? `Последний синк: ${stock.updated_at} (${formatAge(stockAge)})` : "Нет синка"
    );

    const remains = await pgGet("SELECT COUNT(*)::int AS cnt, MAX(synced_at) AS synced_at FROM warehouse_remains_volume");
    const remainsAge = ageMinutes(remains.synced_at);
    addCheck(
      checks,
      "fresh_warehouse_remains_volume",
      "Объём из отчёта остатков",
      remains.cnt > 0 && remainsAge <= 8 * 60 ? "ok" : remains.cnt > 0 && remainsAge <= 24 * 60 ? "warn" : "error",
      `${remains.cnt} строк`,
      remains.synced_at ? `Последний синк: ${remains.synced_at} (${formatAge(remainsAge)})` : "Нет синка"
    );

    const measurements = await pgGet("SELECT COUNT(*)::int AS cnt, MAX(synced_at) AS synced_at FROM warehouse_measurements");
    const measurementsAge = ageMinutes(measurements.synced_at);
    addCheck(
      checks,
      "fresh_warehouse_measurements",
      "Замеры склада WB",
      measurements.cnt > 0 && measurementsAge <= 8 * 60 ? "ok" : measurements.cnt > 0 && measurementsAge <= 24 * 60 ? "warn" : "error",
      `${measurements.cnt} строк`,
      measurements.synced_at ? `Последний синк: ${measurements.synced_at} (${formatAge(measurementsAge)})` : "Нет синка"
    );
  } else {
    addCheck(checks, "fresh_shipment_stock", "Остатки FBO", "disabled", "Не используется этим юрлицом");
    addCheck(checks, "fresh_warehouse_remains_volume", "Объём из отчёта остатков", "disabled", "Не используется этим юрлицом");
    addCheck(checks, "fresh_warehouse_measurements", "Замеры склада WB", "disabled", "Не используется этим юрлицом");
  }

  const reports = await pgGet("SELECT COUNT(*)::int AS cnt, MAX(period_to) AS last_to FROM reports");
  const reportAgeDays = reports.last_to ? Math.round((Date.now() - new Date(reports.last_to).getTime()) / 86400000) : 999;
  addCheck(
    checks,
    "fresh_weekly_reports",
    "Еженедельные Excel-отчёты",
    reports.cnt > 0 && reportAgeDays <= 14 ? "ok" : reports.cnt > 0 && reportAgeDays <= 21 ? "warn" : "error",
    reports.last_to ? `до ${reports.last_to}, ${reports.cnt} отчётов` : "Нет отчётов"
  );

  const weeklyStatusTable = await pgGet("SELECT to_regclass('weekly_import_status') AS table_name");
  if (!weeklyStatusTable.table_name) {
    addCheck(
      checks,
      "weekly_import_status",
      "Импорт weekly reports",
      "warn",
      "Нет статуса",
      "Скрипт ещё не записывал weekly_import_status"
    );
  } else {
    const weeklyStatus = await pgGet("SELECT status, loaded, total, message, updated_at, details_json FROM weekly_import_status WHERE id = $1", ["weekly-reports"]);
    if (!weeklyStatus) {
      addCheck(checks, "weekly_import_status", "Импорт weekly reports", "warn", "Нет статуса");
    } else {
      const details = weeklyStatus.details_json && typeof weeklyStatus.details_json === "object" ? weeklyStatus.details_json : {};
      const warnings = Array.isArray(details.warnings) ? details.warnings.length : 0;
      const errors = Array.isArray(details.errors) ? details.errors.length : 0;
      const suffix = warnings || errors ? `; warn ${warnings}, err ${errors}` : "";
      addCheck(
        checks,
        "weekly_import_status",
        "Импорт weekly reports",
        weeklyStatus.status === "error" ? "error" : weeklyStatus.status === "warn" ? "warn" : "ok",
        `${weeklyStatus.message || weeklyStatus.status}${suffix}`,
        weeklyStatus.updated_at ? `Последний запуск: ${formatDbTimestamp(weeklyStatus.updated_at)}; отчётов в БД: ${weeklyStatus.total}` : undefined
      );
    }
  }

  if (capabilities.reviews) {
    const reviewsStatus = await pgGet("SELECT MAX(updated_at) AS updated_at FROM sync_status");
    const reviewsAge = ageMinutes(reviewsStatus.updated_at);
    addCheck(
      checks,
      "fresh_reviews_sync",
      "Отзывы",
      reviewsAge <= 75 ? "ok" : reviewsAge <= 180 ? "warn" : "error",
      reviewsStatus.updated_at ? `sync ${formatAge(reviewsAge)}` : "Нет sync_status",
      reviewsStatus.updated_at || undefined
    );
  } else {
    addCheck(checks, "fresh_reviews_sync", "Отзывы", "disabled", "Аккаунт отзывов не настроен");
  }
}

function checkCronLogs(checks, capabilities) {
  checkLogFreshness(checks, {
    id: "cron_daily_sync",
    name: "Cron daily-sync",
    logPath: path.join(DATA_DIR, "daily-sync.log"),
    okPattern: /Daily sync API OK: .*"ok"\s*:\s*true/i,
    errorPattern: /Daily sync API OK: .*"ok"\s*:\s*false|ERROR: daily sync API failed/i,
    maxOkAgeMin: 130,
  });

  checkLogFreshness(checks, {
    id: "cron_weekly_sync",
    name: "Cron weekly-sync",
    logPath: path.join(DATA_DIR, "weekly-sync.log"),
    okPattern: /Новых отчётов нет|Загружено новых|загружено \d+ строк/i,
    errorPattern: /❌|Не найдены критичные колонки|Критическая ошибка|ERROR/i,
    maxOkAgeMin: 96 * 60,
  });

  checkShipmentSyncLog(checks);

  checkLogFreshness(checks, {
    id: "cron_supply_reports_sync",
    name: "Cron supply-reports",
    logPath: path.join(DATA_DIR, "supply-reports-sync.log"),
    okPattern: /Supply reports sync OK/i,
    errorPattern: /Supply reports sync OK: .*"errors"\s*:\s*\[(?!\])|ERROR: supply reports sync failed|\bERROR\b|CRITICAL|Traceback/i,
    maxOkAgeMin: 36 * 60,
  });

  if (capabilities.reviews) {
    checkLogFreshness(checks, {
      id: "cron_reviews_sync",
      name: "Cron reviews-sync",
      logPath: path.join(DATA_DIR, "reviews-sync.log"),
      okPattern: /Archive top tick (OK|skipped|rate-limited)|Archive tick OK|Delta sync done|Reviews sync completed/i,
      errorPattern: /FATAL|ERROR|CRITICAL|Traceback/i,
      maxOkAgeMin: 75,
    });
    checkLogFreshness(checks, {
      id: "cron_reviews_complaints",
      name: "Cron автожалобы",
      logPath: path.join(DATA_DIR, "reviews-complaints.log"),
      okPattern: /Auto-complaints finished|No accounts with auto_complaints enabled/i,
      errorPattern: /ERROR|CRITICAL|Traceback/i,
      maxOkAgeMin: 90,
    });
  } else {
    addCheck(checks, "cron_reviews_sync", "Cron reviews-sync", "disabled", "Аккаунт отзывов не настроен");
    addCheck(checks, "cron_reviews_complaints", "Cron автожалобы", "disabled", "Аккаунт отзывов не настроен");
  }

  if (capabilities.fbo) {
    checkLogFreshness(checks, {
      id: "cron_paid_storage",
      name: "Cron paid-storage",
      logPath: path.join(DATA_DIR, "paid-storage-sync.log"),
      okPattern: /Done: \d+ ok, 0 failed/i,
      errorPattern: /Done:\s+\d+\s+ok,\s+[1-9]\d*\s+failed|\]\s+FAIL:|ERROR|CRITICAL|Traceback/i,
      maxOkAgeMin: 36 * 60,
    });
  } else {
    addCheck(checks, "cron_paid_storage", "Cron paid-storage", "disabled", "FBO не используется этим юрлицом");
    addCheck(checks, "cron_warehouse_remains", "Cron остатков FBO", "disabled", "FBO не используется этим юрлицом");
    addCheck(checks, "cron_warehouse_measurements", "Cron замеров FBO", "disabled", "FBO не используется этим юрлицом");
  }

  checkLogFreshness(checks, {
    id: "cron_auth_check",
    name: "Cron auth-check",
    logPath: path.join(DATA_DIR, "auth-check.log"),
    okPattern: /All channels ok/i,
    errorPattern: /ERROR|CRITICAL|Traceback|not ok|failed/i,
    maxOkAgeMin: 36 * 60,
  });
}

async function main() {
  const checks = [];

  await checkWbApi(checks);
  const capabilities = await getMonitorCapabilities();

  try {
    await checkPgData(checks, capabilities);
  } catch (err) {
    addCheck(checks, "runtime_db", "Runtime DB", "error", "Проверка упала", String(err));
  }

  checkCronLogs(checks, capabilities);

  const errors = checks.filter((c) => c.status === "error").length;
  const warns = checks.filter((c) => c.status === "warn").length;
  const overall = errors > 0 ? "error" : warns > 0 ? "warn" : "ok";
  const message = overall === "ok" ? "Данным можно доверять" : overall === "warn" ? "Есть предупреждения" : "Есть критические проблемы";

  console.log(JSON.stringify({ overall, message, checks, timestamp: new Date().toISOString() }, null, 2));
}

main()
  .catch((err) => {
    const payload = {
      overall: "error",
      message: "Проверка здоровья данных упала",
      checks: [{ id: "data_health_snapshot", name: "Data health snapshot", status: "error", value: "Script failed", detail: String(err) }],
      timestamp: new Date().toISOString(),
    };
    console.log(JSON.stringify(payload, null, 2));
    process.exitCode = 1;
  })
  .finally(async () => {
    if (pgPool) await pgPool.end().catch(() => {});
  });
