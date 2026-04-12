import { NextResponse } from "next/server";
import { getDb, getExcludeDailyFilter } from "@/modules/analytics/lib/db";

/**
 * GET /api/data/buyout-rates
 *
 * Процент выкупа по артикулам из realization (ежедневные + еженедельные отчёты ЛК WB).
 * Заказы = SUM(delivery_amount) из Логистики по nm_id
 * Выкупы = SUM(quantity) из Продажи по nm_id
 * Дедупликация: weekly_final > weekly > daily.
 */
export async function GET() {
  try {
    const db = getDb();
    const dedup = getExcludeDailyFilter(db, "rr_dt", "r");

    const rows = db.prepare(`
      SELECT r.nm_id,
        SUM(CASE WHEN r.supplier_oper_name = 'Логистика' THEN r.delivery_amount ELSE 0 END) as orders,
        SUM(CASE WHEN r.supplier_oper_name = 'Продажа' THEN r.quantity ELSE 0 END) as buyouts
      FROM realization r
      WHERE r.supplier_oper_name IN ('Логистика', 'Продажа') AND r.nm_id > 0
      ${dedup.sql}
      GROUP BY r.nm_id
      HAVING orders >= 30
    `).all(...dedup.params) as { nm_id: number; orders: number; buyouts: number }[];

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
