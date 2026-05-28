import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import Database from "better-sqlite3";
import path from "path";
import { isPostgresEnabled, pgRows, withPgTransaction } from "@/lib/postgres";
import { localReadonlyGuard } from "@/lib/local-readonly-guard";
import type { PoolClient } from "pg";

const DB_PATH = path.join(process.cwd(), "data", "finance.db");

interface CogsHistoryRow {
  barcode: string;
  cost: number;
  valid_from: string;
  valid_to: string | null;
}

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

async function ensureCogsHistoryPg(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS cogs_history (
      id SERIAL PRIMARY KEY,
      barcode TEXT NOT NULL,
      cost DOUBLE PRECISION NOT NULL,
      valid_from TEXT NOT NULL,
      valid_to TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS idx_cogs_history_lookup
      ON cogs_history(barcode, valid_from, valid_to)
  `);

  const { rows } = await client.query<{ barcode: string; cost: number }>(`
    SELECT barcode, cost
    FROM cogs
    WHERE barcode IS NOT NULL
      AND barcode != ''
      AND cost IS NOT NULL
  `);
  const fallbackDate = todayMsk();

  for (const row of rows) {
    const exists = await client.query("SELECT 1 FROM cogs_history WHERE barcode = $1 LIMIT 1", [row.barcode]);
    if (exists.rowCount) continue;

    const sale = await client.query<{ first_sale: string | null }>(`
      SELECT MIN(sale_dt) AS first_sale
      FROM realization
      WHERE barcode = $1
        AND supplier_oper_name = 'Продажа'
        AND sale_dt IS NOT NULL
        AND sale_dt != ''
    `, [row.barcode]);
    await client.query(`
      INSERT INTO cogs_history (barcode, cost, valid_from, valid_to)
      VALUES ($1, $2, $3, NULL)
    `, [row.barcode, row.cost, sale.rows[0]?.first_sale || fallbackDate]);
  }
}

function upsertHistory(db: Database.Database, barcode: string, cost: number, validFrom: string) {
  const previous = db.prepare(`
    SELECT id, valid_from
    FROM cogs_history
    WHERE barcode = ?
      AND valid_from < ?
      AND (valid_to IS NULL OR valid_to >= ?)
    ORDER BY valid_from DESC
    LIMIT 1
  `).get(barcode, validFrom, validFrom) as { id: number; valid_from: string } | undefined;

  if (previous) {
    db.prepare("UPDATE cogs_history SET valid_to = ? WHERE id = ?")
      .run(shiftDays(validFrom, -1), previous.id);
  }

  db.prepare("DELETE FROM cogs_history WHERE barcode = ? AND valid_from >= ?")
    .run(barcode, validFrom);

  db.prepare(`
    INSERT INTO cogs_history (barcode, cost, valid_from, valid_to)
    VALUES (?, ?, ?, NULL)
  `).run(barcode, cost, validFrom);
}

async function upsertHistoryPg(client: PoolClient, barcode: string, cost: number, validFrom: string) {
  const previous = await client.query<{ id: number; valid_from: string }>(`
    SELECT id, valid_from
    FROM cogs_history
    WHERE barcode = $1
      AND valid_from < $2
      AND (valid_to IS NULL OR valid_to >= $2)
    ORDER BY valid_from DESC
    LIMIT 1
  `, [barcode, validFrom]);

  if (previous.rows[0]) {
    await client.query(
      "UPDATE cogs_history SET valid_to = $1 WHERE id = $2",
      [shiftDays(validFrom, -1), previous.rows[0].id]
    );
  }

  await client.query("DELETE FROM cogs_history WHERE barcode = $1 AND valid_from >= $2", [barcode, validFrom]);

  await client.query(`
    INSERT INTO cogs_history (barcode, cost, valid_from, valid_to)
    VALUES ($1, $2, $3, NULL)
  `, [barcode, cost, validFrom]);
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

async function closeHistoryPg(client: PoolClient, barcode: string, validFrom: string) {
  const active = await client.query<{ id: number; valid_from: string }>(`
    SELECT id, valid_from
    FROM cogs_history
    WHERE barcode = $1 AND valid_to IS NULL
    ORDER BY valid_from DESC
    LIMIT 1
  `, [barcode]);
  const row = active.rows[0];
  if (!row) return;

  if (row.valid_from >= validFrom) {
    await client.query("DELETE FROM cogs_history WHERE id = $1", [row.id]);
    return;
  }

  await client.query(
    "UPDATE cogs_history SET valid_to = $1 WHERE id = $2",
    [shiftDays(validFrom, -1), row.id]
  );
}

function getFirstSaleDate(db: Database.Database, barcode: string): string | null {
  const row = db.prepare(`
    SELECT MIN(sale_dt) AS first_sale
    FROM realization
    WHERE barcode = ?
      AND supplier_oper_name = 'Продажа'
      AND sale_dt IS NOT NULL
      AND sale_dt != ''
  `).get(barcode) as { first_sale: string | null } | undefined;
  return row?.first_sale || null;
}

async function getFirstSaleDatePg(client: PoolClient, barcode: string): Promise<string | null> {
  const row = await client.query<{ first_sale: string | null }>(`
    SELECT MIN(sale_dt) AS first_sale
    FROM realization
    WHERE barcode = $1
      AND supplier_oper_name = 'Продажа'
      AND sale_dt IS NOT NULL
      AND sale_dt != ''
  `, [barcode]);
  return row.rows[0]?.first_sale || null;
}

function resolveValidFrom(
  db: Database.Database,
  barcode: string,
  mode: string | undefined,
  validFrom: string | undefined
): string {
  if (mode === "first_sale") {
    return getFirstSaleDate(db, barcode) || todayMsk();
  }
  if (mode === "custom" && validFrom && /^\d{4}-\d{2}-\d{2}$/.test(validFrom)) {
    return validFrom;
  }
  return todayMsk();
}

async function resolveValidFromPg(
  client: PoolClient,
  barcode: string,
  mode: string | undefined,
  validFrom: string | undefined
): Promise<string> {
  if (mode === "first_sale") {
    return await getFirstSaleDatePg(client, barcode) || todayMsk();
  }
  if (mode === "custom" && validFrom && /^\d{4}-\d{2}-\d{2}$/.test(validFrom)) {
    return validFrom;
  }
  return todayMsk();
}

function isValidDateString(value: string | undefined): value is string {
  return Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
}

/**
 * GET /api/finance/cogs — list all barcode costs
 */
export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { searchParams } = new URL(request.url);
    if (searchParams.get("history") === "true") {
      if (isPostgresEnabled()) {
        const barcode = String(searchParams.get("barcode") || "").trim();
        if (!barcode) {
          return NextResponse.json({ error: "barcode required" }, { status: 400 });
        }
        const rows = await pgRows<CogsHistoryRow & { created_at: string }>(`
          SELECT barcode, cost, valid_from, valid_to, created_at
          FROM cogs_history
          WHERE barcode = ?
          ORDER BY valid_from DESC, id DESC
        `, [barcode]);
        return NextResponse.json(rows);
      }

      const d = getWriteDb();
      ensureCogsHistory(d);
      const barcode = String(searchParams.get("barcode") || "").trim();
      if (!barcode) {
        d.close();
        return NextResponse.json({ error: "barcode required" }, { status: 400 });
      }
      const rows = d.prepare(`
        SELECT barcode, cost, valid_from, valid_to, created_at
        FROM cogs_history
        WHERE barcode = ?
        ORDER BY valid_from DESC, id DESC
      `).all(barcode);
      d.close();
      return NextResponse.json(rows);
    }

    if (isPostgresEnabled()) {
      const rows = await pgRows<{ barcode: string; cost: number }>(
        "SELECT barcode, cost FROM cogs ORDER BY barcode"
      );
      return NextResponse.json(rows);
    }

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
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const readonlyError = localReadonlyGuard("COGS updates");
  if (readonlyError) return readonlyError;

  try {
    const body = await request.json() as Record<string, number>;

    if (isPostgresEnabled()) {
      await withPgTransaction(async (client) => {
        await ensureCogsHistoryPg(client);
        const existingRows = await client.query<{ barcode: string; cost: number }>("SELECT barcode, cost FROM cogs");
        const existing = new Map(existingRows.rows.map((row) => [row.barcode, row.cost]));
        const today = todayMsk();

        for (const barcode of existing.keys()) {
          if (Object.prototype.hasOwnProperty.call(body, barcode)) continue;
          await client.query("DELETE FROM cogs WHERE barcode = $1", [barcode]);
          await closeHistoryPg(client, barcode, today);
        }

        for (const [barcode, cost] of Object.entries(body)) {
          const normalized = Number(cost);
          if (cost === null || cost === undefined || Number.isNaN(normalized)) {
            await client.query("DELETE FROM cogs WHERE barcode = $1", [barcode]);
            await closeHistoryPg(client, barcode, today);
            continue;
          }

          await client.query(`
            INSERT INTO cogs (barcode, cost)
            VALUES ($1, $2)
            ON CONFLICT(barcode) DO UPDATE SET cost = EXCLUDED.cost
          `, [barcode, normalized]);

          const previous = existing.get(barcode);
          if (previous === normalized) continue;

          const hasAnyHistory = await client.query("SELECT 1 FROM cogs_history WHERE barcode = $1 LIMIT 1", [barcode]);
          const validFrom = previous === undefined && !hasAnyHistory.rowCount
            ? await getFirstSaleDatePg(client, barcode) || today
            : today;
          await upsertHistoryPg(client, barcode, normalized, validFrom);
        }
      });

      return NextResponse.json({ ok: true, count: Object.keys(body).length });
    }

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

/**
 * PATCH /api/finance/cogs — update one barcode cost with history date mode
 * Body: { barcode, cost, applyMode: "today" | "first_sale" | "custom", validFrom? }
 */
export async function PATCH(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  const readonlyError = localReadonlyGuard("COGS history updates");
  if (readonlyError) return readonlyError;

  try {
    const body = await request.json() as {
      barcode?: string;
      cost?: number | null;
      applyMode?: "today" | "first_sale" | "custom";
      validFrom?: string;
    };

    if (isPostgresEnabled()) {
      const barcode = String(body.barcode || "").trim();
      if (!barcode) {
        return NextResponse.json({ error: "barcode required" }, { status: 400 });
      }
      if (body.applyMode === "custom" && !isValidDateString(body.validFrom)) {
        return NextResponse.json({ error: "validFrom must be YYYY-MM-DD" }, { status: 400 });
      }
      if (body.applyMode === "custom" && body.validFrom && body.validFrom > todayMsk()) {
        return NextResponse.json({ error: "validFrom cannot be in the future" }, { status: 400 });
      }

      const normalized = body.cost === null || body.cost === undefined ? null : Number(body.cost);
      let validFromResult = "";
      await withPgTransaction(async (client) => {
        await ensureCogsHistoryPg(client);
        const validFrom = await resolveValidFromPg(client, barcode, body.applyMode, body.validFrom);
        validFromResult = validFrom;

        if (normalized === null || Number.isNaN(normalized)) {
          await client.query("DELETE FROM cogs WHERE barcode = $1", [barcode]);
          await closeHistoryPg(client, barcode, validFrom);
          return;
        }

        await client.query(`
          INSERT INTO cogs (barcode, cost)
          VALUES ($1, $2)
          ON CONFLICT(barcode) DO UPDATE SET cost = EXCLUDED.cost
        `, [barcode, normalized]);
        await upsertHistoryPg(client, barcode, normalized, validFrom);
      });

      return NextResponse.json({ ok: true, barcode, cost: normalized, validFrom: validFromResult });
    }

    const barcode = String(body.barcode || "").trim();
    if (!barcode) {
      return NextResponse.json({ error: "barcode required" }, { status: 400 });
    }

    const db = getWriteDb();
    ensureCogsHistory(db);
    const upsert = db.prepare("INSERT INTO cogs (barcode, cost) VALUES (?, ?) ON CONFLICT(barcode) DO UPDATE SET cost = ?");
    const del = db.prepare("DELETE FROM cogs WHERE barcode = ?");
    if (body.applyMode === "custom" && !isValidDateString(body.validFrom)) {
      db.close();
      return NextResponse.json({ error: "validFrom must be YYYY-MM-DD" }, { status: 400 });
    }

    const validFrom = resolveValidFrom(db, barcode, body.applyMode, body.validFrom);
    if (validFrom > todayMsk()) {
      db.close();
      return NextResponse.json({ error: "validFrom cannot be in the future" }, { status: 400 });
    }

    const normalized = body.cost === null || body.cost === undefined ? null : Number(body.cost);

    const tx = db.transaction(() => {
      if (normalized === null || Number.isNaN(normalized)) {
        del.run(barcode);
        closeHistory(db, barcode, validFrom);
        return;
      }

      upsert.run(barcode, normalized, normalized);
      upsertHistory(db, barcode, normalized, validFrom);
    });

    tx();
    db.close();

    return NextResponse.json({ ok: true, barcode, cost: normalized, validFrom });
  } catch (error) {
    return apiError(error);
  }
}
