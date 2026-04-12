import { NextRequest, NextResponse } from "next/server";
import { getDb, getExcludeDailyFilter } from "@/modules/analytics/lib/db";

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
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from") || "";
  const to = searchParams.get("to") || "";
  if (!from || !to) {
    return NextResponse.json({ error: "from and to required" }, { status: 400 });
  }

  try {
    const db = getDb();
    const dedup = getExcludeDailyFilter(db, "rr_dt", "r");

    // Заказы из воронки продаж (приоритет), fallback на shipment_orders
    const funnelRow = db.prepare(`
      SELECT COALESCE(SUM(order_count), 0) as orders
      FROM orders_funnel
      WHERE date >= ? AND date <= ? AND order_count > 0
    `).get(from, to) as { orders: number };

    // Если funnel пуст или частичен — дополняем из shipment_orders
    let orders = funnelRow.orders;
    if (orders === 0) {
      const fallback = db.prepare(`
        SELECT COUNT(*) as cnt FROM shipment_orders
        WHERE date >= ? AND date <= ? || 'T23:59:59'
      `).get(from, to) as { cnt: number };
      orders = fallback.cnt;
    } else {
      // Проверяем: все ли дни покрыты funnel
      const funnelDays = db.prepare(`
        SELECT COUNT(*) as cnt FROM orders_funnel
        WHERE date >= ? AND date <= ? AND order_count > 0
      `).get(from, to) as { cnt: number };
      const totalDays = Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86400000) + 1;
      if (funnelDays.cnt < totalDays) {
        // Дополняем пропущенные дни из shipment_orders
        const missingDates = db.prepare(`
          SELECT COUNT(*) as cnt FROM shipment_orders
          WHERE date >= ? AND date <= ? || 'T23:59:59'
          AND SUBSTR(date, 1, 10) NOT IN (
            SELECT date FROM orders_funnel WHERE date >= ? AND date <= ? AND order_count > 0
          )
        `).get(from, to, from, to) as { cnt: number };
        orders += missingDates.cnt;
      }
    }

    // Доставки, отказы, выкупы из realization
    const realRow = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN r.supplier_oper_name = 'Логистика' THEN r.delivery_amount ELSE 0 END), 0) as deliveries,
        COALESCE(SUM(CASE WHEN r.supplier_oper_name = 'Логистика' THEN r.return_amount ELSE 0 END), 0) as returns,
        COALESCE(SUM(CASE WHEN r.supplier_oper_name = 'Продажа' THEN r.quantity ELSE 0 END), 0) as buyouts
      FROM realization r
      WHERE r.rr_dt >= ? AND r.rr_dt <= ?
      AND r.supplier_oper_name IN ('Логистика', 'Продажа')
      ${dedup.sql}
    `).get(from, to, ...dedup.params) as { deliveries: number; returns: number; buyouts: number };

    const returnRate = realRow.deliveries > 0 ? realRow.returns / realRow.deliveries : 0;

    return NextResponse.json({
      orders,
      deliveries: realRow.deliveries,
      returns: realRow.returns,
      returnRate,
      buyouts: realRow.buyouts,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
