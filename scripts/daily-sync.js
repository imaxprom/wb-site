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

// --- State persistence (4 слоя защиты) ---

function validateStatus(s) {
  if (!s || typeof s !== "object") return false;
  if (!Array.isArray(s.history)) return false;
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const todayIso = new Date().toISOString().slice(0, 10);
  if (s.today) {
    if (typeof s.today !== "object") return false;
    const d = s.today.date;
    if (!d || !dateRe.test(d)) return false;
    if (d > todayIso) return false; // нет будущих дат
  }
  for (const h of s.history) {
    if (!h || !h.date || !dateRe.test(h.date)) return false;
  }
  return true;
}

function buildEmptySource() {
  return { ok: false, value: 0, stable: false, prevValue: 0, lastAttempt: "" };
}

/** Слой 3 fallback: восстановление state из фактических данных БД. */
function restoreStatusFromDb() {
  try {
    if (!fs.existsSync(DB_PATH)) return null;
    const db = new Database(DB_PATH, { readonly: true });
    const yd = yesterday();

    const ordRow = db.prepare("SELECT order_sum, order_count, buyout_sum, buyout_count FROM orders_funnel WHERE date = ?").get(yd);
    const adRow = db.prepare("SELECT COUNT(*) as cnt, COALESCE(SUM(amount), 0) as sum FROM advertising WHERE date = ?").get(yd);
    const repRow = db.prepare("SELECT COUNT(*) as cnt FROM realization WHERE date_from = ?").get(yd);

    const today = {
      date: yd,
      report: { ...buildEmptySource(), ok: (repRow?.cnt || 0) > 0, value: repRow?.cnt || 0, stable: (repRow?.cnt || 0) > 0 },
      advertising: { ...buildEmptySource(), ok: (adRow?.sum || 0) > 0, value: adRow?.sum || 0, stable: (adRow?.sum || 0) > 0 },
      orders: { ...buildEmptySource(), ok: (ordRow?.order_sum || 0) > 0, value: ordRow?.order_sum || 0, stable: (ordRow?.order_sum || 0) > 0, prevValue: ordRow?.order_sum || 0 },
      complete: false,
    };
    today.complete = today.report.ok && today.advertising.ok && today.advertising.stable && today.orders.ok && today.orders.stable;

    // История: 30 дней из orders_funnel
    const histDates = db.prepare(`
      SELECT date FROM orders_funnel
      WHERE date >= date('now', '-30 days')
      ORDER BY date DESC
      LIMIT 30
    `).all();

    const history = histDates.map((r) => {
      const d = r.date;
      const o = db.prepare("SELECT order_sum FROM orders_funnel WHERE date = ?").get(d);
      const a = db.prepare("SELECT COALESCE(SUM(amount), 0) as s FROM advertising WHERE date = ?").get(d);
      const rr = db.prepare("SELECT COUNT(*) as c FROM realization WHERE date_from = ?").get(d);
      return {
        date: d,
        report: { ...buildEmptySource(), ok: (rr?.c || 0) > 0, value: rr?.c || 0, stable: true },
        advertising: { ...buildEmptySource(), ok: (a?.s || 0) > 0, value: a?.s || 0, stable: true },
        orders: { ...buildEmptySource(), ok: (o?.order_sum || 0) > 0, value: o?.order_sum || 0, stable: true },
        complete: true, // прошедшие дни считаем финальными
      };
    });

    db.close();
    return { today, lastRun: null, nextRun: null, running: false, history };
  } catch (err) {
    log(`restoreStatusFromDb error: ${err.message || err}`);
    return null;
  }
}

function loadStatus() {
  const emptyStatus = { today: null, lastRun: null, nextRun: null, running: false, history: [] };

  // Слой 3: пробуем основной файл
  if (fs.existsSync(STATUS_PATH)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(STATUS_PATH, "utf-8"));
      if (validateStatus(parsed)) return parsed;
      log("state.json не прошёл валидацию, пробую .bak");
    } catch (e) {
      log(`state.json битый (${e.message || e}), пробую .bak`);
    }
  }

  // Слой 1: пробуем бэкап
  const bakPath = STATUS_PATH + ".bak";
  if (fs.existsSync(bakPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(bakPath, "utf-8"));
      if (validateStatus(parsed)) {
        log("state восстановлен из .bak");
        return parsed;
      }
    } catch (e) {
      log(`.bak тоже битый (${e.message || e})`);
    }
  }

  // Слой 3: последний шанс — восстановление из БД
  log("state файлов нет/битые — восстанавливаю из БД");
  const restored = restoreStatusFromDb();
  if (restored && validateStatus(restored)) {
    log("state построен из БД");
    return restored;
  }

  // Полный fail — пустое состояние, sync начнёт с нуля
  log("DB-restore не удалось, стартую с пустого state");
  return emptyStatus;
}

