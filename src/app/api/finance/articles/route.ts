import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-utils";
import { getDb } from "@/modules/finance/lib/queries";
import { DEFAULT_COGS_PER_UNIT } from "@/lib/constants";

/**
 * GET /api/finance/articles?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Returns per-article P&L breakdown for the given period.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("from") || "2026-03-02";
  const dateTo = searchParams.get("to") || "2026-03-22";

  try {
    const d = getDb();

    // Get all articles with sales in period
    const articles = d.prepare(`
      SELECT nm_id, sa_name,
        SUM(CASE WHEN supplier_oper_name = 'Продажа' THEN quantity ELSE 0 END) as sales_qty,
        SUM(CASE WHEN supplier_oper_name = 'Возврат' THEN quantity ELSE 0 END) as returns_qty,
        SUM(CASE WHEN supplier_oper_name = 'Продажа' THEN retail_price_withdisc_rub ELSE 0 END) as sales_rpwd,
        SUM(CASE WHEN supplier_oper_name = 'Возврат' THEN retail_price_withdisc_rub ELSE 0 END) as returns_rpwd,
        SUM(CASE WHEN supplier_oper_name = 'Продажа' THEN ppvz_for_pay ELSE 0 END) as sales_ppvz,
        SUM(CASE WHEN supplier_oper_name = 'Возврат' THEN ppvz_for_pay ELSE 0 END) as returns_ppvz,
        SUM(CASE WHEN supplier_oper_name = 'Продажа' THEN quantity * COALESCE((SELECT cost FROM cogs WHERE cogs.barcode = r.barcode), ${DEFAULT_COGS_PER_UNIT}) ELSE 0 END) as cogs_total,
        SUM(CASE WHEN supplier_oper_name = 'Возврат' THEN quantity * COALESCE((SELECT cost FROM cogs WHERE cogs.barcode = r.barcode), ${DEFAULT_COGS_PER_UNIT}) ELSE 0 END) as cogs_returns
      FROM realization r
      WHERE supplier_oper_name IN ('Продажа', 'Возврат')
        AND sale_dt >= ? AND sale_dt <= ?
        AND nm_id > 0
      GROUP BY nm_id
      ORDER BY sales_rpwd DESC
    `).all(dateFrom, dateTo) as Record<string, number>[];

    // Logistics by nm_id (from rr_dt)
    const logistics = d.prepare(`
      SELECT nm_id,
        SUM(CASE WHEN supplier_oper_name = 'Логистика' THEN delivery_rub ELSE 0 END) as logistics
      FROM realization
      WHERE rr_dt >= ? AND rr_dt <= ? AND nm_id > 0
      GROUP BY nm_id
    `).all(dateFrom, dateTo) as Record<string, number>[];
    const logMap = Object.fromEntries(logistics.map(r => [r.nm_id, r.logistics]));

    // Ad spend per article (точные данные из advertising с nm_id)
    const adsByArticle = d.prepare(`
      SELECT nm_id, SUM(amount) as total
      FROM advertising
      WHERE date >= ? AND date <= ? AND nm_id > 0
      GROUP BY nm_id
    `).all(dateFrom, dateTo) as { nm_id: number; total: number }[];
    const adMap = Object.fromEntries(adsByArticle.map(r => [r.nm_id, r.total]));

    const result = articles.map(a => {
      const revenue = a.sales_rpwd - a.returns_rpwd;
      const netQty = a.sales_qty - a.returns_qty;
      const ppvz = a.sales_ppvz - a.returns_ppvz;
      const cogs = a.cogs_total - a.cogs_returns;
      const log = logMap[a.nm_id] || 0;
      const adAllocated = adMap[a.nm_id] || 0;
      const nds = ppvz * 5 / 105;
      const usn = (ppvz - nds) * 0.01;
      const tax = nds + usn;
      const commission = revenue - ppvz;
      const profit = revenue - cogs - log - commission - adAllocated - tax;
      const margin = revenue > 0 ? (profit / revenue) * 100 : 0;

      return {
        nm_id: a.nm_id,
        article: a.sa_name,
        sales_qty: a.sales_qty,
        returns_qty: a.returns_qty,
        net_qty: netQty,
        revenue: Math.round(revenue),
        ppvz: Math.round(ppvz),
        cogs_total: Math.round(cogs),
        cogs_unit: netQty > 0 ? Math.round(cogs / netQty) : 0,
        logistics: Math.round(log),
        log_per_unit: netQty > 0 ? Math.round(log / netQty) : 0,
        commission: Math.round(commission),
        commission_unit: netQty > 0 ? Math.round(commission / netQty) : 0,
        ad_allocated: Math.round(adAllocated),
        ad_per_unit: netQty > 0 ? Math.round(adAllocated / netQty) : 0,
        tax: Math.round(tax),
        tax_unit: netQty > 0 ? Math.round(tax / netQty) : 0,
        profit: Math.round(profit),
        margin: Math.round(margin * 10) / 10,
        profit_per_unit: netQty > 0 ? Math.round(profit / netQty) : 0,
        avg_price: netQty > 0 ? Math.round(revenue / netQty) : 0,
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
