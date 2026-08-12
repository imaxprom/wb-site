#!/usr/bin/env node
/**
 * Reviews auto-sync script.
 * Default mode is a slow archive tick: one WB archive request per run.
 * Production cron should run it every 15 minutes.
 *
 * Usage: node scripts/reviews-sync.js
 * Or via production cron.
 */

const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");
const { ensureOrganizationDataDir, organizationDataPath, organizationPoolOptions, organizationTempPath, requireOrganizationId } = require("./lib/organization-runtime");

const PROJECT_DIR = path.join(__dirname, "..");
const ORGANIZATION_ID = requireOrganizationId();
ensureOrganizationDataDir(PROJECT_DIR, ORGANIZATION_ID);
const LOG_PATH = organizationDataPath(PROJECT_DIR, "reviews-sync.log", ORGANIZATION_ID);
const LOCK_PATH = organizationTempPath("reviews-sync.lock", ORGANIZATION_ID);

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

const USE_PG = true;
let pgPool = null;

function getPgPool() {
  if (!pgPool) {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required when MPHUB_DB_ENGINE=postgres");
    pgPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      options: organizationPoolOptions(ORGANIZATION_ID),
      max: Number(process.env.PGPOOL_MAX || 5),
      application_name: process.env.PGAPPNAME || "mphub-reviews-sync",
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

// ─── Logging ────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_PATH, line + "\n"); } catch {}
}

// ─── DB helpers ─────────────────────────────────────────────

function getDb() {
  throw new Error("Removed file-DB reviews sync is disabled. Use PostgreSQL runtime only.");
}

function getApiKey(db) {
  const row = db.prepare(`SELECT api_key FROM review_accounts WHERE supplier_id = '1166225'`).get();
  return row?.api_key || null;
}

function getAccountId(db) {
  const row = db.prepare(`SELECT id FROM review_accounts WHERE supplier_id = '1166225'`).get();
  return row?.id || null;
}

async function getApiKeyPg() {
  const result = await getPgPool().query(`SELECT api_key FROM review_accounts WHERE supplier_id = $1`, ["1166225"]);
  return result.rows[0]?.api_key || null;
}

async function getAccountIdPg() {
  const result = await getPgPool().query(`SELECT id FROM review_accounts WHERE supplier_id = $1`, ["1166225"]);
  return result.rows[0]?.id || null;
}

// ─── Fetch feedbacks ────────────────────────────────────────

const WB_FEEDBACKS_URL = "https://feedbacks-api.wildberries.ru/api/v1/feedbacks";
const WB_FEEDBACKS_ARCHIVE_URL = "https://feedbacks-api.wildberries.ru/api/v1/feedbacks/archive";
const ARCHIVE_TAKE = 5000;
const ARCHIVE_MIN_INTERVAL_SECONDS = 30 * 60;
const ARCHIVE_SUCCESS_COOLDOWN_SECONDS = 29 * 60;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWbJson(url, apiKey) {
  let lastBody = "";

  const retryDelays = [10000, 30000, 60000, 120000, 180000, 300000, 300000, 300000];
  for (let attempt = 1; attempt <= retryDelays.length; attempt++) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const text = await res.text().catch(() => "");
    lastBody = text;

    if (res.ok) {
      return text ? JSON.parse(text) : {};
    }

    if (res.status === 429 || res.status >= 500) {
      log(`WB ${res.status}, retry ${attempt}/${retryDelays.length} after ${Math.round(retryDelays[attempt - 1] / 1000)}s backoff`);
      await sleep(retryDelays[attempt - 1]);
      continue;
    }

    throw new Error(`WB feedbacks API ${res.status}: ${text}`);
  }

  throw new Error(`WB feedbacks API retry exhausted: ${lastBody}`);
}

function getFeedbacksFromResponse(data) {
  return Array.isArray(data?.data?.feedbacks) ? data.data.feedbacks : [];
}

function getArgNumber(name, defaultValue) {
  const prefix = `--${name}=`;
  const arg = process.argv.find(item => item.startsWith(prefix));
  if (!arg) return defaultValue;
  const value = Number(arg.slice(prefix.length));
  return Number.isFinite(value) && value > 0 ? value : defaultValue;
}

