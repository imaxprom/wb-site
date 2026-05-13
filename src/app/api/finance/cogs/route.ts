import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "finance.db");

function todayMsk(): string {
  const dt = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return dt.toISOString().slice(0, 10);
}

function shiftDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function getWriteDb() {
  const db = new Database(DB_PATH); db.pragma("busy_timeout = 5000");
  db.pragma("journal_mode = WAL");
  return db;
}

function getReadDb() {
  const db = new Database(DB_PATH, { readonly: true }); db.pragma("busy_timeout = 5000");
  db.pragma("journal_mode = WAL");
  return db;
}

function ensureCogsHistory(db: Database.Database) {
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

  const rows = db.prepare(`
    SELECT barcode, cost
    FROM cogs
    WHERE barcode IS NOT NULL
      AND barcode != ''
      AND cost IS NOT NULL
  `).all() as { barcode: string; cost: number }[];
  const hasHistory = db.prepare("SELECT 1 FROM cogs_history WHERE barcode = ? LIMIT 1");
  const firstSale = db.prepare(`
    SELECT MIN(sale_dt) AS first_sale
    FROM realization
    WHERE barcode = ?
      AND supplier_oper_name = 'Продажа'
      AND sale_dt IS NOT NULL
      AND sale_dt != ''
  `);
  const insert = db.prepare(`
    INSERT INTO cogs_history (barcode, cost, valid_from, valid_to)
    VALUES (?, ?, ?, NULL)
  `);
  const fallbackDate = todayMsk();

  for (const row of rows) {
    if (hasHistory.get(row.barcode)) continue;
    const sale = firstSale.get(row.barcode) as { first_sale: string | null } | undefined;
    insert.run(row.barcode, row.cost, sale?.first_sale || fallbackDate);
  }
}

function upsertHistory(db: Database.Database, barcode: string, cost: number, validFrom: string) {
  const active = db.prepare(`
    SELECT id, valid_from, cost
    FROM cogs_history
    WHERE barcode = ? AND valid_to IS NULL
    ORDER BY valid_from DESC
    LIMIT 1
  `).get(barcode) as { id: number; valid_from: string; cost: number } | undefined;

  if (active && active.valid_from >= validFrom) {
    db.prepare("UPDATE cogs_history SET cost = ?, valid_from = ? WHERE id = ?")
      .run(cost, validFrom, active.id);
    return;
  }

  if (active) {
    db.prepare("UPDATE cogs_history SET valid_to = ? WHERE id = ?")
      .run(shiftDays(validFrom, -1), active.id);
  }

  db.prepare(`
    INSERT INTO cogs_history (barcode, cost, valid_from, valid_to)
    VALUES (?, ?, ?, NULL)
  `).run(barcode, cost, validFrom);
}

function closeHistory(db: Database.Database, barcode: string, validFrom: string) {
  const active = db.prepare(`
    SELECT id, valid_from
    FROM cogs_history
    WHERE barcode = ? AND valid_to IS NULL
    ORDER BY valid_from DESC
    LIMIT 1
  `).get(barcode) as { id: number; valid_from: string } | undefined;
  if (!active) return;

  if (active.valid_from >= validFrom) {
    db.prepare("DELETE FROM cogs_history WHERE id = ?").run(active.id);
    return;
  }

  db.prepare("UPDATE cogs_history SET valid_to = ? WHERE id = ?")
    .run(shiftDays(validFrom, -1), active.id);
}

/**
 * GET /api/finance/cogs — list all barcode costs
 */
export async function GET(request: NextRequest) {
  const authError = requireAdmin(request);
  if (authError) return authError;

  try {
    const d = getReadDb();
    const rows = d.prepare("SELECT barcode, cost FROM cogs ORDER BY barcode").all();
    d.close();
    return NextResponse.json(rows);
  } catch (error) {
    return apiError(error);
  }
}

/**
 * PUT /api/finance/cogs — bulk update costs
 * Body: Record<string, number> (barcode → cost)
 */
export async function PUT(request: NextRequest) {
  const authError = requireAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json() as Record<string, number>;
    const db = getWriteDb();
    ensureCogsHistory(db);
    const existingRows = db.prepare("SELECT barcode, cost FROM cogs").all() as { barcode: string; cost: number }[];
    const existing = new Map(existingRows.map((row) => [row.barcode, row.cost]));
    const upsert = db.prepare("INSERT INTO cogs (barcode, cost) VALUES (?, ?) ON CONFLICT(barcode) DO UPDATE SET cost = ?");
    const del = db.prepare("DELETE FROM cogs WHERE barcode = ?");
    const firstSale = db.prepare(`
      SELECT MIN(sale_dt) AS first_sale
      FROM realization
      WHERE barcode = ?
        AND supplier_oper_name = 'Продажа'
        AND sale_dt IS NOT NULL
        AND sale_dt != ''
    `);
    const today = todayMsk();

    const tx = db.transaction(() => {
      for (const barcode of existing.keys()) {
        if (Object.prototype.hasOwnProperty.call(body, barcode)) continue;
        del.run(barcode);
        closeHistory(db, barcode, today);
      }

      for (const [barcode, cost] of Object.entries(body)) {
        const normalized = Number(cost);
        if (cost === null || cost === undefined || Number.isNaN(normalized)) {
          del.run(barcode);
          closeHistory(db, barcode, today);
        } else {
          upsert.run(barcode, normalized, normalized);
          const previous = existing.get(barcode);
          if (previous === normalized) continue;

          const hasAnyHistory = db
            .prepare("SELECT 1 FROM cogs_history WHERE barcode = ? LIMIT 1")
            .get(barcode);
          const sale = firstSale.get(barcode) as { first_sale: string | null } | undefined;
          const validFrom = previous === undefined && !hasAnyHistory
            ? sale?.first_sale || today
            : today;
          upsertHistory(db, barcode, normalized, validFrom);
        }
      }
    });
    tx();
    db.close();

    return NextResponse.json({ ok: true, count: Object.keys(body).length });
  } catch (error) {
    return apiError(error);
  }
}