function saveStatus(status) {
  // Слой 1: бэкап текущего файла
  if (fs.existsSync(STATUS_PATH)) {
    try { fs.copyFileSync(STATUS_PATH, STATUS_PATH + ".bak"); } catch { /* не критично */ }
  }
  // Слой 2: атомарная запись — tmp → rename
  const tmpPath = STATUS_PATH + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(status, null, 2));
  fs.renameSync(tmpPath, STATUS_PATH);
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
    // Метатаблица для dedup по createDate: если WB пересгенерил отчёт с тем же id,
    // createDate обновляется → мы перезагружаем; если не менялось — skip.
    db.exec(`
      CREATE TABLE IF NOT EXISTS realization_report_meta (
        report_id INTEGER PRIMARY KEY,
        create_date TEXT,
        details_count INTEGER,
        imported_at TEXT NOT NULL
      )
    `);
    const XLSX = require("xlsx");
    const AdmZip = require("adm-zip");
    let totalRows = 0;

    for (const report of dateReports) {
      // Dedup: сравниваем createDate и detailsCount из списка /reports с meta в БД.
      const existingMeta = db.prepare("SELECT create_date, details_count FROM realization_report_meta WHERE report_id = ?").get(report.id);
      const existingRows = db.prepare("SELECT COUNT(*) as cnt FROM realization WHERE realizationreport_id = ?").get(report.id);

      // Если есть meta и createDate совпадает — отчёт не менялся, skip.
      if (existingMeta
        && existingMeta.create_date === report.createDate
        && existingRows.cnt > 0) {
        totalRows += existingRows.cnt;
        continue;
      }

      // Если meta нет, но строки есть (legacy — отчёт импортирован до Блока 5),
      // записываем meta без повторного скачивания (первый sync после деплоя).
      if (!existingMeta && existingRows.cnt > 0) {
        db.prepare("INSERT INTO realization_report_meta (report_id, create_date, details_count, imported_at) VALUES (?, ?, ?, ?)")
          .run(report.id, report.createDate || "", report.detailsCount || existingRows.cnt, new Date().toISOString());
        totalRows += existingRows.cnt;
        continue;
      }

      // Отчёт регенерирован (createDate отличается) — удаляем старые строки перед re-import
      if (existingRows.cnt > 0) {
        log(`  Report ${report.id} regenerated (${existingMeta?.create_date} → ${report.createDate}), re-importing`);
        db.prepare("DELETE FROM realization WHERE realizationreport_id = ?").run(report.id);
      }

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

      // Upsert meta с текущим createDate
      db.prepare(`
        INSERT INTO realization_report_meta (report_id, create_date, details_count, imported_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(report_id) DO UPDATE SET
          create_date = excluded.create_date,
          details_count = excluded.details_count,
          imported_at = excluded.imported_at
      `).run(report.id, report.createDate || "", report.detailsCount || rows.length, new Date().toISOString());

      totalRows += rows.length;
      try { fs.unlinkSync(zipPath); } catch {}
      try { fs.unlinkSync(xlsxPath); } catch {}
    }

    db.close();
    // Доверяем WB: если отчёт попал в список /reports — он финальный.
    // totalRows — это то, что импортировали. Не ставим магический минимум.
    result.ok = totalRows > 0;
    result.value = totalRows;
    result.stable = totalRows > 0;
    if (totalRows === 0) result.error = "Отчёты найдены в списке, но 0 строк импортировано";
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
    if (!res.ok) return { ok: false, map };
    const data = await res.json();
    for (const c of data.adverts || []) {
      if (c.nm_settings?.length) {
        map.set(c.id, c.nm_settings[0].nm_id);
      }
    }
    return { ok: true, map };
  } catch { return { ok: false, map }; }
}

