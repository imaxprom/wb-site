/**
 * Daily auto-sync: pulls yesterday's data from 3 sources every hour (06:00–23:00)
 * until all data is complete and stable.
 *
 * Sources:
 * 1. Realization report (seller-services API via authorizev3 + cookies)
 * 2. Advertising expenses (advert-api via WB API key)
 * 3. Orders (seller-analytics-api via WB API key)
 */
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

import { getWbApiKey } from "./wb-api-key";

const STATUS_PATH = path.join(process.cwd(), "data", "daily-sync-status.json");
const DB_PATH = path.join(process.cwd(), "data", "finance.db");
const TOKENS_PATH = path.join(process.cwd(), "data", "wb-tokens.json");

const CRON_START_HOUR = 6;
const CRON_END_HOUR = 23;

// --- Types ---

interface SourceStatus {
  ok: boolean;
  value: number;       // rows (report) or amount (ad/orders)
  stable: boolean;     // for orders: 2 consecutive identical values
  prevValue: number;   // previous value for stability check
  lastAttempt: string;
  error?: string;
}

interface DaySyncStatus {
  date: string;
  report: SourceStatus;
  advertising: SourceStatus;
  orders: SourceStatus;
  complete: boolean;   // all 3 ok and stable
}

export interface SyncStatus {
  today: DaySyncStatus | null;
  lastRun: string | null;
  nextRun: string | null;
  running: boolean;
  history: DaySyncStatus[];
}

// --- Status persistence ---

function loadStatus(): SyncStatus {
  try {
    if (fs.existsSync(STATUS_PATH)) {
      return JSON.parse(fs.readFileSync(STATUS_PATH, "utf-8"));
    }
  } catch { /* ignore */ }
  return { today: null, lastRun: null, nextRun: null, running: false, history: [] };
}

function saveStatus(status: SyncStatus): void {
  const dir = path.dirname(STATUS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATUS_PATH, JSON.stringify(status, null, 2));
}

export function getSyncStatus(): SyncStatus {
  return loadStatus();
}

function emptySource(): SourceStatus {
  return { ok: false, value: 0, stable: false, prevValue: 0, lastAttempt: "", error: undefined };
}

function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

// --- API key ---

function getApiKey(): string {
  return getWbApiKey() || "";
}

// --- Source 1: Realization report ---

