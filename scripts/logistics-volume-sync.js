#!/usr/bin/env node
/**
 * Logistics Volume Sync.
 *
 * Sources:
 *   remains      — Warehouses Inventory Report volume by nm/barcode/size
 *   measurements — Warehouse Measurements report
 *
 * Usage:
 *   node scripts/logistics-volume-sync.js --source remains
 *   node scripts/logistics-volume-sync.js --source measurements
 *   node scripts/logistics-volume-sync.js --source all
 */

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

const PROJECT_DIR = path.join(__dirname, "..");
const DB_PATH = path.join(PROJECT_DIR, "data", "finance.db");
const API_KEY_PATH = path.join(PROJECT_DIR, "data", "wb-api-key.txt");
const DATA_DIR = path.join(PROJECT_DIR, "data");
const HOST = "https://seller-analytics-api.wildberries.ru";

const POLL_DELAY_MS = 3000;
const POLL_MAX_ATTEMPTS = 60;
const RATE_LIMIT_WAIT_MS = 60000;
const MAX_RETRIES_429 = 2;

function parseArgs() {
  const args = process.argv.slice(2);
  const sourceIdx = args.indexOf("--source");
  const source = sourceIdx >= 0 ? args[sourceIdx + 1] : "all";
  if (!["all", "remains", "measurements"].includes(source)) {
    throw new Error(`Invalid --source: ${source}`);
  }
  return { source };
}

function logPath(source) {
  return path.join(DATA_DIR, source === "measurements" ? "warehouse-measurements-sync.log" : "warehouse-remains-sync.log");
}

function log(source, msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(logPath(source), line + "\n"); } catch { /* ignore */ }
}

