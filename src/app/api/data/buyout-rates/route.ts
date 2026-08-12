import { NextRequest, NextResponse } from "next/server";
import { activateAuthenticatedRequestContext, requireAdmin } from "@/lib/api-auth";
import { getPgExcludeDailyFilter } from "@/modules/analytics/lib/db";
import { pgRows } from "@/lib/postgres";

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
  const authError = await requireAdmin(request);
  if (authError) return authError;
  activateAuthenticatedRequestContext(request);

  try {
    const dedup = await getPgExcludeDailyFilter("rr_dt", "r");
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const rows = await pgRows<{ nm_id: number; orders: number; buyouts: number }>(`
      SELECT r.nm_id,
        SUM(CASE WHEN r.supplier_oper_name = 'Логистика' THEN r.delivery_amount ELSE 0 END) as orders,
        SUM(CASE WHEN r.supplier_oper_name = 'Продажа' THEN r.quantity ELSE 0 END) as buyouts
      FROM realization r
      WHERE r.supplier_oper_name IN ('Логистика', 'Продажа')
        AND r.nm_id > 0
        AND r.rr_dt >= ?
      ${dedup.sql}
      GROUP BY r.nm_id
      HAVING SUM(CASE WHEN r.supplier_oper_name = 'Логистика' THEN r.delivery_amount ELSE 0 END) >= 30
    `, [cutoff, ...dedup.params]);

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
