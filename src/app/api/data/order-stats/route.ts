import { NextRequest, NextResponse } from "next/server";
import { activateAuthenticatedRequestContext, requireAdmin } from "@/lib/api-auth";
import { getPgExcludeDailyFilter } from "@/modules/analytics/lib/db";
import { pgGet, pgRows } from "@/lib/postgres";

/**
 * GET /api/data/order-stats?from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Статистика из realization + orders_funnel:
 * - orders: заказы покупателей (orders_funnel.order_count)
 * - deliveries: доставки — забрали из ПВЗ (delivery_amount из Логистики)
 * - returns: отказы (return_amount из Логистики)
 * - returnRate: % отказов = returns / deliveries
 * - buyouts: продажи (quantity из Продажи)
 */
export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  activateAuthenticatedRequestContext(request);

  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") || "";
  const to = searchParams.get("to") || "";
  if (!from || !to) {
    return NextResponse.json({ error: "from and to required" }, { status: 400 });
  }

  try {
    const dedup = await getPgExcludeDailyFilter("rr_dt", "r");

    // Заказы из воронки продаж (приоритет), fallback на shipment_orders.
    // Воронка даёт полный дневной объём заказов WB без фильтра отмен.
    const funnelRows = await pgRows<{ date: string; orders: number }>(`
      SELECT date, COALESCE(SUM(order_count), 0) as orders
      FROM orders_funnel
      WHERE date >= ? AND date <= ? AND order_count > 0
      GROUP BY date
      ORDER BY date
    `, [from, to]);

    const dailyOrders: Record<string, number> = {};
    let orders = 0;
    for (const row of funnelRows) {
      dailyOrders[row.date] = row.orders;
      orders += row.orders;
    }

    // Если funnel пуст или частичен — дополняем пропущенные дни из shipment_orders.
    // Здесь тоже считаем все строки, без фильтра is_cancel, чтобы не занижать спрос.
    if (orders === 0) {
      const fallbackRows = await pgRows<{ date: string; orders: number }>(`
        SELECT SUBSTR(date, 1, 10) as date, COUNT(*) as orders FROM shipment_orders
        WHERE date >= ? AND date <= ? || 'T23:59:59'
        GROUP BY SUBSTR(date, 1, 10)
        ORDER BY date
      `, [from, to]);
      for (const row of fallbackRows) {
        dailyOrders[row.date] = row.orders;
        orders += row.orders;
      }
    } else {
      // Проверяем: все ли дни покрыты funnel
      const totalDays = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1;
      if (funnelRows.length < totalDays) {
        // Дополняем пропущенные дни из shipment_orders
        const missingRows = await pgRows<{ date: string; orders: number }>(`
          SELECT SUBSTR(date, 1, 10) as date, COUNT(*) as orders FROM shipment_orders
          WHERE date >= ? AND date <= ? || 'T23:59:59'
          AND SUBSTR(date, 1, 10) NOT IN (
            SELECT date FROM orders_funnel WHERE date >= ? AND date <= ? AND order_count > 0
          )
          GROUP BY SUBSTR(date, 1, 10)
          ORDER BY date
        `, [from, to, from, to]);
        for (const row of missingRows) {
          dailyOrders[row.date] = row.orders;
          orders += row.orders;
        }
      }
    }

    // Доставки, отказы, выкупы из realization
    const realRow = await pgGet<{ deliveries: number; returns: number; buyouts: number }>(`
      SELECT
        COALESCE(SUM(CASE WHEN r.supplier_oper_name = 'Логистика' THEN r.delivery_amount ELSE 0 END), 0) as deliveries,
        COALESCE(SUM(CASE WHEN r.supplier_oper_name = 'Логистика' THEN r.return_amount ELSE 0 END), 0) as returns,
        COALESCE(SUM(CASE WHEN r.supplier_oper_name = 'Продажа' THEN r.quantity ELSE 0 END), 0) as buyouts
      FROM realization r
      WHERE r.rr_dt >= ? AND r.rr_dt <= ?
      AND r.supplier_oper_name IN ('Логистика', 'Продажа')
      ${dedup.sql}
    `, [from, to, ...dedup.params]);

    const deliveries = realRow?.deliveries || 0;
    const returns = realRow?.returns || 0;
    const returnRate = deliveries > 0 ? returns / deliveries : 0;

    return NextResponse.json({
      orders,
      dailyOrders,
      deliveries,
      returns,
      returnRate,
      buyouts: realRow?.buyouts || 0,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
