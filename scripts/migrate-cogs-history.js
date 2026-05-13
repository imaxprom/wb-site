#!/usr/bin/env node
const Database = require("better-sqlite3");
const path = require("path");

const dbPath = process.env.FINANCE_DB_PATH || path.join(process.cwd(), "data", "finance.db");
const db = new Database(dbPath);
db.pragma("busy_timeout = 5000");
db.pragma("journal_mode = WAL");

function todayMsk() {
  const dt = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return dt.toISOString().slice(0, 10);
}

function tableExists(tableName) {
  return Boolean(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName)
  );
}

db.exec(`
  CREATE TABLE IF NOT EXISTS cogs_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    barcode TEXT NOT NULL,
    cost REAL NOT NULL,
    valid_from TEXT NOT NULL,
    valid_to TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_cogs_history_lookup
    ON cogs_history(barcode, valid_from, valid_to);
`);

if (!tableExists("cogs")) {
  console.log("[migrate-cogs-history] cogs table is absent; nothing to migrate");
  db.close();
  process.exit(0);
}

const fallbackDate = todayMsk();
const insert = db.prepare(`
  INSERT INTO cogs_history (barcode, cost, valid_from, valid_to)
  VALUES (?, ?, ?, NULL)
`);
const firstSale = db.prepare(`
  SELECT MIN(sale_dt) AS first_sale
  FROM realization
  WHERE barcode = ?
    AND supplier_oper_name = 'Продажа'
    AND sale_dt IS NOT NULL
    AND sale_dt != ''
`);
const hasHistory = db.prepare("SELECT 1 FROM cogs_history WHERE barcode = ? LIMIT 1");
const currentRows = db.prepare(`
  SELECT barcode, cost
  FROM cogs
  WHERE barcode IS NOT NULL
    AND barcode != ''
    AND cost IS NOT NULL
`).all();

let inserted = 0;
const tx = db.transaction(() => {
  for (const row of currentRows) {
    if (hasHistory.get(row.barcode)) continue;
    const sale = firstSale.get(row.barcode);
    insert.run(row.barcode, row.cost, sale?.first_sale || fallbackDate);
    inserted++;
  }
});

tx();
console.log(`[migrate-cogs-history] checked=${currentRows.length} inserted=${inserted}`);
db.close();
