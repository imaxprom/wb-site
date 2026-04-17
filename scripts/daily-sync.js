#!/usr/bin/env node
/**
 * Standalone daily sync script — runs independently of Next.js.
 * Called by macOS launchd every hour (06:00–23:00).
 *
 * Pulls 3 data sources for yesterday into SQLite:
 * 1. Realization report (seller-services API)
 * 2. Advertising expenses (advert-api)
 * 3. Orders (seller-analytics-api)
 */

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const PROJECT_DIR = path.join(__dirname, "..");
const DB_PATH = path.join(PROJECT_DIR, "data", "finance.db");
const STATUS_PATH = path.join(PROJECT_DIR, "data", "daily-sync-status.json");
const TOKENS_PATH = path.join(PROJECT_DIR, "data", "wb-tokens.json");
const API_KEY_PATH = path.join(PROJECT_DIR, "data", "wb-api-key.txt");
const REPORTS_DIR = path.join(PROJECT_DIR, "data", "reports");
const EXTRACT_DIR = path.join(REPORTS_DIR, "extracted");

const LOG_PATH = path.join(PROJECT_DIR, "data", "daily-sync.log");

// --- Logging ---

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_PATH, line + "\n");
  } catch { /* ignore */ }
}

// --- Helpers ---

function yesterday() {
  // Use Moscow timezone (UTC+3) to determine "yesterday"
  const now = new Date();
  const msk = new Date(now.getTime() + 3 * 60 * 60 * 1000); // UTC+3
  msk.setDate(msk.getDate() - 1);
  return msk.toISOString().slice(0, 10);
}

function getApiKey() {
  try {
    if (fs.existsSync(API_KEY_PATH)) return fs.readFileSync(API_KEY_PATH, "utf-8").trim();
  } catch { /* ignore */ }
  return "";
}

function ensureDirs() {
  for (const d of [path.join(PROJECT_DIR, "data"), REPORTS_DIR, EXTRACT_DIR]) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  }
}

function loadStatus() {
  try {
    if (fs.existsSync(STATUS_PATH)) return JSON.parse(fs.readFileSync(STATUS_PATH, "utf-8"));
  } catch { /* ignore */ }
  return { today: null, lastRun: null, nextRun: null, running: false, history: [] };
}

function saveStatus(status) {
  fs.writeFileSync(STATUS_PATH, JSON.stringify(status, null, 2));
}

// --- Source 1: Realization report ---

