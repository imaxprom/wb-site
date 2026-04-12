import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-utils";
import { getDb } from "@/modules/finance/lib/queries";

/**
 * GET /api/finance/ads?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Returns advertising campaigns with daily breakdown.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("from") || "2026-03-02";
  const dateTo = searchParams.get("to") || "2026-03-22";

  try {
    const d = getDb();

    // Get campaigns with totals
    const campaigns = d.prepare(`
      SELECT campaign_id as id, campaign_name as name, SUM(amount) as total
      FROM advertising
      WHERE date >= ? AND date <= ?
      GROUP BY campaign_id
      ORDER BY total DESC
    `).all(dateFrom, dateTo) as { id: number; name: string; total: number }[];

    // Get daily breakdown for each campaign
    const dailyStmt = d.prepare(`
      SELECT date, amount FROM advertising
      WHERE campaign_id = ? AND date >= ? AND date <= ?
      ORDER BY date
    `);

    const result = campaigns.map(c => {
      const rows = dailyStmt.all(c.id, dateFrom, dateTo) as { date: string; amount: number }[];
      const daily: Record<string, number> = {};
      for (const r of rows) daily[r.date] = r.amount;
      return { id: c.id, name: c.name, total: Math.round(c.total), daily };
    });

    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
