import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "finance.db");

function getDb() {
  const db = new Database(DB_PATH);
  db.pragma("busy_timeout = 5000");
  db.pragma("journal_mode = WAL");
  return db;
}

const DEFAULTS = { ndsRate: 5, usnRate: 1 };

/**
 * GET /api/finance/tax-settings
 */
export async function GET(request: NextRequest) {
  const authError = requireAdmin(request);
  if (authError) return authError;

  try {
    const db = getDb();
    // Ensure table exists
    db.exec(`CREATE TABLE IF NOT EXISTS tax_settings (key TEXT PRIMARY KEY, value REAL)`);
    const rows = db.prepare("SELECT key, value FROM tax_settings").all() as { key: string; value: number }[];
    db.close();
    const result: Record<string, number> = { ...DEFAULTS };
    for (const r of rows) result[r.key] = r.value;
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}

/**
 * PUT /api/finance/tax-settings
 * Body: { ndsRate: number, usnRate: number }
 */
export async function PUT(request: NextRequest) {
  const authError = requireAdmin(request);
  if (authError) return authError;

  try {
    const body = await request.json() as Record<string, number>;
    const db = getDb();
    db.exec(`CREATE TABLE IF NOT EXISTS tax_settings (key TEXT PRIMARY KEY, value REAL)`);
    const upsert = db.prepare("INSERT INTO tax_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?");
    const tx = db.transaction(() => {
      for (const [key, value] of Object.entries(body)) {
        if (typeof value === "number") {
          upsert.run(key, value, value);
        }
      }
    });
    tx();
    db.close();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