const COL_MAP = {
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

async function syncReport(date) {
  const result = { ok: false, value: 0, stable: true, prevValue: 0, lastAttempt: new Date().toISOString(), error: undefined };

  try {
    if (!fs.existsSync(TOKENS_PATH)) { result.error = "Нет токенов (authorizev3)"; return result; }
    const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, "utf-8"));
    if (!tokens.authorizev3 || !tokens.cookies) { result.error = "Неполные токены"; return result; }

    // Check supplier mismatch
    if (fs.existsSync(API_KEY_PATH)) {
      try {
        const apiKey = fs.readFileSync(API_KEY_PATH, "utf-8").trim();
        const apiPayload = JSON.parse(Buffer.from(apiKey.split(".")[1], "base64").toString());
        const apiOid = String(apiPayload.oid || "");
        const tokenSid = String(tokens.supplierId || "");
        if (apiOid && tokenSid && apiOid !== tokenSid) {
          result.error = `Несовпадение юрлиц! API-ключ: ${apiOid}, токен авторизации: ${tokenSid}. Переавторизуйтесь с правильным номером.`;
          log(`  ⚠️ SUPPLIER MISMATCH: API=${apiOid} vs Token=${tokenSid}`);
          return result;
        }
      } catch {}
    }

    // Refresh wb-seller-lk
    const refreshRes = await fetch("https://seller.wildberries.ru/ns/suppliers-auth/suppliers-portal-core/auth/token", {
      method: "POST",
      headers: { "content-type": "application/json", authorizev3: tokens.authorizev3, cookie: tokens.cookies, origin: "https://seller.wildberries.ru", referer: "https://seller.wildberries.ru/" },
      body: JSON.stringify({ params: {}, jsonrpc: "2.0", id: "json-rpc_1" }),
    });
    if (!refreshRes.ok) { result.error = "Token refresh: " + refreshRes.status; return result; }
    const sellerLk = (await refreshRes.json()).result?.data?.token;
    if (!sellerLk) { result.error = "Нет wb-seller-lk"; return result; }

    const hdrs = { authorizev3: tokens.authorizev3, "wb-seller-lk": sellerLk, cookie: tokens.cookies, origin: "https://seller.wildberries.ru", referer: "https://seller.wildberries.ru/" };

    // Get daily reports list
    const listRes = await fetch("https://seller-services.wildberries.ru/ns/reports/seller-wb-balance/api/v1/reports?limit=10&skip=0&type=6", { headers: hdrs });
    if (!listRes.ok) { result.error = "Список отчётов: " + listRes.status; return result; }
    const reports = (await listRes.json()).data?.reports || [];
    const dateReports = reports.filter(r => r.dateFrom?.slice(0, 10) === date);
    if (dateReports.length === 0) { result.error = `Отчёт за ${date} ещё не сформирован`; return result; }

    const db = new Database(DB_PATH);
    const XLSX = require("xlsx");
    const AdmZip = require("adm-zip");
    let totalRows = 0;

    for (const report of dateReports) {
      // Skip if already imported
      const existing = db.prepare("SELECT COUNT(*) as cnt FROM realization WHERE realizationreport_id = ?").get(report.id);
      if (existing.cnt > 0) { totalRows += existing.cnt; continue; }

      // Download
      const dlRes = await fetch(`https://seller-services.wildberries.ru/ns/reports/seller-wb-balance/api/v1/reports/${report.id}/details/archived-excel?format=binary`, { headers: hdrs });
      if (!dlRes.ok) { log(`Download ${report.id}: ${dlRes.status}`); continue; }

      const buf = Buffer.from(await dlRes.arrayBuffer());
      const zipPath = path.join(REPORTS_DIR, `report-${report.id}.zip`);
      fs.writeFileSync(zipPath, buf);

      // Extract
      const xlsxPath = path.join(EXTRACT_DIR, `report_${report.id}.xlsx`);
      try {
        const zip = new AdmZip(zipPath);
        for (const entry of zip.getEntries()) {
          if (entry.entryName.endsWith(".xlsx")) { fs.writeFileSync(xlsxPath, entry.getData()); break; }
        }
      } catch (e) { log(`Extract ${report.id}: ${e.message}`); continue; }
      if (!fs.existsSync(xlsxPath)) continue;

      // Parse
      const xlsxBuffer = fs.readFileSync(xlsxPath);
      const wb = XLSX.read(xlsxBuffer, { type: "buffer" });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
      if (rows.length === 0) continue;

      // Import
      const xlsxHeaders = Object.keys(rows[0]);
      const mappedCols = Object.entries(COL_MAP).filter(([xlsx]) => xlsxHeaders.includes(xlsx));
      const insertCols = ["realizationreport_id", "date_from", "date_to", "rr_dt", ...mappedCols.map(([, db]) => db)];
      const stmt = db.prepare(`INSERT INTO realization (${insertCols.join(", ")}) VALUES (${insertCols.map(() => "?").join(", ")})`);

      const saleDates = rows.map(r => r["Дата продажи"]).filter(Boolean).sort();
      const dateFrom = saleDates[0] || date;
      const dateTo = saleDates[saleDates.length - 1] || date;

      db.transaction(() => {
        for (const row of rows) {
          const values = [report.id, dateFrom, dateTo, dateTo];
          for (const [xlsx] of mappedCols) values.push(row[xlsx] ?? "");
          stmt.run(...values);
        }
      })();

      totalRows += rows.length;
      try { fs.unlinkSync(zipPath); } catch {}
      try { fs.unlinkSync(xlsxPath); } catch {}
    }

    db.close();
    const MIN_ROWS = 500;
    result.ok = totalRows >= MIN_ROWS;
    result.value = totalRows;
    result.stable = totalRows >= MIN_ROWS;
    if (totalRows === 0) result.error = "0 строк";
    else if (totalRows < MIN_ROWS) {
      result.error = `Отчёт неполный: ${totalRows} строк (ожидается ${MIN_ROWS}+). WB ещё не сформировал.`;
      log(`  ⚠️ Report incomplete: ${totalRows} rows < ${MIN_ROWS}`);
    }
  } catch (err) {
    result.error = err.message || String(err);
  }
  return result;
}

// --- Source 2: Advertising ---

/** Персистентный кеш campaign_id → nm_id в БД. Нужен, чтобы для архивных
 * кампаний, которые уже не возвращаются из /adverts, всё равно был маппинг. */
function ensureCampaignNmTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS campaign_nm_map (
      campaign_id INTEGER PRIMARY KEY,
      nm_id INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

async function fetchCampaignNmMap(apiKey) {
  const map = new Map();
  try {
    const res = await fetch("https://advert-api.wildberries.ru/api/advert/v2/adverts", {
      headers: { Authorization: apiKey },
    });
    if (!res.ok) return map;
    const data = await res.json();
    for (const c of data.adverts || []) {
      if (c.nm_settings?.length) {
        map.set(c.id, c.nm_settings[0].nm_id);
      }
    }
  } catch { /* не критично — упадём на кеш */ }
  return map;
}

async function syncAdvertising(date) {
  const result = { ok: false, value: 0, stable: false, prevValue: 0, lastAttempt: new Date().toISOString(), error: undefined };
  const apiKey = getApiKey();
  if (!apiKey) { result.error = "Нет WB API ключа"; return result; }

  try {
    const [updRes, freshNmMap] = await Promise.all([
      fetch(`https://advert-api.wildberries.ru/adv/v1/upd?from=${date}&to=${date}`, {
        headers: { Authorization: apiKey },
      }),
      fetchCampaignNmMap(apiKey),
    ]);
    if (!updRes.ok) { result.error = `API: ${updRes.status}`; return result; }

    const data = await updRes.json();
    const entries = data.filter(d => (d.updSum || 0) > 0);
    const total = entries.reduce((s, d) => s + (d.updSum || 0), 0);
    if (total === 0) { result.error = "Нет расходов"; return result; }

    const db = new Database(DB_PATH);
    ensureCampaignNmTable(db);

    // Обновляем персистентный кеш свежими маппингами (upsert)
    const upsertMap = db.prepare(`
      INSERT INTO campaign_nm_map (campaign_id, nm_id, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(campaign_id) DO UPDATE SET nm_id=excluded.nm_id, updated_at=excluded.updated_at
    `);
    const now = new Date().toISOString();
    db.transaction(() => {
      for (const [cid, nm] of freshNmMap) upsertMap.run(cid, nm, now);
    })();

    // Читаем кеш (в т.ч. архивные кампании из прошлых синков)
    const cachedRows = db.prepare("SELECT campaign_id, nm_id FROM campaign_nm_map").all();
    const cachedNmMap = new Map(cachedRows.map(r => [r.campaign_id, r.nm_id]));

    const resolveNm = (advertId) => freshNmMap.get(advertId) || cachedNmMap.get(advertId) || 0;

    db.prepare("DELETE FROM advertising WHERE date = ?").run(date);
    const ins = db.prepare("INSERT INTO advertising (date, campaign_name, campaign_id, amount, payment_type, nm_id) VALUES (?, ?, ?, ?, ?, ?)");
    db.transaction(() => {
      for (const e of entries) {
        ins.run(date, e.campName || "", e.advertId || 0, e.updSum || 0, e.paymentType || "Баланс", resolveNm(e.advertId || 0));
      }
    })();
    db.close();

    result.ok = true;
    result.value = total;
    // stable=true только если хотя бы половина расходов замаппилась.
    // Иначе sync повторится на следующем часу и попробует добрать маппинг.
    const mappedSum = entries.reduce((s, e) => s + (resolveNm(e.advertId || 0) ? (e.updSum || 0) : 0), 0);
    const mappedRatio = total > 0 ? mappedSum / total : 0;
    result.stable = mappedRatio >= 0.5;
    if (!result.stable) {
      result.error = `Маппинг nm_id: ${(mappedRatio * 100).toFixed(0)}% — повторю на следующем часу`;
    }
  } catch (err) {
    result.error = err.message || String(err);
  }
  return result;
}

// --- Source 3: Orders ---

async function syncOrders(date, prevValue) {
  const result = { ok: false, value: 0, stable: false, prevValue: prevValue || 0, lastAttempt: new Date().toISOString(), error: undefined };
  const apiKey = getApiKey();
  if (!apiKey) { result.error = "Нет WB API ключа"; return result; }

  try {
    const res = await fetch("https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/grouped/history", {
      method: "POST",
      headers: { Authorization: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({ brandNames: [], subjectIds: [], tagIds: [], selectedPeriod: { start: date, end: date }, aggregationLevel: "day" }),
    });
    if (!res.ok) { result.error = `API: ${res.status}`; return result; }

    const data = await res.json();
    const day = data?.data?.[0]?.history?.find(h => h.date === date);
    if (!day || day.orderSum === 0) { result.error = "Нет заказов"; return result; }

    const db = new Database(DB_PATH);
    db.prepare("INSERT OR REPLACE INTO orders_funnel (date, order_sum, order_count, buyout_sum, buyout_count) VALUES (?, ?, ?, ?, ?)")
      .run(date, day.orderSum, day.orderCount, day.buyoutSum || 0, day.buyoutCount || 0);
    db.close();

    result.ok = true;
    result.value = day.orderSum;
    result.stable = prevValue > 0 && day.orderSum === prevValue;
  } catch (err) {
    result.error = err.message || String(err);
  }
  return result;
}

// --- Source 4: Weekly realization report (final, via API key) ---

async function syncWeeklyReport() {
  const apiKey = getApiKey();
  if (!apiKey) { log("  Weekly: нет API ключа, пропуск"); return; }

  // Determine last Monday-Sunday period
  const now = new Date();
  const msk = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  const dayOfWeek = msk.getDay(); // 0=Sun, 1=Mon
  // Last Monday = today - (dayOfWeek === 0 ? 6 : dayOfWeek - 1) - 7
  const daysToLastMonday = (dayOfWeek === 0 ? 6 : dayOfWeek - 1) + 7;
  const lastMonday = new Date(msk);
  lastMonday.setDate(msk.getDate() - daysToLastMonday);
  const lastSunday = new Date(lastMonday);
  lastSunday.setDate(lastMonday.getDate() + 6);

  const fmtDate = (d) => d.toISOString().slice(0, 10);
  const dateFrom = fmtDate(lastMonday);
  const dateTo = fmtDate(lastSunday);

  // Check if already loaded for this period
  const db = new Database(DB_PATH);
  const existing = db.prepare(
    "SELECT COUNT(*) as cnt FROM realization WHERE source = 'weekly_final' AND sale_dt >= ? AND sale_dt <= ?"
  ).get(dateFrom, dateTo);
  if (existing.cnt > 0) {
    log(`  Weekly ${dateFrom}—${dateTo}: already loaded (${existing.cnt} rows), skipping`);
    db.close();
    return;
  }

  log(`  Weekly report ${dateFrom} — ${dateTo}...`);

  try {
    // Fetch from WB API (may need multiple pages via rrdid)
    let allRows = [];
    let rrdid = 0;
    let page = 0;

    while (true) {
      page++;
      const url = `https://statistics-api.wildberries.ru/api/v5/supplier/reportDetailByPeriod?dateFrom=${dateFrom}&dateTo=${dateTo}&rrdid=${rrdid}&limit=100000`;
      const res = await fetch(url, { headers: { Authorization: apiKey } });
      if (!res.ok) {
        log(`  Weekly API error: ${res.status}`);
        break;
      }
      const data = await res.json();
      if (!data || data.length === 0) break;
      allRows = allRows.concat(data);
      rrdid = data[data.length - 1].rrd_id || 0;
      log(`  Page ${page}: +${data.length} rows (total: ${allRows.length})`);
      if (data.length < 100000) break;
    }

    if (allRows.length === 0) {
      log(`  Weekly: отчёт за ${dateFrom}—${dateTo} пуст или ещё не готов`);
      db.close();
      return;
    }

    // НЕ удаляем daily — оставляем для сверки на вкладке «Сверка»
    // daily данные нужны как третий столбец: "7 дней ежедневный"
    const dailyCount = db.prepare(
      "SELECT COUNT(*) as cnt FROM realization WHERE source = 'daily' AND sale_dt >= ? AND sale_dt <= ?"
    ).get(dateFrom, dateTo);
    if (dailyCount.cnt > 0) {
      log(`  Daily за ${dateFrom}—${dateTo}: ${dailyCount.cnt} записей сохранены для сверки`);
    }

    // Insert final rows (38 columns, matching realization table minus auto-id)
    const cols = [
      "rrd_id", "realizationreport_id", "date_from", "date_to", "rr_dt", "sale_dt", "order_dt",
      "supplier_oper_name", "nm_id", "sa_name", "ts_name", "barcode", "brand_name", "subject_name",
      "quantity", "retail_price", "retail_price_withdisc_rub", "retail_amount",
      "ppvz_for_pay", "ppvz_sales_commission", "acquiring_fee", "delivery_rub",
      "delivery_amount", "return_amount", "storage_fee", "penalty", "acceptance",
      "rebill_logistic_cost", "additional_payment", "commission_percent",
      "ppvz_spp_prc", "ppvz_kvw_prc_base", "ppvz_kvw_prc", "ppvz_supplier_name",
      "site_country", "office_name", "deduction", "bonus_type_name", "source"
    ];
    const insertStmt = db.prepare(`INSERT INTO realization (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`);

    const tx = db.transaction(() => {
      for (const r of allRows) {
        insertStmt.run(
          r.rrd_id || 0, r.realizationreport_id || 0,
          r.date_from || "", r.date_to || "",
          (r.rr_dt || "").slice(0, 10), (r.sale_dt || "").slice(0, 10), (r.order_dt || "").slice(0, 10),
          r.supplier_oper_name || "", r.nm_id || 0, r.sa_name || "", r.ts_name || "", r.barcode || "",
          r.brand_name || "", r.subject_name || "",
          r.quantity || 0, r.retail_price || 0, r.retail_price_withdisc_rub || 0, r.retail_amount || 0,
          r.ppvz_for_pay || 0, r.ppvz_sales_commission || 0, r.acquiring_fee || 0, r.delivery_rub || 0,
          r.delivery_amount || 0, r.return_amount || 0, r.storage_fee || 0, r.penalty || 0, r.acceptance || 0,
          r.rebill_logistic_cost || 0, r.additional_payment || 0, r.commission_percent || 0,
          r.ppvz_spp_prc || 0, r.ppvz_kvw_prc_base || 0, r.ppvz_kvw_prc || 0,
          r.ppvz_supplier_name || "", r.site_country || "", r.office_name || "",
          r.deduction || 0, r.bonus_type_name || "",
          "weekly_final"
        );
      }
    });
    tx();

    log(`  Weekly: загружено ${allRows.length} строк за ${dateFrom}—${dateTo}`);
    db.close();
  } catch (err) {
    log(`  Weekly error: ${err.message}`);
    db.close();
  }
}

// --- Main ---

async function main() {
  const hour = new Date().getHours();
  if (hour < 6 || hour > 23) {
    log("Outside working hours (6-23), skipping");
    process.exit(0);
  }

  ensureDirs();
  const date = yesterday();
  const status = loadStatus();

  // Load or create day status
  let day = status.today;
  if (!day || day.date !== date) {
    day = {
      date,
      report: { ok: false, value: 0, stable: false, prevValue: 0, lastAttempt: "" },
      advertising: { ok: false, value: 0, stable: false, prevValue: 0, lastAttempt: "" },
      orders: { ok: false, value: 0, stable: false, prevValue: 0, lastAttempt: "" },
      complete: false,
    };
  }

  // Always check weekly report (even if daily is complete)
  log("  Weekly report check...");
  await syncWeeklyReport();

  // Skip daily if already complete
  if (day.complete) {
    log(`${date}: already complete, skipping`);
    process.exit(0);
  }

  log(`Syncing ${date}...`);

  if (!day.report.ok) {
    log("  Report...");
    day.report = await syncReport(date);
    log(`  Report: ${day.report.ok ? day.report.value + " rows" : "FAIL: " + day.report.error}`);
  }

  if (!day.advertising.ok || !day.advertising.stable) {
    log("  Advertising...");
    day.advertising = await syncAdvertising(date);
    log(`  Advertising: ${day.advertising.ok ? day.advertising.value + " руб" + (day.advertising.stable ? " (stable)" : " (unmapped)") : "FAIL: " + day.advertising.error}`);
  }

  if (!day.orders.ok || !day.orders.stable) {
    log("  Orders...");
    day.orders = await syncOrders(date, day.orders.value);
    log(`  Orders: ${day.orders.ok ? day.orders.value + " руб" + (day.orders.stable ? " (stable)" : "") : "FAIL: " + day.orders.error}`);
  }

  day.complete = day.report.ok && day.advertising.ok && day.advertising.stable && day.orders.ok && day.orders.stable;
  log(`  Complete: ${day.complete}`);

  status.today = day;
  status.lastRun = new Date().toISOString();

  const existingIdx = status.history.findIndex(h => h.date === date);
  if (existingIdx >= 0) status.history[existingIdx] = day;
  else { status.history.unshift(day); if (status.history.length > 30) status.history = status.history.slice(0, 30); }

  saveStatus(status);
  log("Done.");
}

main().catch(err => {
  log("FATAL: " + err.message);
  process.exit(1);
});
