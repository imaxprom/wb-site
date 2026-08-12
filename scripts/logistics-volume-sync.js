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
const { Pool } = require("pg");
const { ensureOrganizationDataDir, organizationDataPath, organizationPoolOptions, requireOrganizationId } = require("./lib/organization-runtime");

const PROJECT_DIR = path.join(__dirname, "..");
const ORGANIZATION_ID = requireOrganizationId();
const DATA_DIR = ensureOrganizationDataDir(PROJECT_DIR, ORGANIZATION_ID);
const API_KEY_PATH = organizationDataPath(PROJECT_DIR, "wb-api-key.txt", ORGANIZATION_ID);
const HOST = "https://seller-analytics-api.wildberries.ru";

const POLL_DELAY_MS = 3000;
const POLL_MAX_ATTEMPTS = 60;
const RATE_LIMIT_WAIT_MS = 60000;
const MAX_RETRIES_429 = 2;

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
      application_name: process.env.PGAPPNAME || "mphub-logistics-volume-sync",
    });
  }
  return pgPool;
}

async function withPgTransaction(fn) {
  const client = await getPgPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

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

  let written = 0;
  const total = await withPgTransaction(async (client) => {
    for (const row of rows) {
      const article = String(row.nmId || row.nmid || row.article_wb || row.articleWB || "").trim();
      const barcode = text(row.barcode || row.Barcode || row.sku);
      const techSize = text(row.techSize || row.size || row.tsName || row.tech_size);
      const volume = numberOrNull(row.volume);
      if (!article || !barcode || !techSize || !volume || volume <= 0) continue;
      await client.query(`
        INSERT INTO warehouse_remains_volume (article_wb, barcode, tech_size, volume, synced_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT(article_wb, barcode, tech_size) DO UPDATE SET
          volume = EXCLUDED.volume,
          synced_at = EXCLUDED.synced_at
      `, [article, barcode, techSize, volume, syncedAt]);
      written++;
    }
    const result = await client.query("SELECT COUNT(*)::int as cnt FROM warehouse_remains_volume");
    return result.rows[0].cnt;
  });

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

  let written = 0;
  const total = await withPgTransaction(async (client) => {
    for (const row of allRows) {
      const article = String(row.nmId || row.nmid || row.article_wb || row.articleWB || "").trim();
      const dimId = Number(row.dimId || row.dim_id || 0);
      const measuredAt = text(row.dt || row.measuredAt || row.measured_at);
      if (!article || !dimId || !measuredAt) continue;
      await client.query(`
        INSERT INTO warehouse_measurements
          (article_wb, dim_id, volume, length_cm, width_cm, height_cm, measured_at, photo_urls_json, synced_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT(article_wb, dim_id) DO UPDATE SET
          volume = EXCLUDED.volume,
          length_cm = EXCLUDED.length_cm,
          width_cm = EXCLUDED.width_cm,
          height_cm = EXCLUDED.height_cm,
          measured_at = EXCLUDED.measured_at,
          photo_urls_json = EXCLUDED.photo_urls_json,
          synced_at = EXCLUDED.synced_at
      `, [
        article,
        dimId,
        numberOrNull(row.volume),
        numberOrNull(row.length),
        numberOrNull(row.width),
        numberOrNull(row.height),
        measuredAt,
        JSON.stringify(Array.isArray(row.photoUrls) ? row.photoUrls : []),
        syncedAt,
      ]);
      written++;
    }
    const result = await client.query("SELECT COUNT(*)::int as cnt FROM warehouse_measurements");
    return result.rows[0].cnt;
  });

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
}).finally(async () => {
  if (pgPool) await pgPool.end().catch(() => {});
});