async function fetchFeedbacks(apiKey, fullSync = false) {
  const all = [];

  // 1) Unanswered
  for (let skip = 0; ; skip += 100) {
    const data = await fetchWbJson(`${WB_FEEDBACKS_URL}?isAnswered=false&take=100&skip=${skip}`, apiKey);
    const fbs = getFeedbacksFromResponse(data);
    all.push(...fbs);
    if (fbs.length < 100) break;
    await sleep(500);
  }

  // 2) Answered
  if (fullSync) {
    for (let skip = 0; ; skip += 5000) {
      const data = await fetchWbJson(`${WB_FEEDBACKS_URL}?isAnswered=true&take=5000&skip=${skip}`, apiKey);
      const fbs = getFeedbacksFromResponse(data);
      all.push(...fbs);
      log(`Fetched answered page skip=${skip}: ${fbs.length}`);
      if (fbs.length < 5000) break;
      await sleep(500);
    }
  } else {
    const data = await fetchWbJson(`${WB_FEEDBACKS_URL}?isAnswered=true&take=500&skip=0`, apiKey);
    all.push(...getFeedbacksFromResponse(data));
  }

  // 3) Archive: processed reviews and rating-only reviews live here.
  const archivePageLimit = fullSync ? Infinity : 3;
  let archivePages = 0;
  for (let skip = 0; archivePages < archivePageLimit; skip += 5000) {
    const data = await fetchWbJson(`${WB_FEEDBACKS_ARCHIVE_URL}?take=5000&skip=${skip}`, apiKey);
    const fbs = getFeedbacksFromResponse(data);
    all.push(...fbs);
    archivePages++;
    log(`Fetched archive page skip=${skip}: ${fbs.length}`);
    if (fbs.length < 5000) break;
    await sleep(500);

    if (!fullSync) {
      const oldestDate = fbs
        .map(fb => fb.createdDate ? fb.createdDate.slice(0, 10) : "")
        .filter(Boolean)
        .sort()[0];
      const cutoff = new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
      if (oldestDate && oldestDate < cutoff) break;
    }
  }

  return all;
}

// ─── Upsert reviews ────────────────────────────────────────

function upsertReviews(db, accountId, feedbacks) {
  const stmt = db.prepare(`
    INSERT INTO reviews (account_id, wb_review_id, date, rating, product_name, product_article, brand, review_text, pros, cons, buyer_name, status, is_updated, purchase_type, shk_id, order_date, bables)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(wb_review_id) DO UPDATE SET
      review_text = excluded.review_text,
      pros = excluded.pros,
      cons = excluded.cons,
      rating = excluded.rating,
      purchase_type = excluded.purchase_type,
      shk_id = excluded.shk_id,
      order_date = excluded.order_date,
      bables = excluded.bables,
      is_updated = CASE WHEN reviews.review_text != excluded.review_text THEN 1 ELSE reviews.is_updated END
  `);

  let count = 0;
  db.transaction(() => {
    for (const fb of feedbacks) {
      const status = fb.isAnswered ? "replied" : "new";
      const purchaseType = fb.orderStatus === "buyout" ? "buyout"
        : fb.orderStatus === "rejected" ? "rejected"
        : fb.orderStatus === "returned" ? "returned"
        : null;
      stmt.run(
        accountId,
        fb.id,
        fb.createdDate ? fb.createdDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
        fb.productValuation ?? 5,
        fb.productDetails?.productName || null,
        fb.productDetails?.nmId ? String(fb.productDetails.nmId) : fb.productDetails?.supplierArticle || null,
        fb.productDetails?.brandName || null,
        fb.text || null,
        fb.pros || null,
        fb.cons || null,
        fb.userName || null,
        status,
        0,
        purchaseType,
        fb.lastOrderShkId || null,
        fb.lastOrderCreatedAt ? fb.lastOrderCreatedAt.slice(0, 10) : null,
        fb.bables && fb.bables.length > 0 ? JSON.stringify(fb.bables) : null,
      );
      count++;
    }
  })();
  return count;
}