async function syncReport(date: string): Promise<SourceStatus> {
  const s: SourceStatus = { ...emptySource(), lastAttempt: new Date().toISOString() };

  try {
    // Load seller tokens
    if (!fs.existsSync(TOKENS_PATH)) {
      s.error = "Нет токенов авторизации (authorizev3)";
      return s;
    }
    const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, "utf-8"));
    if (!tokens.authorizev3 || !tokens.cookies) {
      s.error = "Неполные токены авторизации";
      return s;
    }

    // Refresh wb-seller-lk
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
    if (!refreshRes.ok) { s.error = "Token refresh failed: " + refreshRes.status; return s; }
    const sellerLk = ((await refreshRes.json()) as { result?: { data?: { token?: string } } }).result?.data?.token;
    if (!sellerLk) { s.error = "Не удалось обновить wb-seller-lk"; return s; }

    const hdrs = {
      authorizev3: tokens.authorizev3,
      "wb-seller-lk": sellerLk,
      cookie: tokens.cookies,
      origin: "https://seller.wildberries.ru",
      referer: "https://seller.wildberries.ru/",
    };

    // Get list of daily reports
    const listRes = await fetch(
      "https://seller-services.wildberries.ru/ns/reports/seller-wb-balance/api/v1/reports?limit=10&skip=0&type=6",
      { headers: hdrs }
    );
    if (!listRes.ok) { s.error = "Ошибка списка отчётов: " + listRes.status; return s; }

    const listData = (await listRes.json()) as { data?: { reports?: { id: number; dateFrom: string; dateTo: string; type: number }[] } };
    const reports = listData?.data?.reports || [];

    // Find reports for target date (both Основной type=1 and По выкупам type=2)
    const dateReports = reports.filter(r => r.dateFrom?.slice(0, 10) === date);
    if (dateReports.length === 0) {
      s.error = `Отчёт за ${date} ещё не сформирован`;
      return s;
    }

    // Download and import each report
    const db = new Database(DB_PATH);
    let totalRows = 0;
    const XLSX = await import("xlsx");

    const reportsDir = path.join(process.cwd(), "data", "reports");
    const extractDir = path.join(reportsDir, "extracted");
    fs.mkdirSync(extractDir, { recursive: true });

    for (const report of dateReports) {
      // Check if already imported
      const existing = db.prepare("SELECT COUNT(*) as cnt FROM realization WHERE realizationreport_id = ?").get(report.id) as { cnt: number };
      if (existing.cnt > 0) {
        totalRows += existing.cnt;
        continue;
      }

      // Download
      const dlRes = await fetch(
        `https://seller-services.wildberries.ru/ns/reports/seller-wb-balance/api/v1/reports/${report.id}/details/archived-excel?format=binary`,
        { headers: hdrs }
      );
      if (!dlRes.ok) continue;

      const buf = Buffer.from(await dlRes.arrayBuffer());
      const zipPath = path.join(reportsDir, `report-${report.id}.zip`);
      fs.writeFileSync(zipPath, buf);

      // Extract ZIP using Node.js (AdmZip handles Cyrillic)
      try {
        const AdmZip = (await import("adm-zip")).default;
        const zip = new AdmZip(zipPath);
        const entries = zip.getEntries();
        for (const entry of entries) {
          if (entry.entryName.endsWith(".xlsx")) {
            fs.writeFileSync(path.join(extractDir, `report_${report.id}.xlsx`), entry.getData());
            break;
          }
        }
      } catch {
        // Fallback: try unzip command
        try {
          const { execSync } = await import("child_process");
          execSync(`cd "${extractDir}" && unzip -o "${zipPath}" 2>/dev/null || true`, { timeout: 30000 });
          // Rename whatever was extracted
          const files = fs.readdirSync(extractDir).filter(f => f.endsWith(".xlsx") && !f.startsWith("report_"));
          if (files.length > 0) {
            fs.renameSync(path.join(extractDir, files[0]), path.join(extractDir, `report_${report.id}.xlsx`));
          }
        } catch { continue; }
      }

      const xlsxPath = path.join(extractDir, `report_${report.id}.xlsx`);
      if (!fs.existsSync(xlsxPath)) continue;

      // Parse and import (use read+buffer instead of readFile for Turbopack compatibility)
      const xlsxBuffer = fs.readFileSync(xlsxPath);
      const wb = XLSX.read(xlsxBuffer, { type: "buffer" });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]) as Record<string, unknown>[];
      if (rows.length === 0) continue;

      const COL_MAP: Record<string, string> = {
        "Предмет": "subject_name", "Код номенклатуры": "nm_id", "Бренд": "brand_name",
        "Артикул поставщика": "sa_name", "Размер": "ts_name", "Баркод": "barcode",
        "Обоснование для оплаты": "supplier_oper_name", "Дата заказа покупателем": "order_dt",
        "Дата продажи": "sale_dt", "Кол-во": "quantity", "Цена розничная": "retail_price",
        "Цена розничная с учетом согласованной скидки": "retail_price_withdisc_rub",
        "Вайлдберриз реализовал Товар (Пр)": "retail_amount",
        "К перечислению Продавцу за реализованный Товар": "ppvz_for_pay",
        "Вознаграждение с продаж до вычета услуг поверенного, без НДС": "ppvz_sales_commission",
        "Эквайринг/Комиссии за организацию платежей": "acquiring_fee",
        "Услуги по доставке товара покупателю": "delivery_rub",
        "Количество доставок": "delivery_amount", "Количество возврата": "return_amount",
        "Хранение": "storage_fee", "Общая сумма штрафов": "penalty",
        "Операции на приемке": "acceptance",
        "Возмещение издержек по перевозке/по складским операциям с товаром": "rebill_logistic_cost",
        "Разовое изменение срока перечисления денежных средств": "additional_payment",
        "Итоговый кВВ без НДС, %": "ppvz_kvw_prc", "Размер кВВ без НДС, % Базовый": "ppvz_kvw_prc_base",
        "Скидка постоянного Покупателя (СПП), %": "ppvz_spp_prc", "Размер кВВ, %": "commission_percent",
        "Страна": "site_country", "Наименование офиса доставки": "office_name",
        "Удержания": "deduction", "Виды логистики, штрафов и корректировок ВВ": "bonus_type_name",
      };

      const xlsxHeaders = Object.keys(rows[0]);
      const mappedCols = Object.entries(COL_MAP).filter(([xlsx]) => xlsxHeaders.includes(xlsx));
      const insertCols = ["realizationreport_id", "date_from", "date_to", "rr_dt", ...mappedCols.map(([, db]) => db)];
      const placeholders = insertCols.map(() => "?").join(", ");
      const stmt = db.prepare(`INSERT INTO realization (${insertCols.join(", ")}) VALUES (${placeholders})`);

      const saleDates = rows.map(r => r["Дата продажи"]).filter(Boolean).sort() as string[];
      const dateFrom = saleDates[0] || date;
      const dateTo = saleDates[saleDates.length - 1] || date;

      db.transaction(() => {
        for (const row of rows) {
          const values: unknown[] = [report.id, dateFrom, dateTo, dateTo];
          for (const [xlsx] of mappedCols) {
            values.push(row[xlsx] ?? (typeof row[xlsx] === "number" ? 0 : ""));
          }
          stmt.run(...values);
        }
      })();

      totalRows += rows.length;

      // Cleanup temp files
      try { fs.unlinkSync(zipPath); } catch { /* ignore */ }
      try { fs.unlinkSync(xlsxPath); } catch { /* ignore */ }
    }

    db.close();

    s.ok = totalRows > 0;
    s.value = totalRows;
    s.stable = true;
    if (totalRows === 0) s.error = "Отчёты найдены, но 0 строк импортировано";
  } catch (err) {
    s.error = err instanceof Error ? err.message : String(err);
  }
  return s;
}

