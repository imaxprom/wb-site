import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { getDb } from "@/modules/finance/lib/queries";
import { isPostgresEnabled, pgRows } from "@/lib/postgres";

/**
 * GET /api/finance/ads?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Returns advertising campaigns with daily breakdown.
 */
export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("from") || "2026-03-02";
  const dateTo = searchParams.get("to") || "2026-03-22";

  try {
    // Get campaigns with totals
    const campaignsSql = `
      SELECT campaign_id as id, campaign_name as name, SUM(amount) as total
      FROM advertising
      WHERE date >= ? AND date <= ?
      GROUP BY campaign_id, campaign_name
      ORDER BY total DESC
    `;
    const campaigns = isPostgresEnabled()
      ? await pgRows<{ id: number; name: string; total: number }>(campaignsSql, [dateFrom, dateTo])
      : getDb().prepare(campaignsSql).all(dateFrom, dateTo) as { id: number; name: string; total: number }[];

    // Get daily breakdown for each campaign
    const dailySql = `
      SELECT date, amount FROM advertising
      WHERE campaign_id = ? AND date >= ? AND date <= ?
      ORDER BY date
    `;

    const result = await Promise.all(campaigns.map(async (c) => {
      const rows = isPostgresEnabled()
        ? await pgRows<{ date: string; amount: number }>(dailySql, [c.id, dateFrom, dateTo])
        : getDb().prepare(dailySql).all(c.id, dateFrom, dateTo) as { date: string; amount: number }[];
      const daily: Record<string, number> = {};
      for (const r of rows) daily[r.date] = r.amount;
      return { id: c.id, name: c.name, total: Math.round(c.total), daily };
    }));

    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