function mapFeedback(fb, accountId) {
  const purchaseType = fb.orderStatus === "buyout" ? "buyout"
    : fb.orderStatus === "rejected" ? "rejected"
    : fb.orderStatus === "returned" ? "returned"
    : null;

  return {
    accountId,
    wbReviewId: fb.id,
    date: fb.createdDate ? fb.createdDate.slice(0, 10) : new Date().toISOString().slice(0, 10),
    rating: fb.productValuation ?? 5,
    productName: fb.productDetails?.productName || null,
    productArticle: fb.productDetails?.nmId ? String(fb.productDetails.nmId) : fb.productDetails?.supplierArticle || null,
    brand: fb.productDetails?.brandName || null,
    reviewText: fb.text || null,
    pros: fb.pros || null,
    cons: fb.cons || null,
    buyerName: fb.userName || null,
    status: fb.isAnswered ? "replied" : "new",
    purchaseType,
    shkId: fb.lastOrderShkId || null,
    orderDate: fb.lastOrderCreatedAt ? fb.lastOrderCreatedAt.slice(0, 10) : null,
    bables: fb.bables && fb.bables.length > 0 ? JSON.stringify(fb.bables) : null,
  };
}

async function upsertReviewsPg(accountId, feedbacks) {
  if (feedbacks.length === 0) return 0;

  await withPgTransaction(async (client) => {
    for (const fb of feedbacks) {
      const row = mapFeedback(fb, accountId);
      await client.query(`
        INSERT INTO reviews (account_id, wb_review_id, date, rating, product_name, product_article, brand, review_text, pros, cons, buyer_name, status, is_updated, purchase_type, shk_id, order_date, bables)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
        ON CONFLICT(wb_review_id) DO UPDATE SET
          review_text = excluded.review_text,
          pros = excluded.pros,
          cons = excluded.cons,
          rating = excluded.rating,
          purchase_type = excluded.purchase_type,
          shk_id = excluded.shk_id,
          order_date = excluded.order_date,
          bables = excluded.bables,
          is_updated = CASE WHEN reviews.review_text IS DISTINCT FROM excluded.review_text THEN 1 ELSE reviews.is_updated END
      `, [
        row.accountId,
        row.wbReviewId,
        row.date,
        row.rating,
        row.productName,
        row.productArticle,
        row.brand,
        row.reviewText,
        row.pros,
        row.cons,
        row.buyerName,
        row.status,
        0,
        row.purchaseType,
        row.shkId,
        row.orderDate,
        row.bables,
      ]);
    }
  });

  return feedbacks.length;
}

// ─── Enrich from Orders API ─────────────────────────────────

async function enrichFromOrders(db, apiKey, accountId) {
  const reviews = db.prepare(`
    SELECT id, shk_id FROM reviews
    WHERE account_id = ? AND shk_id IS NOT NULL AND (price IS NULL OR pickup_point IS NULL)
      AND order_date >= date('now', '-90 days')
    LIMIT 50000
  `).all(accountId);

  if (reviews.length === 0) return 0;

  const shkLookup = new Map();
  for (const r of reviews) shkLookup.set(r.shk_id, r.id);

  const dateFrom = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const res = await fetch(`https://statistics-api.wildberries.ru/api/v1/supplier/orders?dateFrom=${dateFrom}`, {
    headers: { Authorization: apiKey },
  });
  if (!res.ok) return 0;

  const orders = await res.json();
  if (!Array.isArray(orders)) return 0;

  const stmt = db.prepare(`UPDATE reviews SET price = ?, pickup_point = ? WHERE shk_id = ? AND (price IS NULL OR pickup_point IS NULL)`);
  let enriched = 0;

  db.transaction(() => {
    for (const o of orders) {
      const sticker = Number(o.sticker);
      const price = Math.abs(o.finishedPrice || 0);
      if (sticker && shkLookup.has(sticker) && price > 0) {
        const res = stmt.run(price, o.regionName || "", sticker);
        enriched += res.changes;
        shkLookup.delete(sticker);
      }
    }
  })();

  return enriched;
}