async function syncAdvertising(date, prevValue) {
  const result = { ok: false, value: 0, stable: false, prevValue: prevValue || 0, lastAttempt: new Date().toISOString(), error: undefined };
  const apiKey = getApiKey();
  if (!apiKey) { result.error = "Нет WB API ключа"; return result; }

  try {
    const [updRes, adverts] = await Promise.all([
      fetch(`https://advert-api.wildberries.ru/adv/v1/upd?from=${date}&to=${date}`, {
        headers: { Authorization: apiKey },
      }),
      fetchCampaignNmMap(apiKey),
    ]);
    if (!updRes.ok) { result.error = `API: ${updRes.status}`; return result; }

    const data = await updRes.json();
    const entries = data.filter(d => (d.updSum || 0) > 0);
    const total = entries.reduce((s, d) => s + (d.updSum || 0), 0);
    if (total === 0) { result.error = "Нет расходов"; result.stable = adverts.ok; return result; }

    const db = new Database(DB_PATH);
    ensureCampaignNmTable(db);

    // Обновляем персистентный кеш свежими маппингами (upsert)
    const upsertMap = db.prepare(`
      INSERT INTO campaign_nm_map (campaign_id, nm_id, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(campaign_id) DO UPDATE SET nm_id=excluded.nm_id, updated_at=excluded.updated_at
    `);
    const now = new Date().toISOString();
    db.transaction(() => {
      for (const [cid, nm] of adverts.map) upsertMap.run(cid, nm, now);
    })();

    // Читаем кеш (в т.ч. архивные кампании из прошлых синков)
    const cachedRows = db.prepare("SELECT campaign_id, nm_id FROM campaign_nm_map").all();
    const cachedNmMap = new Map(cachedRows.map(r => [r.campaign_id, r.nm_id]));

    const resolveNm = (advertId) => adverts.map.get(advertId) || cachedNmMap.get(advertId) || 0;

    // Idempotency: сравниваем текущие данные в БД со свежими от WB.
    // Если суммы и кол-во записей совпадают — DELETE+INSERT не делаем.
    const existingStats = db.prepare(
      "SELECT COUNT(*) as cnt, COALESCE(SUM(amount), 0) as sum FROM advertising WHERE date = ?"
    ).get(date);
    const unchanged =
      existingStats.cnt === entries.length &&
      Math.abs(existingStats.sum - total) < 0.01;

    if (!unchanged) {
      db.prepare("DELETE FROM advertising WHERE date = ?").run(date);
      const ins = db.prepare("INSERT INTO advertising (date, campaign_name, campaign_id, amount, payment_type, nm_id) VALUES (?, ?, ?, ?, ?, ?)");
      db.transaction(() => {
        for (const e of entries) {
          ins.run(date, e.campName || "", e.advertId || 0, e.updSum || 0, e.paymentType || "Баланс", resolveNm(e.advertId || 0));
        }
      })();
    }
    db.close();

    result.ok = true;
    result.value = total;
    // stable=true только когда сумма совпала с предыдущим запуском.
    // Причина: WB публикует "финальный добор" за сутки с updTime=23:59:59
    // уже ПОСЛЕ полуночи — одного stable-фетча в течение дня недостаточно.
    // /adverts-справочник нужен только для маппинга nm_id и на stable не влияет.
    result.stable = prevValue > 0 && Math.abs(total - prevValue) < 0.01;
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
    // Idempotency: если в БД уже те же значения — пропускаем INSERT OR REPLACE.
    const existing = db.prepare("SELECT order_sum, order_count, buyout_sum, buyout_count FROM orders_funnel WHERE date = ?").get(date);
    const unchanged = existing
      && Math.abs((existing.order_sum || 0) - day.orderSum) < 0.01
      && (existing.order_count || 0) === (day.orderCount || 0)
      && Math.abs((existing.buyout_sum || 0) - (day.buyoutSum || 0)) < 0.01
      && (existing.buyout_count || 0) === (day.buyoutCount || 0);
    if (!unchanged) {
      db.prepare("INSERT OR REPLACE INTO orders_funnel (date, order_sum, order_count, buyout_sum, buyout_count) VALUES (?, ?, ?, ?, ?)")
        .run(date, day.orderSum, day.orderCount, day.buyoutSum || 0, day.buyoutCount || 0);
    }
    db.close();

    result.ok = true;
    result.value = day.orderSum;
    result.stable = prevValue > 0 && day.orderSum === prevValue;
  } catch (err) {
    result.error = err.message || String(err);
  }
  return result;
}

