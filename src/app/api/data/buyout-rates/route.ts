import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { getDb, getExcludeDailyFilter } from "@/modules/analytics/lib/db";

/**
 * GET /api/data/buyout-rates
 *
 * Процент выкупа по артикулам из realization (ежедневные + еженедельные отчёты ЛК WB).
 * Окно: последние 90 дней.
 * Заказы = SUM(delivery_amount) из Логистики по nm_id
 * Выкупы = SUM(quantity) из Продажи по nm_id
 * Дедупликация: weekly_final > weekly > daily.
 */
export async function GET(request: NextRequest) {
  const authError = requireAdmin(request);
  if (authError) return authError;

  try {
    const db = getDb();
    const dedup = getExcludeDailyFilter(db, "rr_dt", "r");
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const rows = db.prepare(`
      SELECT r.nm_id,
        SUM(CASE WHEN r.supplier_oper_name = 'Логистика' THEN r.delivery_amount ELSE 0 END) as orders,
        SUM(CASE WHEN r.supplier_oper_name = 'Продажа' THEN r.quantity ELSE 0 END) as buyouts
      FROM realization r
      WHERE r.supplier_oper_name IN ('Логистика', 'Продажа')
        AND r.nm_id > 0
        AND r.rr_dt >= ?
      ${dedup.sql}
      GROUP BY r.nm_id
      HAVING orders >= 30
    `).all(cutoff, ...dedup.params) as { nm_id: number; orders: number; buyouts: number }[];

    const result = rows
      .map(r => ({
        articleWB: String(r.nm_id),
        sales: r.buyouts,
        returns: r.orders - r.buyouts,
        buyoutRate: r.orders > 0 ? r.buyouts / r.orders : 0,
      }))
      .sort((a, b) => (b.sales + b.returns) - (a.sales + a.returns));

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
