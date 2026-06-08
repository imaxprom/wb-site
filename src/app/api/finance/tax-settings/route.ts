import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { isPostgresReadonlyConnection, pgGet, pgRows } from "@/lib/postgres";

const DEFAULTS = { ndsRate: 5, usnRate: 1 };

async function tableExistsPg(tableName: string): Promise<boolean> {
  const row = await pgGet<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ?
    ) AS exists
  `, [tableName]);
  return Boolean(row?.exists);
}

/**
 * GET /api/finance/tax-settings
 */
export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const result: Record<string, number> = { ...DEFAULTS };
    if (!await tableExistsPg("tax_settings")) {
      return NextResponse.json(result);
    }

    const rows = await pgRows<{ key: string; value: number }>("SELECT key, value FROM tax_settings");
    for (const r of rows) result[r.key] = Number(r.value) || 0;
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
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    if (isPostgresReadonlyConnection()) {
      return NextResponse.json(
        { error: "Tax settings writes are disabled in local PostgreSQL readonly mode" },
        { status: 403 }
      );
    }

    const body = await request.json() as Record<string, number>;
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === "number") {
        await pgGet(`
          INSERT INTO tax_settings (key, value)
          VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value
          RETURNING key
        `, [key, value]);
      }
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