/**
 * Bootstrap: при первом запуске после деплоя Блока 5 заполняем meta-таблицу
 * из существующих отчётов в realization. Сопоставляем report_id с ответом /reports
 * и записываем createDate без повторного скачивания.
 */
async function bootstrapReportMeta() {
  try {
    if (!fs.existsSync(TOKENS_PATH)) return;
    const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, "utf-8"));
    if (!tokens.authorizev3 || !tokens.cookies) return;

    const db = new Database(DB_PATH);
    const metaCount = db.prepare("SELECT COUNT(*) as cnt FROM realization_report_meta").get();
    const existingReports = db.prepare(
      "SELECT DISTINCT realizationreport_id FROM realization WHERE realizationreport_id > 0"
    ).all().map(r => r.realizationreport_id);

    if (existingReports.length === 0 || metaCount.cnt >= existingReports.length) {
      db.close();
      return;
    }

    log(`  Bootstrap meta: ${existingReports.length} отчётов в БД, ${metaCount.cnt} в meta — заполняю`);

    const refreshRes = await fetch(
      "https://seller.wildberries.ru/ns/suppliers-auth/suppliers-portal-core/auth/token",
      {
        method: "POST",
        headers: { "content-type": "application/json", authorizev3: tokens.authorizev3, cookie: tokens.cookies, origin: "https://seller.wildberries.ru", referer: "https://seller.wildberries.ru/" },
        body: JSON.stringify({ params: {}, jsonrpc: "2.0", id: "json-rpc_1" }),
      }
    );
    if (!refreshRes.ok) { db.close(); return; }
    const sellerLk = (await refreshRes.json()).result?.data?.token;
    if (!sellerLk) { db.close(); return; }

    // Получаем метаданные для 50 последних отчётов
    const listRes = await fetch(
      "https://seller-services.wildberries.ru/ns/reports/seller-wb-balance/api/v1/reports?limit=50&skip=0&type=6",
      { headers: { authorizev3: tokens.authorizev3, "wb-seller-lk": sellerLk, cookie: tokens.cookies } }
    );
    if (!listRes.ok) { db.close(); return; }
    const apiReports = (await listRes.json()).data?.reports || [];
    const apiMap = new Map(apiReports.map(r => [r.id, r]));

    const now = new Date().toISOString();
    const insertMeta = db.prepare(`
      INSERT INTO realization_report_meta (report_id, create_date, details_count, imported_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(report_id) DO NOTHING
    `);

    let seeded = 0;
    db.transaction(() => {
      for (const rid of existingReports) {
        const apiRep = apiMap.get(rid);
        if (apiRep) {
          insertMeta.run(rid, apiRep.createDate || "", apiRep.detailsCount || 0, now);
          seeded++;
        } else {
          // Отчёта нет в последних 50 — ставим пустой createDate.
          // При следующем появлении в API будет сравнение "" != новый → переимпорт (но отчёт старый, в API его нет → скип естественным образом).
          insertMeta.run(rid, "", 0, now);
        }
      }
    })();
    db.close();
    log(`  Bootstrap meta done: ${seeded}/${existingReports.length} с createDate из API`);
  } catch (err) {
    log(`  Bootstrap meta error: ${err.message}`);
  }
}

// --- Retroactive check: перепроверяем последние 5 дней на изменения в WB ---

function dateNDaysAgo(n) {
  const now = new Date();
  const msk = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  msk.setDate(msk.getDate() - n);
  return msk.toISOString().slice(0, 10);
}

/**
 * Для каждого из последних N дней (today-1 .. today-N) сравниваем данные
 * в БД с тем, что сейчас отдаёт WB. Если отличаются — перезаписываем.
 * Если совпадают — ничего не делаем (принцип "если одинаковые — не трогаем").
 *
 * n=1 (yesterday) важно для рекламы: WB публикует "финальный добор" за сутки
 * с updTime=23:59:59 задним числом, после полуночи — обычный stable-флаг
 * в main() этот добор не увидит. Retro-проверка через час после появления
 * поймает разницу и перезапишет день.
 */