async function enrichFromOrdersPg(apiKey, accountId) {
  const pending = await getPgPool().query(`
    SELECT id, shk_id FROM reviews
    WHERE account_id = $1 AND shk_id IS NOT NULL AND (price IS NULL OR pickup_point IS NULL)
      AND order_date >= to_char(CURRENT_DATE - INTERVAL '90 days', 'YYYY-MM-DD')
    LIMIT 50000
  `, [accountId]);

  if (pending.rows.length === 0) return 0;

  const shkLookup = new Map();
  for (const r of pending.rows) shkLookup.set(Number(r.shk_id), Number(r.id));

  const dateFrom = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const res = await fetch(`https://statistics-api.wildberries.ru/api/v1/supplier/orders?dateFrom=${dateFrom}`, {
    headers: { Authorization: apiKey },
  });
  if (!res.ok) return 0;

  const orders = await res.json();
  if (!Array.isArray(orders)) return 0;

  let enriched = 0;
  await withPgTransaction(async (client) => {
    for (const o of orders) {
      const sticker = Number(o.sticker);
      const price = Math.abs(o.finishedPrice || 0);
      if (sticker && shkLookup.has(sticker) && price > 0) {
        const result = await client.query(
          `UPDATE reviews SET price = $1, pickup_point = $2 WHERE shk_id = $3 AND (price IS NULL OR pickup_point IS NULL)`,
          [price, o.regionName || "", sticker],
        );
        enriched += result.rowCount || 0;
        shkLookup.delete(sticker);
      }
    }
  });

  return enriched;
}

async function enrichFromShipmentOrdersPg(accountId) {
  const result = await getPgPool().query(`
    WITH order_source AS (
      SELECT DISTINCT ON (sticker)
        sticker,
        finished_price,
        region
      FROM shipment_orders
      WHERE sticker IS NOT NULL
        AND sticker <> ''
        AND finished_price IS NOT NULL
        AND finished_price > 0
      ORDER BY sticker, date DESC
    )
    UPDATE reviews r
    SET
      price = CASE
        WHEN r.price IS NULL OR r.price <= 0 THEN order_source.finished_price
        ELSE r.price
      END,
      pickup_point = CASE
        WHEN r.pickup_point IS NULL OR r.pickup_point = '' THEN order_source.region
        ELSE r.pickup_point
      END
    FROM order_source
    WHERE r.account_id = $1
      AND r.shk_id IS NOT NULL
      AND r.shk_id::text = order_source.sticker
      AND (
        r.price IS NULL
        OR r.price <= 0
        OR r.pickup_point IS NULL
        OR r.pickup_point = ''
      )
  `, [accountId]);

  return result.rowCount || 0;
}

async function enrichReviewsRuntime(db, apiKey, accountId) {
  if (!USE_PG) return enrichFromOrders(db, apiKey, accountId);
  const local = await enrichFromShipmentOrdersPg(accountId);
  const external = await enrichFromOrdersPg(apiKey, accountId);
  return local + external;
}

async function countReviews(db, accountId = null) {
  if (USE_PG) {
    const result = accountId
      ? await getPgPool().query(`SELECT COUNT(*)::int AS cnt FROM reviews WHERE account_id = $1`, [accountId])
      : await getPgPool().query(`SELECT COUNT(*)::int AS cnt FROM reviews`);
    return result.rows[0]?.cnt || 0;
  }

  return accountId
    ? db.prepare(`SELECT COUNT(*) as cnt FROM reviews WHERE account_id = ?`).get(accountId).cnt
    : db.prepare(`SELECT COUNT(*) as cnt FROM reviews`).get().cnt;
}

async function countReviewsWithPrice(db) {
  if (USE_PG) {
    const result = await getPgPool().query(`SELECT COUNT(*)::int AS cnt FROM reviews WHERE price > 0`);
    return result.rows[0]?.cnt || 0;
  }

  return db.prepare(`SELECT COUNT(*) as cnt FROM reviews WHERE price > 0`).get().cnt;
}