function getApiKey() {
  try { return fs.readFileSync(API_KEY_PATH, "utf-8").trim(); } catch { return ""; }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function lockPath(source) {
  return `/tmp/logistics-volume-sync-${source}.lock`;
}

function acquireLock(source) {
  const lock = lockPath(source);
  try {
    if (fs.existsSync(lock)) {
      const pid = Number(fs.readFileSync(lock, "utf-8"));
      try { process.kill(pid, 0); return false; } catch { /* stale lock */ }
    }
    fs.writeFileSync(lock, String(process.pid));
    return true;
  } catch {
    return false;
  }
}

function releaseLock(source) {
  try { fs.unlinkSync(lockPath(source)); } catch { /* ignore */ }
}

function todayIso() {
  return new Date().toISOString();
}

function ensureTables(db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS warehouse_remains_volume (
      article_wb TEXT NOT NULL,
      barcode TEXT NOT NULL,
      tech_size TEXT NOT NULL,
      volume REAL NOT NULL,
      synced_at TEXT NOT NULL,
      PRIMARY KEY(article_wb, barcode, tech_size)
    )
  `).run();
  db.prepare(`
    CREATE TABLE IF NOT EXISTS warehouse_measurements (
      article_wb TEXT NOT NULL,
      dim_id INTEGER NOT NULL,
      volume REAL,
      length_cm REAL,
      width_cm REAL,
      height_cm REAL,
      measured_at TEXT NOT NULL,
      photo_urls_json TEXT,
      synced_at TEXT NOT NULL,
      PRIMARY KEY(article_wb, dim_id)
    )
  `).run();
}

async function fetchWithRetry(url, opts, source, label) {
  for (let attempt = 0; attempt <= MAX_RETRIES_429; attempt++) {
    const res = await fetch(url, opts);
    if (res.status !== 429) return res;
    if (attempt < MAX_RETRIES_429) {
      log(source, `429 on ${label}, wait ${RATE_LIMIT_WAIT_MS / 1000}s (retry ${attempt + 1}/${MAX_RETRIES_429})`);
      await sleep(RATE_LIMIT_WAIT_MS);
    }
  }
  return fetch(url, opts);
}

function numberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function listFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload?.data?.report)) return payload.data.report;
  if (Array.isArray(payload?.data?.reports)) return payload.data.reports;
  if (Array.isArray(payload?.report)) return payload.report;
  if (Array.isArray(payload?.reports)) return payload.reports;
  return [];
}

async function syncRemains(apiKey) {
  const source = "remains";
  log(source, "=== warehouse-remains sync started ===");

  const url = new URL(`${HOST}/api/v1/warehouse_remains`);
  url.searchParams.set("locale", "ru");
  url.searchParams.set("groupByNm", "true");
  url.searchParams.set("groupByBarcode", "true");
  url.searchParams.set("groupBySize", "true");
  url.searchParams.set("filterPics", "0");
  url.searchParams.set("filterVolume", "0");

  const createRes = await fetchWithRetry(url.toString(), { headers: { Authorization: apiKey } }, source, "create");
  if (!createRes.ok) throw new Error(`warehouse_remains create ${createRes.status}: ${await createRes.text().catch(() => "")}`);
  const createData = await createRes.json();
  const taskId = createData?.data?.taskId || createData?.taskId;
  if (!taskId) throw new Error("warehouse_remains: taskId missing");
  log(source, `task created: ${taskId}`);

  let status = "";
  for (let i = 0; i < POLL_MAX_ATTEMPTS; i++) {
    await sleep(POLL_DELAY_MS);
    const statusRes = await fetchWithRetry(`${HOST}/api/v1/warehouse_remains/tasks/${taskId}/status`, {
      headers: { Authorization: apiKey },
    }, source, "status");
    const statusData = await statusRes.json().catch(() => ({}));
    status = statusData?.data?.status || statusData?.status || "";
    if (status === "done") break;
    if (status === "canceled" || status === "purged") throw new Error(`warehouse_remains task ${status}`);
  }
  if (status !== "done") throw new Error(`warehouse_remains poll timeout, last=${status}`);

  const downloadRes = await fetchWithRetry(`${HOST}/api/v1/warehouse_remains/tasks/${taskId}/download`, {
    headers: { Authorization: apiKey },
  }, source, "download");
  if (!downloadRes.ok) throw new Error(`warehouse_remains download ${downloadRes.status}: ${await downloadRes.text().catch(() => "")}`);

  const payload = await downloadRes.json();
  const rows = listFromPayload(payload);
  const syncedAt = todayIso();

  const db = new Database(DB_PATH);
  db.pragma("busy_timeout = 5000");
  ensureTables(db);
  const ins = db.prepare(`
    INSERT INTO warehouse_remains_volume (article_wb, barcode, tech_size, volume, synced_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(article_wb, barcode, tech_size) DO UPDATE SET
      volume = excluded.volume,
      synced_at = excluded.synced_at
  `);
  let written = 0;
  db.transaction(() => {
    for (const row of rows) {
      const article = String(row.nmId || row.nmid || row.article_wb || row.articleWB || "").trim();
      const barcode = text(row.barcode || row.Barcode || row.sku);
      const techSize = text(row.techSize || row.size || row.tsName || row.tech_size);
      const volume = numberOrNull(row.volume);
      if (!article || !barcode || !techSize || !volume || volume <= 0) continue;
      ins.run(article, barcode, techSize, volume, syncedAt);
      written++;
    }
  })();
  const total = db.prepare("SELECT COUNT(*) as cnt FROM warehouse_remains_volume").get().cnt;
  db.close();

  log(source, `Done: payload=${rows.length}, written=${written}, table_total=${total}`);
  return { rows: rows.length, written, total };
}

async function syncMeasurements(apiKey) {
  const source = "measurements";
  log(source, "=== warehouse-measurements sync started ===");

  const syncedAt = todayIso();
  const dateFrom = "2024-01-01T00:00:00Z";
  const dateTo = syncedAt;
  const limit = 1000;
  let offset = 0;
  const allRows = [];

  while (true) {
    const url = new URL(`${HOST}/api/analytics/v1/warehouse-measurements`);
    url.searchParams.set("dateFrom", dateFrom);
    url.searchParams.set("dateTo", dateTo);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));

    const res = await fetchWithRetry(url.toString(), { headers: { Authorization: apiKey } }, source, `page offset=${offset}`);
    if (!res.ok) throw new Error(`warehouse-measurements ${res.status}: ${await res.text().catch(() => "")}`);
    const payload = await res.json();
    const rows = listFromPayload(payload);
    allRows.push(...rows);
    const total = Number(payload?.data?.total || payload?.total || 0);
    log(source, `page offset=${offset}: rows=${rows.length}${total ? `, total=${total}` : ""}`);
    if (rows.length < limit || (total > 0 && allRows.length >= total)) break;
    offset += limit;
    await sleep(RATE_LIMIT_WAIT_MS);
  }

  const db = new Database(DB_PATH);
  db.pragma("busy_timeout = 5000");
  ensureTables(db);
  const ins = db.prepare(`
    INSERT INTO warehouse_measurements
      (article_wb, dim_id, volume, length_cm, width_cm, height_cm, measured_at, photo_urls_json, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(article_wb, dim_id) DO UPDATE SET
      volume = excluded.volume,
      length_cm = excluded.length_cm,
      width_cm = excluded.width_cm,
      height_cm = excluded.height_cm,
      measured_at = excluded.measured_at,
      photo_urls_json = excluded.photo_urls_json,
      synced_at = excluded.synced_at
  `);
  let written = 0;
  db.transaction(() => {
    for (const row of allRows) {
      const article = String(row.nmId || row.nmid || row.article_wb || row.articleWB || "").trim();
      const dimId = Number(row.dimId || row.dim_id || 0);
      const measuredAt = text(row.dt || row.measuredAt || row.measured_at);
      if (!article || !dimId || !measuredAt) continue;
      ins.run(
        article,
        dimId,
        numberOrNull(row.volume),
        numberOrNull(row.length),
        numberOrNull(row.width),
        numberOrNull(row.height),
        measuredAt,
        JSON.stringify(Array.isArray(row.photoUrls) ? row.photoUrls : []),
        syncedAt
      );
      written++;
    }
  })();
  const total = db.prepare("SELECT COUNT(*) as cnt FROM warehouse_measurements").get().cnt;
  db.close();

  log(source, `Done: fetched=${allRows.length}, written=${written}, table_total=${total}`);
  return { rows: allRows.length, written, total };
}

async function runSource(source, apiKey) {
  if (!acquireLock(source)) {
    log(source, "Already running (lock exists)");
    return;
  }
  try {
    if (source === "remains") await syncRemains(apiKey);
    else await syncMeasurements(apiKey);
  } finally {
    releaseLock(source);
  }
}

async function main() {
  const { source } = parseArgs();
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("no WB API key");

  if (source === "all") {
    await runSource("remains", apiKey);
    await sleep(RATE_LIMIT_WAIT_MS);
    await runSource("measurements", apiKey);
    return;
  }

  await runSource(source, apiKey);
}

main().catch((err) => {
  const source = (() => { try { return parseArgs().source; } catch { return "remains"; } })();
  const targets = source === "all" ? ["remains", "measurements"] : [source];
  for (const target of targets) log(target, `CRASH: ${err.message || err}`);
  process.exit(1);
});