async function retroactiveCheck() {
  const apiKey = getApiKey();
  if (!apiKey) { log("  Retro: нет API ключа, пропуск"); return; }

  const DAYS = 7;
  log(`  Retro check (${DAYS} дней):`);

  for (let n = 1; n <= DAYS; n++) {
    const date = dateNDaysAgo(n);
    let changed = [];

    // --- Orders: сравнение по orderSum ---
    // Пишем в БД сразу полученное значение, без повторного запроса в syncOrders
    // (WB может вернуть разные цифры при повторных запросах — играть туда-сюда).
    try {
      const res = await fetch("https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/grouped/history", {
        method: "POST",
        headers: { Authorization: apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({ brandNames: [], subjectIds: [], tagIds: [], selectedPeriod: { start: date, end: date }, aggregationLevel: "day" }),
      });
      if (res.ok) {
        const data = await res.json();
        const day = data?.data?.[0]?.history?.find(h => h.date === date);
        const wbSum = day?.orderSum || 0;
        const db = new Database(DB_PATH);
        const dbRow = db.prepare("SELECT order_sum FROM orders_funnel WHERE date = ?").get(date);
        const dbSum = dbRow?.order_sum || 0;
        if (day && wbSum > 0 && Math.abs(wbSum - dbSum) > 0.01) {
          db.prepare("INSERT OR REPLACE INTO orders_funnel (date, order_sum, order_count, buyout_sum, buyout_count) VALUES (?, ?, ?, ?, ?)")
            .run(date, wbSum, day.orderCount || 0, day.buyoutSum || 0, day.buyoutCount || 0);
          changed.push(`orders (${dbSum} → ${wbSum})`);
        }
        db.close();
      }
    } catch { /* не критично — пропускаем */ }

    // --- Advertising: сравнение по сумме расходов ---
    try {
      const res = await fetch(`https://advert-api.wildberries.ru/adv/v1/upd?from=${date}&to=${date}`, {
        headers: { Authorization: apiKey },
      });
      if (res.ok) {
        const data = await res.json();
        const wbSum = data.filter(d => (d.updSum || 0) > 0).reduce((s, d) => s + d.updSum, 0);
        const db = new Database(DB_PATH);
        const dbRow = db.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM advertising WHERE date = ?").get(date);
        const dbSum = dbRow?.total || 0;
        db.close();
        if (Math.abs(wbSum - dbSum) > 0.01) {
          await syncAdvertising(date);
          changed.push(`advertising (${dbSum.toFixed(0)} → ${wbSum.toFixed(0)})`);
        }
      }
    } catch { /* пропускаем */ }

    // --- Report: проверка списка отчётов /reports для этого дня ---
    // Если появился новый realizationreport_id для этого дня — скачиваем.
    // Сам syncReport делает skip для уже загруженных отчётов.
    try {
      if (fs.existsSync(TOKENS_PATH)) {
        const tokens = JSON.parse(fs.readFileSync(TOKENS_PATH, "utf-8"));
        if (tokens.authorizev3 && tokens.cookies) {
          const refreshRes = await fetch("https://seller.wildberries.ru/ns/suppliers-auth/suppliers-portal-core/auth/token", {
            method: "POST",
            headers: { "content-type": "application/json", authorizev3: tokens.authorizev3, cookie: tokens.cookies, origin: "https://seller.wildberries.ru", referer: "https://seller.wildberries.ru/" },
            body: JSON.stringify({ params: {}, jsonrpc: "2.0", id: "json-rpc_1" }),
          });
          if (refreshRes.ok) {
            const sellerLk = (await refreshRes.json()).result?.data?.token;
            if (sellerLk) {
              const listRes = await fetch("https://seller-services.wildberries.ru/ns/reports/seller-wb-balance/api/v1/reports?limit=10&skip=0&type=6", {
                headers: { authorizev3: tokens.authorizev3, "wb-seller-lk": sellerLk, cookie: tokens.cookies },
              });
              if (listRes.ok) {
                const reports = (await listRes.json()).data?.reports || [];
                const dateReports = reports.filter(r => r.dateFrom?.slice(0, 10) === date);
                if (dateReports.length > 0) {
                  const db = new Database(DB_PATH);
                  let newReportFound = false;
                  for (const rep of dateReports) {
                    const ex = db.prepare("SELECT COUNT(*) as cnt FROM realization WHERE realizationreport_id = ?").get(rep.id);
                    if (ex.cnt === 0) { newReportFound = true; break; }
                  }
                  db.close();
                  if (newReportFound) {
                    await syncReport(date);
                    changed.push("report");
                  }
                }
              }
            }
          }
        }
      }
    } catch { /* пропускаем */ }

    if (changed.length > 0) {
      log(`    ${date}: обновлено — ${changed.join(", ")}`);
    }
  }
}

// --- Source 4: Weekly realization report (final, via API key) ---

const WEEKLY_COLS = [
  "rrd_id", "realizationreport_id", "date_from", "date_to", "rr_dt", "sale_dt", "order_dt",
  "supplier_oper_name", "nm_id", "sa_name", "ts_name", "barcode", "brand_name", "subject_name",
  "quantity", "retail_price", "retail_price_withdisc_rub", "retail_amount",
  "ppvz_for_pay", "ppvz_sales_commission", "acquiring_fee", "delivery_rub",
  "delivery_amount", "return_amount", "storage_fee", "penalty", "acceptance",
  "rebill_logistic_cost", "additional_payment", "commission_percent",
  "ppvz_spp_prc", "ppvz_kvw_prc_base", "ppvz_kvw_prc", "ppvz_supplier_name",
  "site_country", "office_name", "deduction", "bonus_type_name", "source"
];

/**
 * Синхронизирует один еженедельный период (Пн-Вс) в таблицу realization.
 * Idempotent: сравнивает count+SUM(quantity) с тем, что в БД, пишет только при различии.
 * Возвращает { status: "skip"|"imported"|"updated"|"empty"|"error", count, qty, error }
 */
async function syncWeeklyPeriod(dateFrom, dateTo, apiKey) {
  let allRows = [];
  let rrdid = 0;
  let page = 0;
  try {
    while (true) {
      page++;
      const url = `https://statistics-api.wildberries.ru/api/v5/supplier/reportDetailByPeriod?dateFrom=${dateFrom}&dateTo=${dateTo}&rrdid=${rrdid}&limit=100000`;
      const res = await fetch(url, { headers: { Authorization: apiKey } });
      if (!res.ok) return { status: "error", error: `HTTP ${res.status}` };
      const data = await res.json();
      if (!data || data.length === 0) break;
      allRows = allRows.concat(data);
      rrdid = data[data.length - 1].rrd_id || 0;
      if (data.length < 100000) break;
    }
  } catch (err) {
    return { status: "error", error: err.message || String(err) };
  }

  if (allRows.length === 0) return { status: "empty" };

  const apiQtySum = allRows.reduce((s, r) => s + (r.quantity || 0), 0);
  const db = new Database(DB_PATH);
  try {
    const existing = db.prepare(
      "SELECT COUNT(*) as cnt, COALESCE(SUM(quantity), 0) as qty_sum FROM realization WHERE source = 'weekly_final' AND date_from = ? AND date_to = ?"
    ).get(dateFrom, dateTo);

    if (existing.cnt === allRows.length && existing.qty_sum === apiQtySum) {
      return { status: "skip", count: existing.cnt, qty: existing.qty_sum };
    }

    const isUpdate = existing.cnt > 0;
    if (isUpdate) {
      db.prepare("DELETE FROM realization WHERE source = 'weekly_final' AND date_from = ? AND date_to = ?").run(dateFrom, dateTo);
    }

    const insertStmt = db.prepare(`INSERT INTO realization (${WEEKLY_COLS.join(",")}) VALUES (${WEEKLY_COLS.map(() => "?").join(",")})`);
    db.transaction(() => {
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
    })();

    return { status: isUpdate ? "updated" : "imported", count: allRows.length, qty: apiQtySum };
  } finally {
    db.close();
  }
}

/** Вычисляет dateFrom/dateTo для недели: w=1 — прошлая неделя, w=2 — позапрошлая, и т.д. */
function computeWeek(w) {
  const msk = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const dow = msk.getDay(); // 0=Sun
  const daysToLastMonday = (dow === 0 ? 6 : dow - 1) + 7 + (w - 1) * 7;
  const mon = new Date(msk);
  mon.setDate(msk.getDate() - daysToLastMonday);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { dateFrom: fmt(mon), dateTo: fmt(sun) };
}

/** Синкает N последних еженедельных отчётов (по умолчанию 8). */
async function syncWeeklyReportRange(weeks = 8) {
  const apiKey = getApiKey();
  if (!apiKey) { log("  Weekly: нет API ключа, пропуск"); return; }
  log(`  Weekly retroactive check (${weeks} нед):`);
  for (let w = 1; w <= weeks; w++) {
    const { dateFrom, dateTo } = computeWeek(w);
    const r = await syncWeeklyPeriod(dateFrom, dateTo, apiKey);
    if (r.status === "skip") {
      log(`    ${dateFrom}…${dateTo}: skip (${r.count}/${r.qty})`);
    } else if (r.status === "imported") {
      log(`    ${dateFrom}…${dateTo}: ИМПОРТ ${r.count} строк / qty ${r.qty}`);
    } else if (r.status === "updated") {
      log(`    ${dateFrom}…${dateTo}: ОБНОВЛЕНО ${r.count} строк / qty ${r.qty}`);
    } else if (r.status === "empty") {
      log(`    ${dateFrom}…${dateTo}: отчёт WB пуст`);
    } else if (r.status === "error") {
      log(`    ${dateFrom}…${dateTo}: ERROR ${r.error}`);
    }
  }
}

/** Тонкая обёртка для совместимости — синк только прошлой недели. */
async function syncWeeklyReport() {
  const apiKey = getApiKey();
  if (!apiKey) { log("  Weekly: нет API ключа, пропуск"); return; }
  const { dateFrom, dateTo } = computeWeek(1);
  log(`  Weekly report ${dateFrom} — ${dateTo}...`);
  const r = await syncWeeklyPeriod(dateFrom, dateTo, apiKey);
  if (r.status === "skip") log(`  Weekly: skip (${r.count}/${r.qty})`);
  else if (r.status === "imported") log(`  Weekly: импорт ${r.count} строк`);
  else if (r.status === "updated") log(`  Weekly: обновлено ${r.count} строк`);
  else if (r.status === "empty") log(`  Weekly: отчёт WB пуст`);
  else if (r.status === "error") log(`  Weekly ERROR: ${r.error}`);
}

module.exports = { syncWeeklyReportRange, syncWeeklyReport };

// --- Main ---

async function main() {
  // Работаем 24/7 — без ограничений по часам.
  // Cron тикает каждый час, любой запуск либо синхронизирует, либо skip-ит идемпотентно.

  ensureDirs();
  // Инициализация schema: meta-таблица для dedup отчётов (Блок 5)
  try {
    const db = new Database(DB_PATH);
    db.exec(`
      CREATE TABLE IF NOT EXISTS realization_report_meta (
        report_id INTEGER PRIMARY KEY,
        create_date TEXT,
        details_count INTEGER,
        imported_at TEXT NOT NULL
      )
    `);
    db.close();
  } catch { /* БД ещё не существует — ок, создастся позже */ }

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

  // One-off bootstrap: заполняем realization_report_meta из API для уже
  // импортированных отчётов (нужно только при первом запуске после деплоя).
  await bootstrapReportMeta();

  // Weekly:
  // - Пн-Ср: раз в сутки (первый тик дня) проверяем 8 недель (поиск
  //   корректировок WB задним числом). В остальные часы этого дня — только
  //   прошлая неделя.
  // - Чт-Вс: weekly не дёргается (WB не публикует).
  const mskNow = new Date(Date.now() + 3 * 60 * 60 * 1000);
  const dow = mskNow.getUTCDay();
  if (dow >= 1 && dow <= 3) {
    const todayIso = mskNow.toISOString().slice(0, 10);
    if (status.lastRetroWeeklyCheck !== todayIso) {
      await syncWeeklyReportRange(8);
      status.lastRetroWeeklyCheck = todayIso;
    } else {
      log("  Weekly report check...");
      await syncWeeklyReport();
    }
  }

  // Ретроактивная проверка 5 предыдущих дней — запускается ВСЕГДА,
  // даже если вчерашний день уже complete.
  await retroactiveCheck();

  // Skip daily if already complete
  if (day.complete) {
    log(`${date}: already complete, skipping`);
    status.lastRun = new Date().toISOString();
    saveStatus(status);
    process.exit(0);
  }

  log(`Syncing ${date}...`);

  if (!day.report.ok || !day.report.stable) {
    log("  Report...");
    day.report = await syncReport(date);
    log(`  Report: ${day.report.ok ? day.report.value + " rows" : "FAIL: " + day.report.error}`);
  }

  if (!day.advertising.ok || !day.advertising.stable) {
    log("  Advertising...");
    day.advertising = await syncAdvertising(date, day.advertising.value);
    log(`  Advertising: ${day.advertising.ok ? day.advertising.value + " руб" + (day.advertising.stable ? " (stable)" : " (pending stable)") : "FAIL: " + day.advertising.error}`);
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

if (require.main === module) {
  main().catch(err => {
    log("FATAL: " + err.message);
    process.exit(1);
  });
}
