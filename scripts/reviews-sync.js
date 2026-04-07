#!/usr/bin/env node
/**
 * Reviews auto-sync script — runs every 10 minutes.
 * 1. Fetches new reviews (incremental: unanswered + last 500 answered)
 * 2. Enriches with price & region from Orders API
 *
 * Usage: node scripts/reviews-sync.js
 * Or via cron/launchd every 10 minutes.
 */

const Database = require("better-sqlite3");
const path = require("path");

const PROJECT_DIR = path.join(__dirname, "..");
const DB_PATH = path.join(PROJECT_DIR, "data", "finance.db");
const LOG_PATH = path.join(PROJECT_DIR, "data", "reviews-sync.log");
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

async function fetchFeedbacks(apiKey) {
  const all = [];

  // 1) Unanswered
  for (let skip = 0; ; skip += 100) {
    const res = await fetch(`${WB_FEEDBACKS_URL}?isAnswered=false&take=100&skip=${skip}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) break;
    const data = await res.json();
    const fbs = data.data?.feedbacks ?? [];
    all.push(...fbs);
    if (fbs.length < 100) break;
    await new Promise(r => setTimeout(r, 350));
  }

  // 2) Last 500 answered
  const res = await fetch(`${WB_FEEDBACKS_URL}?isAnswered=true&take=500&skip=0`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (res.ok) {
    const data = await res.json();
    const fbs = data.data?.feedbacks ?? [];
    all.push(...fbs);
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

  const db = getDb();
  const apiKey = getApiKey(db);
  if (!apiKey) {
    log("ERROR: No API key found");
    db.close();
    return;
  }

  const accountId = getAccountId(db);
  if (!accountId) {
    log("ERROR: No account found");
    db.close();
    return;
  }

  // 1. Fetch & upsert reviews
  const feedbacks = await fetchFeedbacks(apiKey);
  log(`Fetched ${feedbacks.length} feedbacks from WB`);

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
}

main().catch(e => {
  log(`FATAL: ${e.message}`);
  process.exit(1);
});