// --- Source 2: Advertising ---

async function syncAdvertising(date: string): Promise<SourceStatus> {
  const s: SourceStatus = { ...emptySource(), lastAttempt: new Date().toISOString() };
  const apiKey = getApiKey();
  if (!apiKey) { s.error = "Нет WB API ключа"; return s; }

  try {
    const res = await fetch(
      `https://advert-api.wildberries.ru/adv/v1/upd?from=${date}&to=${date}`,
      { headers: { Authorization: apiKey } }
    );
    if (!res.ok) { s.error = `API error: ${res.status}`; return s; }

    const data = (await res.json()) as { updSum?: number; campName?: string; advertId?: number; paymentType?: string; updTime?: string }[];

    const entries = data.filter(d => (d.updSum || 0) > 0);
    const total = entries.reduce((sum, d) => sum + (d.updSum || 0), 0);

    if (total === 0) {
      s.error = "Нет рекламных расходов за эту дату";
      return s;
    }

    // Save to DB
    const db = new Database(DB_PATH);
    db.prepare("DELETE FROM advertising WHERE date = ?").run(date);
    const ins = db.prepare("INSERT INTO advertising (date, campaign_name, campaign_id, amount, payment_type) VALUES (?, ?, ?, ?, ?)");
    db.transaction(() => {
      for (const e of entries) {
        ins.run(date, e.campName || "", e.advertId || 0, e.updSum || 0, e.paymentType || "Баланс");
      }
    })();
    db.close();

    s.ok = true;
    s.value = total;
    s.stable = true;
  } catch (err) {
    s.error = err instanceof Error ? err.message : String(err);
  }
  return s;
}

// --- Source 3: Orders ---

async function syncOrders(date: string, prevValue: number): Promise<SourceStatus> {
  const s: SourceStatus = { ...emptySource(), lastAttempt: new Date().toISOString() };
  const apiKey = getApiKey();
  if (!apiKey) { s.error = "Нет WB API ключа"; return s; }

  try {
    const res = await fetch(
      "https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/grouped/history",
      {
        method: "POST",
        headers: { Authorization: apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          brandNames: [], subjectIds: [], tagIds: [],
          selectedPeriod: { start: date, end: date },
          aggregationLevel: "day",
        }),
      }
    );
    if (!res.ok) { s.error = `API error: ${res.status}`; return s; }

    const data = (await res.json()) as { data?: { history?: { date: string; orderSum: number; orderCount: number; buyoutSum: number; buyoutCount: number }[] }[] };
    const day = data?.data?.[0]?.history?.find(h => h.date === date);

    if (!day || day.orderSum === 0) {
      s.error = "Нет данных о заказах за эту дату";
      return s;
    }

    // Save to DB
    const db = new Database(DB_PATH);
    db.prepare("INSERT OR REPLACE INTO orders_funnel (date, order_sum, order_count, buyout_sum, buyout_count) VALUES (?, ?, ?, ?, ?)")
      .run(date, day.orderSum, day.orderCount, day.buyoutSum || 0, day.buyoutCount || 0);
    db.close();

    s.ok = true;
    s.value = day.orderSum;
    s.prevValue = prevValue;
    // Stable if current value matches previous non-zero value
    s.stable = prevValue > 0 && day.orderSum === prevValue;
  } catch (err) {
    s.error = err instanceof Error ? err.message : String(err);
  }
  return s;
}