async function ensureArchiveSyncState(db) {
  if (USE_PG) {
    await getPgPool().query(`
      CREATE TABLE IF NOT EXISTS reviews_archive_sync_state (
        id INTEGER PRIMARY KEY,
        archive_skip INTEGER NOT NULL DEFAULT 0,
        retry_after_until TEXT,
        last_request_at TEXT,
        last_success_at TEXT,
        last_status TEXT,
        last_message TEXT,
        fetched_count INTEGER NOT NULL DEFAULT 0,
        upserted_count INTEGER NOT NULL DEFAULT 0,
        inserted_count INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await getPgPool().query(`
      INSERT INTO reviews_archive_sync_state (id)
      VALUES (1)
      ON CONFLICT(id) DO NOTHING
    `);
    return;
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS reviews_archive_sync_state (
      id INTEGER PRIMARY KEY,
      archive_skip INTEGER NOT NULL DEFAULT 0,
      retry_after_until TEXT,
      last_request_at TEXT,
      last_success_at TEXT,
      last_status TEXT,
      last_message TEXT,
      fetched_count INTEGER NOT NULL DEFAULT 0,
      upserted_count INTEGER NOT NULL DEFAULT 0,
      inserted_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.prepare(`INSERT OR IGNORE INTO reviews_archive_sync_state (id) VALUES (1)`).run();
}

async function getArchiveSyncState(db) {
  await ensureArchiveSyncState(db);
  if (USE_PG) {
    const result = await getPgPool().query(`SELECT * FROM reviews_archive_sync_state WHERE id = 1`);
    return result.rows[0];
  }
  return db.prepare(`SELECT * FROM reviews_archive_sync_state WHERE id = 1`).get();
}

async function updateArchiveSyncState(db, state) {
  if (USE_PG) {
    await getPgPool().query(`
      UPDATE reviews_archive_sync_state
      SET archive_skip = $1,
          retry_after_until = $2,
          last_request_at = $3,
          last_success_at = $4,
          last_status = $5,
          last_message = $6,
          fetched_count = $7,
          upserted_count = $8,
          inserted_count = $9,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = 1
    `, [
      state.archive_skip,
      state.retry_after_until || null,
      state.last_request_at || null,
      state.last_success_at || null,
      state.last_status || null,
      state.last_message || null,
      state.fetched_count || 0,
      state.upserted_count || 0,
      state.inserted_count || 0,
    ]);
    return;
  }

  db.prepare(`
    UPDATE reviews_archive_sync_state
    SET archive_skip = ?,
        retry_after_until = ?,
        last_request_at = ?,
        last_success_at = ?,
        last_status = ?,
        last_message = ?,
        fetched_count = ?,
        upserted_count = ?,
        inserted_count = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = 1
  `).run(
    state.archive_skip,
    state.retry_after_until || null,
    state.last_request_at || null,
    state.last_success_at || null,
    state.last_status || null,
    state.last_message || null,
    state.fetched_count || 0,
    state.upserted_count || 0,
    state.inserted_count || 0,
  );
}

async function updateSyncStatus(db, loaded, total, message) {
  if (USE_PG) {
    await getPgPool().query(
      `UPDATE sync_status SET status = 'done', loaded = $1, total = $2, message = $3, updated_at = CURRENT_TIMESTAMP WHERE id = 1`,
      [loaded, total, message],
    );
    return;
  }

  db.prepare(`UPDATE sync_status SET status = 'done', loaded = ?, total = ?, message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`)
    .run(loaded, total, message);
}

function acquireLock() {
  try {
    if (fs.existsSync(LOCK_PATH)) {
      const pid = Number(fs.readFileSync(LOCK_PATH, "utf-8"));
      if (pid) {
        try {
          process.kill(pid, 0);
          return false;
        } catch {
          // stale lock
        }
      }
      fs.rmSync(LOCK_PATH, { force: true });
    }
    fs.writeFileSync(LOCK_PATH, String(process.pid), { flag: "wx" });
    return true;
  } catch {
    return false;
  }
}

function releaseLock() {
  try { fs.rmSync(LOCK_PATH, { force: true }); } catch {}
}

async function fetchWbJsonOnce(url, apiKey) {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const text = await res.text().catch(() => "");
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }
  return { res, data, text };
}

function secondsFromRateLimit(res) {
  const retry = Number(res.headers.get("x-ratelimit-retry") || res.headers.get("retry-after") || 0);
  return Number.isFinite(retry) && retry > 0 ? retry : ARCHIVE_MIN_INTERVAL_SECONDS;
}

function addSecondsIso(seconds) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

async function runArchiveTick(db, apiKey, accountId) {
  const state = await getArchiveSyncState(db);
  const nowIso = new Date().toISOString();

  if (state.retry_after_until && new Date(state.retry_after_until).getTime() > Date.now()) {
    const enriched = await enrichReviewsRuntime(db, apiKey, accountId);
    const total = await countReviews(db);
    const withPrice = await countReviewsWithPrice(db);
    const message = `Отзывы: ожидание лимита WB до ${state.retry_after_until} | Цена и ПВЗ: ${withPrice.toLocaleString("ru-RU")} (+${enriched.toLocaleString("ru-RU")})`;
    await updateSyncStatus(db, total, total, message);
    log(`Archive top tick skipped: rate-limit wait until ${state.retry_after_until}, enriched=${enriched}`);
    return;
  }

  // Runtime sync must keep recent reviews fresh. Deep archive crawling is too slow
  // and makes new reviews wait until the cursor returns to the top.
  const skip = 0;
  const url = `${WB_FEEDBACKS_ARCHIVE_URL}?take=${ARCHIVE_TAKE}&skip=${skip}&order=dateDesc`;
  log(`Archive top tick request: take=${ARCHIVE_TAKE}, skip=${skip}`);
  const { res, data, text } = await fetchWbJsonOnce(url, apiKey);

  if (res.status === 429) {
    const waitSeconds = Math.max(secondsFromRateLimit(res), ARCHIVE_MIN_INTERVAL_SECONDS);
    const retryAfterUntil = addSecondsIso(waitSeconds);
    const enriched = await enrichReviewsRuntime(db, apiKey, accountId);
    const total = await countReviews(db);
    const withPrice = await countReviewsWithPrice(db);
    const message = `Отзывы: WB 429, следующий запрос после ${retryAfterUntil} | Цена и ПВЗ: ${withPrice.toLocaleString("ru-RU")} (+${enriched.toLocaleString("ru-RU")})`;
    await updateArchiveSyncState(db, {
      ...state,
      archive_skip: 0,
      retry_after_until: retryAfterUntil,
      last_request_at: nowIso,
      last_status: "rate_limited",
      last_message: message,
    });
    await updateSyncStatus(db, total, total, message);
    log(`Archive top tick rate-limited: retry_after=${waitSeconds}s, enriched=${enriched}, body=${text.slice(0, 500)}`);
    return;
  }

  if (!res.ok) {
    const total = await countReviews(db);
    const message = `Отзывы: WB archive ${res.status}: ${text.slice(0, 200)}`;
    await updateArchiveSyncState(db, {
      ...state,
      archive_skip: skip,
      retry_after_until: null,
      last_request_at: nowIso,
      last_status: `error_${res.status}`,
      last_message: message,
    });
    await updateSyncStatus(db, total, total, message);
    throw new Error(message);
  }

  const feedbacks = getFeedbacksFromResponse(data);
  const before = await countReviews(db, accountId);
  const upserted = feedbacks.length > 0
    ? (USE_PG ? await upsertReviewsPg(accountId, feedbacks) : upsertReviews(db, accountId, feedbacks))
    : 0;
  const after = await countReviews(db, accountId);
  const inserted = after - before;
  const enriched = await enrichReviewsRuntime(db, apiKey, accountId);
  const total = await countReviews(db);
  const withPrice = await countReviewsWithPrice(db);
  const message = `В базе: ${total.toLocaleString("ru-RU")} ✅ | Верх архива WB: получено ${feedbacks.length.toLocaleString("ru-RU")}, новых ${inserted.toLocaleString("ru-RU")} | Цена и ПВЗ: ${withPrice.toLocaleString("ru-RU")} (+${enriched.toLocaleString("ru-RU")})`;

  await updateArchiveSyncState(db, {
    archive_skip: 0,
    retry_after_until: addSecondsIso(ARCHIVE_SUCCESS_COOLDOWN_SECONDS),
    last_request_at: nowIso,
    last_success_at: new Date().toISOString(),
    last_status: "ok",
    last_message: message,
    fetched_count: Number(state.fetched_count || 0) + feedbacks.length,
    upserted_count: Number(state.upserted_count || 0) + upserted,
    inserted_count: Number(state.inserted_count || 0) + inserted,
  });
  await updateSyncStatus(db, total, total, message);
  log(`Archive top tick OK: fetched=${feedbacks.length}, upserted=${upserted}, new=${inserted}, enriched=${enriched}, total=${total}`);
}

// ─── Main ───────────────────────────────────────────────────

async function main() {
  log("=== Reviews sync started ===");
  const fullSync = process.argv.includes("--full");
  const archiveOnly = process.argv.includes("--archive-only");
  const legacySync = process.argv.includes("--legacy-sync") || fullSync;
  if (!acquireLock()) {
    log("Another reviews sync is already running, exiting");
    return;
  }

  const db = USE_PG ? null : getDb();
  const apiKey = USE_PG ? await getApiKeyPg() : getApiKey(db);
  if (!apiKey) {
    log("ERROR: No API key found");
    if (db) db.close();
    if (pgPool) await pgPool.end();
    releaseLock();
    return;
  }

  const accountId = USE_PG ? await getAccountIdPg() : getAccountId(db);
  if (!accountId) {
    log("ERROR: No account found");
    if (db) db.close();
    if (pgPool) await pgPool.end();
    releaseLock();
    return;
  }

  if (!legacySync && !archiveOnly) {
    await runArchiveTick(db, apiKey, accountId);
    if (db) db.close();
    if (pgPool) await pgPool.end();
    releaseLock();
    return;
  }

  if (archiveOnly) {
    const pageLimit = getArgNumber("archive-pages", 3);
    const before = await countReviews(db, accountId);
    let fetched = 0;
    let upserted = 0;

    for (let page = 0; page < pageLimit; page++) {
      const skip = page * 5000;
      const data = await fetchWbJson(`${WB_FEEDBACKS_ARCHIVE_URL}?take=5000&skip=${skip}`, apiKey);
      const feedbacks = getFeedbacksFromResponse(data);
      fetched += feedbacks.length;
      if (feedbacks.length === 0) break;
      upserted += USE_PG ? await upsertReviewsPg(accountId, feedbacks) : upsertReviews(db, accountId, feedbacks);
      const afterPage = await countReviews(db, accountId);
      log(`Archive page ${page + 1}/${pageLimit} skip=${skip}: fetched=${feedbacks.length}, total=${afterPage}, new=${afterPage - before}`);
      if (feedbacks.length < 5000) break;
      await sleep(1000);
    }

    const after = await countReviews(db, accountId);
    const withPrice = await countReviewsWithPrice(db);
    await updateSyncStatus(db, after, after, `В базе: ${after.toLocaleString("ru-RU")} ✅ | Архив: +${(after - before).toLocaleString("ru-RU")} | Цена и ПВЗ: ${withPrice.toLocaleString("ru-RU")}`);
    log(`=== Archive done. Fetched: ${fetched}, upserted: ${upserted}, new: ${after - before}, total: ${after} ===`);
    if (db) db.close();
    if (pgPool) await pgPool.end();
    releaseLock();
    return;
  }

  // 1. Fetch & upsert reviews
  const feedbacks = await fetchFeedbacks(apiKey, fullSync);
  log(`Fetched ${feedbacks.length} feedbacks from WB${fullSync ? " (full with archive)" : ""}`);

  if (feedbacks.length > 0) {
    const before = await countReviews(db, accountId);
    const upserted = USE_PG ? await upsertReviewsPg(accountId, feedbacks) : upsertReviews(db, accountId, feedbacks);
    const after = await countReviews(db, accountId);
    const added = after - before;
    log(`Upserted ${upserted}, new: ${added}, total: ${after}`);
  }

  // 2. Enrich from Orders API
  const enriched = await enrichReviewsRuntime(db, apiKey, accountId);
  log(`Enriched ${enriched} reviews with price & region`);

  // 3. Update sync status
  const total = await countReviews(db);
  const withPrice = await countReviewsWithPrice(db);
  await updateSyncStatus(db, total, total, `В базе: ${total.toLocaleString("ru-RU")} ✅ | Цена и ПВЗ: ${withPrice.toLocaleString("ru-RU")}`);

  log(`=== Done. Total: ${total}, with price: ${withPrice} ===`);
  if (db) db.close();
  if (pgPool) await pgPool.end();
  releaseLock();
}

main().catch(e => {
  log(`FATAL: ${e.message}`);
  try { fs.rmSync(LOCK_PATH, { force: true }); } catch {}
  process.exit(1);
});
