#!/usr/bin/env node
/**
 * Reviews auto-sync script — production cron currently runs hourly.
 * 1. Fetches new reviews (unanswered + recent answered + archive)
 * 2. Enriches with price & region from Orders API
 *
 * Usage: node scripts/reviews-sync.js
 * Or via production cron.
 */

const Database = require("better-sqlite3");
const path = require("path");

const PROJECT_DIR = path.join(__dirname, "..");
const DB_PATH = path.join(PROJECT_DIR, "data", "finance.db");
const LOG_PATH = path.join(PROJECT_DIR, "data", "reviews-sync.log");
const LOCK_PATH = path.join(PROJECT_DIR, "data", "reviews-sync.lock");
const fs = require("fs");

// ─── Logging ────────────────────────────────────────────────

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG_PATH, line + "\n"); } catch {}
}

// ─── DB helpers ─────────────────────────────────────────────

function getDb() {
  const db = new Database(DB_PATH, { readonly: false });
  db.pragma("journal_mode = WAL");
  return db;
}

function getApiKey(db) {
  const row = db.prepare(`SELECT api_key FROM review_accounts WHERE supplier_id = '1166225'`).get();
  return row?.api_key || null;
}

function getAccountId(db) {
  const row = db.prepare(`SELECT id FROM review_accounts WHERE supplier_id = '1166225'`).get();
  return row?.id || null;
}

// ─── Fetch feedbacks ────────────────────────────────────────

const WB_FEEDBACKS_URL = "https://feedbacks-api.wildberries.ru/api/v1/feedbacks";
const WB_FEEDBACKS_ARCHIVE_URL = "https://feedbacks-api.wildberries.ru/api/v1/feedbacks/archive";

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

// ─── Main ───────────────────────────────────────────────────

async function main() {
  log("=== Reviews sync started ===");
  const fullSync = process.argv.includes("--full");
  const archiveOnly = process.argv.includes("--archive-only");
  let lockFd;
  const releaseLock = () => {
    try { if (lockFd !== undefined) fs.closeSync(lockFd); } catch {}
    try { fs.rmSync(LOCK_PATH, { force: true }); } catch {}
  };
  try {
    lockFd = fs.openSync(LOCK_PATH, "wx");
    fs.writeFileSync(lockFd, String(process.pid));
  } catch {
    log("Another reviews sync is already running, exiting");
    return;
  }

  const db = getDb();
  const apiKey = getApiKey(db);
  if (!apiKey) {
    log("ERROR: No API key found");
    db.close();
    releaseLock();
    return;
  }

  const accountId = getAccountId(db);
  if (!accountId) {
    log("ERROR: No account found");
    db.close();
    releaseLock();
    return;
  }

  if (archiveOnly) {
    const pageLimit = getArgNumber("archive-pages", 3);
    const before = db.prepare(`SELECT COUNT(*) as cnt FROM reviews WHERE account_id = ?`).get(accountId).cnt;
    let fetched = 0;
    let upserted = 0;

    for (let page = 0; page < pageLimit; page++) {
      const skip = page * 5000;
      const data = await fetchWbJson(`${WB_FEEDBACKS_ARCHIVE_URL}?take=5000&skip=${skip}`, apiKey);
      const feedbacks = getFeedbacksFromResponse(data);
      fetched += feedbacks.length;
      if (feedbacks.length === 0) break;
      upserted += upsertReviews(db, accountId, feedbacks);
      const afterPage = db.prepare(`SELECT COUNT(*) as cnt FROM reviews WHERE account_id = ?`).get(accountId).cnt;
      log(`Archive page ${page + 1}/${pageLimit} skip=${skip}: fetched=${feedbacks.length}, total=${afterPage}, new=${afterPage - before}`);
      if (feedbacks.length < 5000) break;
      await sleep(1000);
    }

    const after = db.prepare(`SELECT COUNT(*) as cnt FROM reviews WHERE account_id = ?`).get(accountId).cnt;
    const withPrice = db.prepare(`SELECT COUNT(*) as cnt FROM reviews WHERE price > 0`).get().cnt;
    db.prepare(`UPDATE sync_status SET status = 'done', loaded = ?, total = ?, message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`)
      .run(after, after, `В базе: ${after.toLocaleString("ru-RU")} ✅ | Архив: +${(after - before).toLocaleString("ru-RU")} | Цена и ПВЗ: ${withPrice.toLocaleString("ru-RU")}`);
    log(`=== Archive done. Fetched: ${fetched}, upserted: ${upserted}, new: ${after - before}, total: ${after} ===`);
    db.close();
    releaseLock();
    return;
  }

  // 1. Fetch & upsert reviews
  const feedbacks = await fetchFeedbacks(apiKey, fullSync);
  log(`Fetched ${feedbacks.length} feedbacks from WB${fullSync ? " (full with archive)" : ""}`);

  if (feedbacks.length > 0) {
    const before = db.prepare(`SELECT COUNT(*) as cnt FROM reviews WHERE account_id = ?`).get(accountId).cnt;
    const upserted = upsertReviews(db, accountId, feedbacks);
    const after = db.prepare(`SELECT COUNT(*) as cnt FROM reviews WHERE account_id = ?`).get(accountId).cnt;
    const added = after - before;
    log(`Upserted ${upserted}, new: ${added}, total: ${after}`);
  }

  // 2. Enrich from Orders API
  const enriched = await enrichFromOrders(db, apiKey, accountId);
  log(`Enriched ${enriched} reviews with price & region`);

  // 3. Update sync status
  const total = db.prepare(`SELECT COUNT(*) as cnt FROM reviews`).get().cnt;
  const withPrice = db.prepare(`SELECT COUNT(*) as cnt FROM reviews WHERE price > 0`).get().cnt;
  db.prepare(`UPDATE sync_status SET status = 'done', loaded = ?, total = ?, message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1`)
    .run(total, total, `В базе: ${total.toLocaleString("ru-RU")} ✅ | Цена и ПВЗ: ${withPrice.toLocaleString("ru-RU")}`);

  log(`=== Done. Total: ${total}, with price: ${withPrice} ===`);
  db.close();
  releaseLock();
}

main().catch(e => {
  log(`FATAL: ${e.message}`);
  try { fs.rmSync(LOCK_PATH, { force: true }); } catch {}
  process.exit(1);
});