// --- Main sync ---

export async function syncAll(date?: string): Promise<DaySyncStatus> {
  const targetDate = date || yesterday();
  const status = loadStatus();

  // Load existing day status or create new
  let day = status.today;
  if (!day || day.date !== targetDate) {
    day = {
      date: targetDate,
      report: emptySource(),
      advertising: emptySource(),
      orders: emptySource(),
      complete: false,
    };
  }

  status.running = true;
  status.lastRun = new Date().toISOString();
  saveStatus(status);

  console.log(`[daily-sync] Syncing ${targetDate}...`);

  // Sync each source (skip if already ok+stable)
  if (!day.report.ok) {
    console.log("[daily-sync] Syncing report...");
    day.report = await syncReport(targetDate);
    console.log(`[daily-sync] Report: ${day.report.ok ? "OK (" + day.report.value + " rows)" : "FAIL: " + day.report.error}`);
  }

  if (!day.advertising.ok) {
    console.log("[daily-sync] Syncing advertising...");
    day.advertising = await syncAdvertising(targetDate);
    console.log(`[daily-sync] Advertising: ${day.advertising.ok ? "OK (" + day.advertising.value + " руб)" : "FAIL: " + day.advertising.error}`);
  }

  if (!day.orders.ok || !day.orders.stable) {
    console.log("[daily-sync] Syncing orders...");
    day.orders = await syncOrders(targetDate, day.orders.value);
    console.log(`[daily-sync] Orders: ${day.orders.ok ? day.orders.value + " руб" + (day.orders.stable ? " (stable)" : " (updating)") : "FAIL: " + day.orders.error}`);
  }

  day.complete = day.report.ok && day.advertising.ok && day.orders.ok && day.orders.stable;

  status.today = day;
  status.running = false;

  // Archive to history when complete or date changes
  const existingIdx = status.history.findIndex(h => h.date === targetDate);
  if (existingIdx >= 0) {
    status.history[existingIdx] = day;
  } else {
    status.history.unshift(day);
    if (status.history.length > 30) status.history = status.history.slice(0, 30);
  }

  saveStatus(status);
  return day;
}

export async function syncDailyReport(date: string) {
  const day = await syncAll(date);
  return {
    date: day.date,
    timestamp: new Date().toISOString(),
    rows: day.report.value,
    ok: day.report.ok,
    error: day.report.error,
  };
}

export async function syncYesterday() {
  return syncDailyReport(yesterday());
}

// --- Cron ---

let cronTimer: ReturnType<typeof setInterval> | null = null;

export function startDailyCron(): void {
  if (cronTimer) return;

  async function tick() {
    const hour = new Date().getHours();
    if (hour < CRON_START_HOUR || hour > CRON_END_HOUR) return;

    const status = loadStatus();
    const targetDate = yesterday();

    // Skip if today's sync is fully complete
    if (status.today?.date === targetDate && status.today.complete) {
      console.log(`[daily-sync] ${targetDate} already complete, skipping`);
      return;
    }

    await syncAll(targetDate);
  }

  // Calculate ms until next hour boundary
  const now = new Date();
  const msToNextHour = (60 - now.getMinutes()) * 60000 - now.getSeconds() * 1000;

  // First run: at next hour boundary
  setTimeout(() => {
    tick();
    // Then every hour
    cronTimer = setInterval(tick, 3600000);
  }, msToNextHour);

  const nextRun = new Date(Date.now() + msToNextHour).toISOString();
  const status = loadStatus();
  status.nextRun = nextRun;
  saveStatus(status);

  console.log(`[daily-sync] Cron started. Next run at ${nextRun} (every hour ${CRON_START_HOUR}:00–${CRON_END_HOUR}:00)`);
}

export function stopDailyCron(): void {
  if (cronTimer) { clearInterval(cronTimer); cronTimer = null; }
}

export function getImportLog() {
  const status = loadStatus();
  return status.history;
}
