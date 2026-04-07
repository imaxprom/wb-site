/**
 * SQLite storage for reviews module (accounts, reviews, stats).
 * Uses the existing finance.db database.
 */

import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "finance.db");

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH, { readonly: false });
    db.pragma("journal_mode = WAL");
  }
  return db;
}

// ─── Types ───────────────────────────────────────────────────

export interface ReviewAccount {
  id: number;
  name: string;
  store_name: string | null;
  inn: string | null;
  supplier_id: string | null;
  api_key: string;
  cookie_status: string;
  api_status: string;
  auto_replies: number;
  auto_dialogs: number;
  auto_complaints: number;
  use_auto_proxy: number;
  settings_json: string | null;
  wb_authorize_v3: string | null;
  wb_validation_key: string | null;
  wb_cookie_updated_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Review {
  id: number;
  account_id: number;
  wb_review_id: string | null;
  date: string;
  rating: number;
  product_name: string | null;
  product_article: string | null;
  brand: string | null;
  review_text: string | null;
  pros: string | null;
  cons: string | null;
  buyer_name: string | null;
  buyer_chat_id: string | null;
  price: number | null;
  status: string;
  complaint_status: string | null;
  is_hidden: number;
  is_updated: number;
  is_excluded_rating: number;
  purchase_type: string | null;
  store_name: string | null;
  pickup_point: string | null;
  comment: string | null;
  created_at: string;
}

export interface ReviewComplaint {
  id: number;
  review_id: number;
  account_id: number;
  wb_review_id: string;
  complaint_reason_id: number;
  explanation: string | null;
  status: string; // pending → submitted → approved / rejected / error
  error_message: string | null;
  manager_name: string | null;
  created_at: string;
  submitted_at: string | null;
  resolved_at: string | null;
}

export interface ReviewStat {
  date: string;
  total_reviews: number;
  negative_reviews: number;
  complaints: number;
}

// ─── Init ────────────────────────────────────────────────────

export function initReviewTables(): void {
  const d = getDb();

  d.exec(`
    CREATE TABLE IF NOT EXISTS review_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      store_name TEXT,
      inn TEXT,
      supplier_id TEXT,
      api_key TEXT NOT NULL,
      cookie_status TEXT DEFAULT 'inactive',
      api_status TEXT DEFAULT 'inactive',
      auto_replies INTEGER DEFAULT 0,
      auto_dialogs INTEGER DEFAULT 0,
      auto_complaints INTEGER DEFAULT 0,
      use_auto_proxy INTEGER DEFAULT 1,
      settings_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migrate: add cabinet auth columns
  try {
    d.exec(`ALTER TABLE review_accounts ADD COLUMN wb_authorize_v3 TEXT`);
  } catch { /* already exists */ }
  try {
    d.exec(`ALTER TABLE review_accounts ADD COLUMN wb_validation_key TEXT`);
  } catch { /* already exists */ }
  try {
    d.exec(`ALTER TABLE review_accounts ADD COLUMN wb_cookie_updated_at DATETIME`);
  } catch { /* already exists */ }
  try {
    d.exec(`ALTER TABLE review_accounts ADD COLUMN wb_seller_lk TEXT`);
  } catch { /* already exists */ }

  d.exec(`
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER REFERENCES review_accounts(id),
      wb_review_id TEXT UNIQUE,
      date DATETIME,
      rating INTEGER,
      product_name TEXT,
      product_article TEXT,
      brand TEXT,
      review_text TEXT,
      pros TEXT,
      cons TEXT,
      buyer_name TEXT,
      buyer_chat_id TEXT,
      price REAL,
      status TEXT DEFAULT 'new',
      complaint_status TEXT,
      is_hidden INTEGER DEFAULT 0,
      is_updated INTEGER DEFAULT 0,
      is_excluded_rating INTEGER DEFAULT 0,
      purchase_type TEXT,
      store_name TEXT,
      pickup_point TEXT,
      comment TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migrate: add shk_id and order_date for price/pickup enrichment
  try {
    d.exec(`ALTER TABLE reviews ADD COLUMN shk_id INTEGER`);
  } catch { /* already exists */ }
  try {
    d.exec(`ALTER TABLE reviews ADD COLUMN order_date DATETIME`);
  } catch { /* already exists */ }
  try {
    d.exec(`ALTER TABLE reviews ADD COLUMN bables TEXT`);
  } catch { /* already exists */ }

  d.exec(`
    CREATE TABLE IF NOT EXISTS review_complaints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      review_id INTEGER REFERENCES reviews(id),
      account_id INTEGER REFERENCES review_accounts(id),
      wb_review_id TEXT NOT NULL,
      complaint_reason_id INTEGER NOT NULL,
      explanation TEXT,
      status TEXT DEFAULT 'pending',
      error_message TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      submitted_at DATETIME,
      resolved_at DATETIME
    )
  `);

  // Migrate: add manager_name to review_complaints
  try {
    d.exec(`ALTER TABLE review_complaints ADD COLUMN manager_name TEXT`);
  } catch { /* already exists */ }

  d.exec(`
    CREATE TABLE IF NOT EXISTS review_stats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      account_id INTEGER REFERENCES review_accounts(id),
      date DATE,
      total_reviews INTEGER DEFAULT 0,
      negative_reviews INTEGER DEFAULT 0,
      complaints INTEGER DEFAULT 0,
      UNIQUE(account_id, date)
    )
  `);
}

// Initialize once at module load
initReviewTables();

// ─── Sync Status ────────────────────────────────────────────

export interface SyncStatus {
  status: "idle" | "syncing" | "done" | "error";
  total: number;
  loaded: number;
  message: string;
}

function initSyncStatusTable(): void {
  const d = getDb();
  d.exec(`
    CREATE TABLE IF NOT EXISTS sync_status (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      status TEXT NOT NULL DEFAULT 'idle',
      total INTEGER NOT NULL DEFAULT 0,
      loaded INTEGER NOT NULL DEFAULT 0,
      message TEXT NOT NULL DEFAULT '',
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Ensure default row exists
  d.prepare(`INSERT OR IGNORE INTO sync_status (id, status, total, loaded, message) VALUES (1, 'idle', 0, 0, '')`).run();
}

export function setSyncStatusDb(patch: Partial<SyncStatus>): void {
  const d = getDb();
  initSyncStatusTable();
  const fields: string[] = [];
  const values: unknown[] = [];
  if (patch.status !== undefined) { fields.push("status = ?"); values.push(patch.status); }
  if (patch.total !== undefined) { fields.push("total = ?"); values.push(patch.total); }
  if (patch.loaded !== undefined) { fields.push("loaded = ?"); values.push(patch.loaded); }
  if (patch.message !== undefined) { fields.push("message = ?"); values.push(patch.message); }
  if (fields.length === 0) return;
  fields.push("updated_at = CURRENT_TIMESTAMP");
  d.prepare(`UPDATE sync_status SET ${fields.join(", ")} WHERE id = 1`).run(...values);
}

export function getSyncStatusDb(): SyncStatus {
  const d = getDb();
  initSyncStatusTable();
  const row = d.prepare(`SELECT status, total, loaded, message FROM sync_status WHERE id = 1`).get() as SyncStatus;
  return row;
}

// ─── Accounts CRUD ───────────────────────────────────────────

export function getReviewAccounts(): ReviewAccount[] {
  const d = getDb();

  return d.prepare(`SELECT * FROM review_accounts ORDER BY id`).all() as ReviewAccount[];
}

export function getReviewAccountById(id: number): ReviewAccount | null {
  const d = getDb();

  return (d.prepare(`SELECT * FROM review_accounts WHERE id = ?`).get(id) as ReviewAccount) || null;
}

export function createReviewAccount(data: { name: string; api_key: string; store_name?: string; inn?: string; supplier_id?: string }): number {
  const d = getDb();

  const result = d.prepare(`
    INSERT INTO review_accounts (name, api_key, store_name, inn, supplier_id)
    VALUES (?, ?, ?, ?, ?)
  `).run(data.name, data.api_key, data.store_name || null, data.inn || null, data.supplier_id || null);
  return result.lastInsertRowid as number;
}

export function updateReviewAccount(id: number, data: Partial<ReviewAccount>): void {
  const d = getDb();

  const fields: string[] = [];
  const values: unknown[] = [];

  const allowed = [
    "name", "store_name", "inn", "supplier_id", "api_key",
    "cookie_status", "api_status", "auto_replies", "auto_dialogs",
    "auto_complaints", "use_auto_proxy", "settings_json",
    "wb_authorize_v3", "wb_validation_key",
  ] as const;

  for (const key of allowed) {
    if (key in data) {
      fields.push(`${key} = ?`);
      values.push((data as Record<string, unknown>)[key]);
    }
  }

  // Auto-update wb_cookie_updated_at when cabinet tokens change
  if ("wb_authorize_v3" in data || "wb_validation_key" in data) {
    fields.push("wb_cookie_updated_at = CURRENT_TIMESTAMP");
  }

  if (fields.length === 0) return;
  fields.push("updated_at = CURRENT_TIMESTAMP");
  values.push(id);

  d.prepare(`UPDATE review_accounts SET ${fields.join(", ")} WHERE id = ?`).run(...values);
}

export function deleteReviewAccount(id: number): void {
  const d = getDb();

  d.prepare(`DELETE FROM reviews WHERE account_id = ?`).run(id);
  d.prepare(`DELETE FROM review_stats WHERE account_id = ?`).run(id);
  d.prepare(`DELETE FROM review_accounts WHERE id = ?`).run(id);
}

// ─── Reviews CRUD ────────────────────────────────────────────

export interface ReviewFilters {
  account_id?: number;
  date_from?: string;
  date_to?: string;
  rating?: number | string;
  status?: string;
  complaint_status?: string;
  is_hidden?: number;
  is_updated?: number;
  is_excluded_rating?: number;
  purchase_type?: string;
  search_product?: string;
  search_article?: string;
  search_text?: string;
  search_buyer?: string;
  search_comment?: string;
  wb_review_id?: string;
  buyer_chat_id?: string;
  page?: number;
  per_page?: number;
  sort_by?: string;
  sort_dir?: "asc" | "desc";
}

export function getReviews(filters: ReviewFilters): { rows: Review[]; total: number } {
  const d = getDb();


  const where: string[] = ["1=1"];
  const params: unknown[] = [];

  if (filters.account_id) { where.push("account_id = ?"); params.push(filters.account_id); }
  if (filters.date_from) { where.push("date >= ?"); params.push(filters.date_from); }
  if (filters.date_to) { where.push("date <= ?"); params.push(filters.date_to); }
  if (filters.rating) {
    const ratings = String(filters.rating).split(",").map(Number).filter(Boolean);
    if (ratings.length === 1) { where.push("rating = ?"); params.push(ratings[0]); }
    else if (ratings.length > 1) { where.push(`rating IN (${ratings.map(() => "?").join(",")})`); params.push(...ratings); }
  }
  if (filters.status) { where.push("status = ?"); params.push(filters.status); }
  if (filters.complaint_status) { where.push("complaint_status = ?"); params.push(filters.complaint_status); }
  if (filters.is_hidden !== undefined) { where.push("is_hidden = ?"); params.push(filters.is_hidden); }
  if (filters.is_updated !== undefined) { where.push("is_updated = ?"); params.push(filters.is_updated); }
  if (filters.is_excluded_rating !== undefined) { where.push("is_excluded_rating = ?"); params.push(filters.is_excluded_rating); }
  if (filters.purchase_type) { where.push("purchase_type = ?"); params.push(filters.purchase_type); }
  if (filters.wb_review_id) { where.push("wb_review_id = ?"); params.push(filters.wb_review_id); }
  if (filters.buyer_chat_id) { where.push("buyer_chat_id = ?"); params.push(filters.buyer_chat_id); }
  if (filters.search_product) { where.push("product_name LIKE ?"); params.push(`%${filters.search_product}%`); }
  if (filters.search_article) { where.push("product_article LIKE ?"); params.push(`%${filters.search_article}%`); }
  if (filters.search_text) { where.push("review_text LIKE ?"); params.push(`%${filters.search_text}%`); }
  if (filters.search_buyer) { where.push("buyer_name LIKE ?"); params.push(`%${filters.search_buyer}%`); }
  if (filters.search_comment) { where.push("comment LIKE ?"); params.push(`%${filters.search_comment}%`); }

  const whereClause = where.join(" AND ");

  const countRow = d.prepare(`SELECT COUNT(*) as cnt FROM reviews WHERE ${whereClause}`).get(...params) as { cnt: number };
  const total = countRow.cnt;

  const allowedSort = ["date", "rating", "price", "status", "product_name", "buyer_name", "store_name", "pickup_point"];
  const sortBy = allowedSort.includes(filters.sort_by || "") ? filters.sort_by : "date";
  const sortDir = filters.sort_dir === "asc" ? "ASC" : "DESC";
  const perPage = filters.per_page || 25;
  const page = filters.page || 1;
  const offset = (page - 1) * perPage;

  const rows = d.prepare(`
    SELECT * FROM reviews WHERE ${whereClause}
    ORDER BY ${sortBy} ${sortDir}
    LIMIT ? OFFSET ?
  `).all(...params, perPage, offset) as Review[];

  return { rows, total };
}

export function getReviewsCount(accountId?: number): number {
  const d = getDb();

  if (accountId) {
    const row = d.prepare(`SELECT COUNT(*) as cnt FROM reviews WHERE account_id = ?`).get(accountId) as { cnt: number };
    return row.cnt;
  }
  const row = d.prepare(`SELECT COUNT(*) as cnt FROM reviews`).get() as { cnt: number };
  return row.cnt;
}

export function getReviewById(id: number): Review | null {
  const d = getDb();

  return (d.prepare(`SELECT * FROM reviews WHERE id = ?`).get(id) as Review) || null;
}

export function updateReviewStatus(id: number, status: string): void {
  const d = getDb();

  d.prepare(`UPDATE reviews SET status = ? WHERE id = ?`).run(status, id);
}

// ─── Stats ───────────────────────────────────────────────────

export function getReviewStats(accountId?: number, period?: string): ReviewStat[] {
  const d = getDb();


  let dateFrom: string;
  let groupExpr: string;

  if (period === "year") {
    dateFrom = "date('now', '-365 days')";
    groupExpr = "strftime('%Y-%W', date)"; // по неделям
  } else if (period === "half") {
    dateFrom = "date('now', '-180 days')";
    groupExpr = "strftime('%Y-%W', date)"; // по неделям
  } else {
    dateFrom = "date('now', '-30 days')";
    groupExpr = "date(date)"; // по дням
  }

  const accountFilter = accountId ? "AND account_id = ?" : "";
  const params = accountId ? [accountId] : [];

  const rows = d.prepare(`
    SELECT
      MIN(date(date)) as date,
      COUNT(*) as total_reviews,
      SUM(CASE WHEN rating <= 3 THEN 1 ELSE 0 END) as negative_reviews,
      SUM(CASE WHEN complaint_status IS NOT NULL THEN 1 ELSE 0 END) as complaints
    FROM reviews
    WHERE date >= ${dateFrom} ${accountFilter}
    GROUP BY ${groupExpr}
    ORDER BY date
  `).all(...params) as ReviewStat[];

  return rows;
}

export interface ComplaintStat {
  date: string;
  submitted: number;
  approved: number;
}

export function getComplaintStats(accountId?: number, period?: string): ComplaintStat[] {
  const d = getDb();


  let dateFrom: string;
  let groupExpr: string;

  if (period === "year") {
    dateFrom = "date('now', '-365 days')";
    groupExpr = "strftime('%Y-%W', created_at)";
  } else if (period === "half") {
    dateFrom = "date('now', '-180 days')";
    groupExpr = "strftime('%Y-%W', created_at)";
  } else {
    dateFrom = "date('now', '-30 days')";
    groupExpr = "date(created_at)";
  }

  const accountFilter = accountId ? "AND account_id = ?" : "";
  const params = accountId ? [accountId] : [];

  const rows = d.prepare(`
    SELECT
      MIN(date(created_at)) as date,
      COUNT(DISTINCT wb_review_id) as submitted,
      COUNT(DISTINCT CASE WHEN status = 'approved' THEN wb_review_id END) as approved
    FROM review_complaints
    WHERE status IN ('submitted', 'approved', 'rejected') AND created_at >= ${dateFrom} ${accountFilter}
    GROUP BY ${groupExpr}
    ORDER BY date
  `).all(...params) as ComplaintStat[];

  return rows;
}

// ─── Ensure real account ─────────────────────────────────────

/**
 * Ensures the real WB account exists in DB.
 * On first run reads the API key from the provided token and creates the account.
 * Returns the account.
 */
export function ensureDefaultAccount(apiKey: string): ReviewAccount {
  const d = getDb();


  const existing = d.prepare(`SELECT * FROM review_accounts WHERE supplier_id = '1166225'`).get() as ReviewAccount | undefined;
  if (existing) {
    // Update API key if it changed
    if (existing.api_key !== apiKey) {
      d.prepare(`UPDATE review_accounts SET api_key = ?, api_status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(apiKey, existing.id);
      return { ...existing, api_key: apiKey, api_status: "active" };
    }
    return existing;
  }

  const result = d.prepare(`
    INSERT INTO review_accounts (name, store_name, inn, supplier_id, api_key, cookie_status, api_status, auto_replies, auto_dialogs, auto_complaints)
    VALUES ('ИП Белякова А. Л.', 'IMSI', '650601987615', '1166225', ?, 'inactive', 'active', 0, 0, 0)
  `).run(apiKey);

  return d.prepare(`SELECT * FROM review_accounts WHERE id = ?`).get(result.lastInsertRowid) as ReviewAccount;
}

/**
 * Returns the API key for the default account from DB, or null if not found.
 */
export function getDefaultAccountApiKey(): string | null {
  const d = getDb();

  const row = d.prepare(`SELECT api_key FROM review_accounts WHERE supplier_id = '1166225'`).get() as { api_key: string } | undefined;
  return row?.api_key ?? null;
}

// ─── WB Review Upsert ───────────────────────────────────────

export interface WBFeedback {
  id: string;
  text: string;
  productValuation: number;
  createdDate: string;
  updatedDate?: string;
  pros?: string;
  cons?: string;
  productDetails?: {
    nmId?: number;
    productName?: string;
    brandName?: string;
    supplierArticle?: string;
  };
  userName?: string;
  matchingSize?: string;
  isAnswered?: boolean;
  wasViewed?: boolean;
  answer?: { text?: string } | null;
  photoLinks?: { fullSize?: string }[];
  video?: { url?: string } | null;
  orderStatus?: string;
  lastOrderShkId?: number;
  lastOrderCreatedAt?: string;
  bables?: string[] | null;
}

export function upsertReviewsFromWB(accountId: number, feedbacks: WBFeedback[]): number {
  const d = getDb();


  const stmt = d.prepare(`
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
  const run = d.transaction(() => {
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
  });
  run();

  return count;
}

// ─── Enrichment (price + pickup from Statistics API) ────────

/**
 * Returns reviews that have shk_id but no price/pickup_point yet.
 * Groups by min/max order_date for efficient Statistics API queries.
 */
export function getReviewsForEnrichment(accountId: number): { shk_id: number; id: number }[] {
  const d = getDb();

  return d.prepare(`
    SELECT id, shk_id FROM reviews
    WHERE account_id = ? AND shk_id IS NOT NULL AND (price IS NULL OR pickup_point IS NULL)
      AND order_date >= date('now', '-90 days')
    LIMIT 50000
  `).all(accountId) as { shk_id: number; id: number }[];
}

/**
 * Returns the date range of reviews needing enrichment.
 */
export function getEnrichmentDateRange(accountId: number): { min_date: string | null; max_date: string | null } {
  const d = getDb();

  return d.prepare(`
    SELECT MIN(order_date) as min_date, MAX(order_date) as max_date FROM reviews
    WHERE account_id = ? AND shk_id IS NOT NULL AND (price IS NULL OR pickup_point IS NULL)
  `).get(accountId) as { min_date: string | null; max_date: string | null };
}

/**
 * Batch update price and pickup_point by shk_id.
 */
export function enrichReviewsByShkId(enrichments: { shk_id: number; price: number; pickup_point: string }[]): number {
  const d = getDb();

  const stmt = d.prepare(`
    UPDATE reviews SET price = ?, pickup_point = ? WHERE shk_id = ? AND (price IS NULL OR pickup_point IS NULL)
  `);
  let count = 0;
  const run = d.transaction(() => {
    for (const e of enrichments) {
      const res = stmt.run(e.price, e.pickup_point, e.shk_id);
      count += res.changes;
    }
  });
  run();
  return count;
}

/**
 * Count reviews that have price filled.
 */
export function getEnrichedCount(): number {
  const d = getDb();

  const row = d.prepare(`SELECT COUNT(*) as cnt FROM reviews WHERE price IS NOT NULL AND price > 0`).get() as { cnt: number };
  return row.cnt;
}

/**
 * Remove old demo data (reviews with wb_review_id starting with 'WB-')
 */
export function cleanDemoData(): void {
  const d = getDb();

  d.prepare(`DELETE FROM reviews WHERE wb_review_id LIKE 'WB-%'`).run();
  d.prepare(`DELETE FROM review_accounts WHERE api_key = 'demo-api-key-xxx'`).run();
}

// ─── Complaints ─────────────────────────────────────────────

export function createComplaint(data: {
  review_id: number;
  account_id: number;
  wb_review_id: string;
  complaint_reason_id: number;
  explanation?: string;
  manager_name?: string;
}): number {
  const d = getDb();

  const result = d.prepare(`
    INSERT INTO review_complaints (review_id, account_id, wb_review_id, complaint_reason_id, explanation, manager_name)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(data.review_id, data.account_id, data.wb_review_id, data.complaint_reason_id, data.explanation || null, data.manager_name || null);
  return result.lastInsertRowid as number;
}

export function getLastComplaintByManager(accountId: number, managerName: string): string | null {
  const d = getDb();

  const row = d.prepare(`
    SELECT explanation FROM review_complaints
    WHERE account_id = ? AND manager_name = ? AND explanation IS NOT NULL
    ORDER BY id DESC LIMIT 1
  `).get(accountId, managerName) as { explanation: string } | undefined;
  return row?.explanation || null;
}

export function updateComplaintStatus(id: number, status: string, errorMessage?: string): void {
  const d = getDb();

  if (status === "submitted") {
    d.prepare(`UPDATE review_complaints SET status = ?, submitted_at = CURRENT_TIMESTAMP WHERE id = ?`).run(status, id);
  } else if (status === "approved" || status === "rejected") {
    d.prepare(`UPDATE review_complaints SET status = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?`).run(status, id);
  } else if (status === "error") {
    d.prepare(`UPDATE review_complaints SET status = ?, error_message = ? WHERE id = ?`).run(status, errorMessage || null, id);
  } else {
    d.prepare(`UPDATE review_complaints SET status = ? WHERE id = ?`).run(status, id);
  }
}

export function updateReviewComplaintStatus(reviewId: number, complaintStatus: string): void {
  const d = getDb();

  d.prepare(`UPDATE reviews SET complaint_status = ? WHERE id = ?`).run(complaintStatus, reviewId);
}

export function getComplaintsForSubmission(accountId: number): ReviewComplaint[] {
  const d = getDb();

  return d.prepare(`
    SELECT * FROM review_complaints
    WHERE account_id = ? AND status = 'pending'
    ORDER BY created_at ASC
  `).all(accountId) as ReviewComplaint[];
}

export function getComplaintsByAccount(accountId?: number, status?: string): ReviewComplaint[] {
  const d = getDb();

  const where: string[] = ["1=1"];
  const params: unknown[] = [];
  if (accountId) { where.push("account_id = ?"); params.push(accountId); }
  if (status) { where.push("status = ?"); params.push(status); }
  return d.prepare(`
    SELECT * FROM review_complaints
    WHERE ${where.join(" AND ")}
    ORDER BY created_at DESC
    LIMIT 500
  `).all(...params) as ReviewComplaint[];
}

export function getComplaintByReviewId(reviewId: number): ReviewComplaint | null {
  const d = getDb();

  return (d.prepare(`SELECT * FROM review_complaints WHERE review_id = ? ORDER BY created_at DESC LIMIT 1`).get(reviewId) as ReviewComplaint) || null;
}

export function getTodayComplaintsCount(accountId: number): number {
  const d = getDb();

  const row = d.prepare(`
    SELECT COUNT(*) as cnt FROM review_complaints
    WHERE account_id = ? AND date(created_at) = date('now')
  `).get(accountId) as { cnt: number };
  return row.cnt;
}

/**
 * Reviews eligible for auto-complaint: matching ratings, no existing complaint, not hidden/excluded.
 */
export function getReviewsForAutoComplaint(accountId: number, ratings: number[], excludedArticles: string[]): Review[] {
  const d = getDb();


  const ratingPlaceholders = ratings.map(() => "?").join(",");
  const params: unknown[] = [accountId];
  params.push(...ratings);

  let excludeClause = "";
  if (excludedArticles.length > 0) {
    const artPlaceholders = excludedArticles.map(() => "?").join(",");
    excludeClause = `AND product_article NOT IN (${artPlaceholders})`;
    params.push(...excludedArticles);
  }

  return d.prepare(`
    SELECT * FROM reviews
    WHERE account_id = ?
      AND rating IN (${ratingPlaceholders})
      AND complaint_status IS NULL
      AND is_hidden = 0
      AND is_excluded_rating = 0
      AND wb_review_id IS NOT NULL
      ${excludeClause}
    ORDER BY date DESC
  `).all(...params) as Review[];
}
