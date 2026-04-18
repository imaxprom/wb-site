#!/usr/bin/env node
/**
 * Paid Storage Sync — раз в сутки догоняет WB paid_storage за окно N дней.
 *
 * Особенность API: асинхронный (create task → poll → download), ~1 req/min.
 * Поэтому отдельным скриптом, не внутри daily-sync.js (тот гоняется каждый час).
 *
 * Usage:
 *   node scripts/paid-storage-sync.js          # 14 дней (default)
 *   node scripts/paid-storage-sync.js --days 45 # разовый backfill
 *
 * Cron: `0 2 * * * cd /home/makson/website && /usr/bin/node scripts/paid-storage-sync.js`
 */

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const PROJECT_DIR = path.join(__dirname, "..");
const DB_PATH = path.join(PROJECT_DIR, "data", "finance.db");
const API_KEY_PATH = path.join(PROJECT_DIR, "data", "wb-api-key.txt");
const LOG_PATH = path.join(PROJECT_DIR, "data", "paid-storage-sync.log");
const LOCK_PATH = "/tmp/paid-storage-sync.lock";

const HOST = "https://seller-analytics-api.wildberries.ru";
const POLL_DELAY_MS = 2000;
const POLL_MAX_ATTEMPTS = 30;
const BETWEEN_DAYS_DELAY_MS = 60000;
const RATE_LIMIT_WAIT_MS = 60000;
const MAX_RETRIES_429 = 2;

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_PATH, line + "\n"); } catch { /* ignore */ }
}

function getApiKey() {
  try { return fs.readFileSync(API_KEY_PATH, "utf-8").trim(); } catch { return ""; }
}

function parseArgs() {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--days");
  const days = idx >= 0 ? Number(args[idx + 1]) : 14;
  return { days: Math.max(1, Math.min(90, days || 14)) };
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function acquireLock() {
  try {
    if (fs.existsSync(LOCK_PATH)) {
      const pid = Number(fs.readFileSync(LOCK_PATH, "utf-8"));
      try { process.kill(pid, 0); return false; } catch { /* stale — перехватываем */ }
    }
    fs.writeFileSync(LOCK_PATH, String(process.pid));
    return true;
  } catch { return false; }
}

function releaseLock() {
  try { fs.unlinkSync(LOCK_PATH); } catch { /* ignore */ }
}

function daysList(n) {
  const out = [];
  const today = new Date(Date.now() + 3 * 60 * 60 * 1000); // МСК
  for (let i = 1; i <= n; i++) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out.reverse();
}

function ensureTable(db) {
  db.prepare("CREATE TABLE IF NOT EXISTS paid_storage (id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT NOT NULL, nm_id INTEGER NOT NULL, barcode TEXT, warehouse TEXT, warehouse_price REAL DEFAULT 0, barcodes_count INTEGER DEFAULT 0, vendor_code TEXT, subject TEXT, volume REAL DEFAULT 0)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_ps_date_nm ON paid_storage(date, nm_id)").run();
}

function hasDayData(db, date) {
  const row = db.prepare("SELECT COUNT(*) as cnt FROM paid_storage WHERE date = ?").get(date);
  return row.cnt > 0;
}

async function fetchWithRetry(url, opts, label) {
  for (let attempt = 0; attempt <= MAX_RETRIES_429; attempt++) {
    const res = await fetch(url, opts);
    if (res.status !== 429) return res;
    if (attempt < MAX_RETRIES_429) {
      log(`  429 on ${label}, wait ${RATE_LIMIT_WAIT_MS / 1000}s (retry ${attempt + 1}/${MAX_RETRIES_429})`);
      await sleep(RATE_LIMIT_WAIT_MS);
    }
  }
  return fetch(url, opts);
}

async function syncDay(apiKey, date) {
  try {
    const createRes = await fetchWithRetry(`${HOST}/api/v1/paid_storage?dateFrom=${date}&dateTo=${date}`, {
      headers: { Authorization: apiKey },
    }, "create");
    if (!createRes.ok) return { ok: false, err: `create ${createRes.status}` };
    const createData = await createRes.json();
    const taskId = createData?.data?.taskId;
    if (!taskId) return { ok: false, err: "no taskId" };

    let status = "";
    for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
      await sleep(POLL_DELAY_MS);
      const sr = await fetchWithRetry(`${HOST}/api/v1/paid_storage/tasks/${taskId}/status`, {
        headers: { Authorization: apiKey },
      }, "status");
      const sd = await sr.json();
      status = sd?.data?.status || "";
      if (status === "done") break;
      if (status === "canceled" || status === "purged") return { ok: false, err: `task ${status}` };
    }
    if (status !== "done") return { ok: false, err: `poll timeout, last=${status}` };

    const dlRes = await fetchWithRetry(`${HOST}/api/v1/paid_storage/tasks/${taskId}/download`, {
      headers: { Authorization: apiKey },
    }, "download");
    if (!dlRes.ok) return { ok: false, err: `download ${dlRes.status}` };
    const raw = await dlRes.json();
    const rows = Array.isArray(raw) ? raw : (Array.isArray(raw?.data) ? raw.data : []);
    if (rows.length === 0) return { ok: true, total: 0, inserted: 0, note: "empty" };

    const db = new Database(DB_PATH);
    db.pragma("busy_timeout = 5000");
    ensureTable(db);
    db.prepare("DELETE FROM paid_storage WHERE date = ?").run(date);
    const ins = db.prepare("INSERT INTO paid_storage (date, nm_id, barcode, warehouse, warehouse_price, barcodes_count, vendor_code, subject, volume) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)");
    let inserted = 0, total = 0;
    db.transaction(() => {
      for (const r of rows) {
        if ((r.date || date) !== date) continue;
        ins.run(date, r.nmId || 0, r.barcode || "", r.warehouse || "", r.warehousePrice || 0, r.barcodesCount || 0, r.vendorCode || "", r.subject || "", r.volume || 0);
        total += r.warehousePrice || 0;
        inserted++;
      }
    })();
    db.close();
    return { ok: true, total: Math.round(total), inserted };
  } catch (err) {
    return { ok: false, err: err.message || String(err) };
  }
}

async function main() {
  const { days } = parseArgs();
  log(`=== paid-storage-sync started (window=${days}d) ===`);

  const apiKey = getApiKey();
  if (!apiKey) { log("ERROR: no WB API key"); process.exit(1); }

  const db = new Database(DB_PATH);
  ensureTable(db);
  const dates = daysList(days);
  const pending = dates.filter(d => !hasDayData(db, d));
  db.close();

  log(`Window ${dates[0]}..${dates[dates.length - 1]}: ${dates.length} days, ${pending.length} pending`);

  let okCount = 0, failCount = 0;
  for (let i = 0; i < pending.length; i++) {
    const date = pending[i];
    log(`[${i + 1}/${pending.length}] ${date}...`);
    const r = await syncDay(apiKey, date);
    if (r.ok) { okCount++; log(`  ok: ${r.inserted} rows, total=${r.total}${r.note ? " (" + r.note + ")" : ""}`); }
    else { failCount++; log(`  FAIL: ${r.err}`); }
    if (i < pending.length - 1) await sleep(BETWEEN_DAYS_DELAY_MS);
  }
  log(`Done: ${okCount} ok, ${failCount} failed, ${dates.length - pending.length} skipped`);
}

if (!acquireLock()) {
  log("Already running (lock exists)");
  process.exit(0);
}

main()
  .catch(err => { log(`CRASH: ${err.message || err}`); process.exit(1); })
  .finally(() => { releaseLock(); });
