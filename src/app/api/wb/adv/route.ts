import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { localReadonlyGuard } from "@/lib/local-readonly-guard";
import { getWbApiKeyFromRequest } from "@/lib/wb-api-key";
import { pgRows } from "@/lib/postgres";
import { syncAdvertising } from "@/lib/sync/advertising";

function listDates(dateFrom: string, dateTo: string): string[] {
  const result: string[] = [];
  const cursor = new Date(`${dateFrom}T00:00:00Z`);
  const end = new Date(`${dateTo}T00:00:00Z`);
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end.getTime()) || cursor > end) return result;

  while (cursor <= end) {
    result.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

/**
 * POST /api/wb/adv — Fetch advertising expenses from WB API and save to DB
 *   Body: { dateFrom?: "YYYY-MM-DD", dateTo?: "YYYY-MM-DD" }
 *   Default: last 7 days
 *
 * GET /api/wb/adv — Get advertising data from local DB
 *   ?from=YYYY-MM-DD&to=YYYY-MM-DD
 */

export async function POST(req: NextRequest) {
  const authError = await requireAdmin(req);
  if (authError) return authError;
  const readonlyError = localReadonlyGuard("WB advertising sync");
  if (readonlyError) return readonlyError;

  const apiKey = getWbApiKeyFromRequest(req.headers);
  if (!apiKey) return NextResponse.json({ error: "API key missing" }, { status: 401 });

  try {
    const body = await req.json().catch(() => ({}));
    const now = new Date();
    const dateTo = body.dateTo || now.toISOString().slice(0, 10);
    const dateFrom = body.dateFrom || new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);

    const days = listDates(dateFrom, dateTo);
    const statuses = [];
    for (const day of days) {
      statuses.push({ date: day, ...(await syncAdvertising(day)) });
    }
    const byDate = Object.fromEntries(statuses.map((status) => [status.date, status.value || 0]));
    return NextResponse.json({
      ok: statuses.every((status) => status.ok),
      dateFrom,
      dateTo,
      entries: statuses.length,
      byDate,
      statuses,
    });
  } catch (err) {
    return apiError(err);
  }
}

export async function GET(req: NextRequest) {
  const authError = await requireAdmin(req);
  if (authError) return authError;

  const dateFrom = req.nextUrl.searchParams.get("from") || "2026-03-01";
  const dateTo = req.nextUrl.searchParams.get("to") || "2026-12-31";

  try {
    const rows = await pgRows<{ date: string; total: number; campaigns: number }>(
      "SELECT date, SUM(amount) as total, COUNT(*) as campaigns FROM advertising WHERE date >= ? AND date <= ? GROUP BY date ORDER BY date",
      [dateFrom, dateTo],
    );

    return NextResponse.json({ ok: true, data: rows });
  } catch (err) {
    return apiError(err);
  }
}
