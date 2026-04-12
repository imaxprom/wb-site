import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-utils";
import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "finance.db");

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

/**
 * GET /api/finance/cogs — list all barcode costs
 */
export async function GET() {
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
  try {
    const body = await request.json() as Record<string, number>;
    const db = getWriteDb();
    const upsert = db.prepare("INSERT INTO cogs (barcode, cost) VALUES (?, ?) ON CONFLICT(barcode) DO UPDATE SET cost = ?");
    const del = db.prepare("DELETE FROM cogs WHERE barcode = ?");

    const tx = db.transaction(() => {
      for (const [barcode, cost] of Object.entries(body)) {
        if (cost === null || cost === undefined) {
          del.run(barcode);
        } else {
          upsert.run(barcode, cost, cost);
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
