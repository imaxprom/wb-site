import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { getPgExcludeDailyFilter } from "@/modules/analytics/lib/db";
import { pgRows } from "@/lib/postgres";

function cogsCostSql(alias: string, dateColumn: string): string {
  return `COALESCE((
    SELECT h.cost FROM cogs_history h
    WHERE h.barcode = ${alias}.barcode
      AND h.valid_from <= ${alias}.${dateColumn}
      AND (h.valid_to IS NULL OR h.valid_to >= ${alias}.${dateColumn})
    ORDER BY h.valid_from DESC
    LIMIT 1
  ), 0)`;
}

/**
 * GET /api/finance/articles?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Returns per-article P&L breakdown for the given period.
 */
export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("from") || "2026-03-02";
  const dateTo = searchParams.get("to") || "2026-03-22";

  try {
    const dedupSale = await getPgExcludeDailyFilter("sale_dt", "r");
    const dedupRr = await getPgExcludeDailyFilter("rr_dt", "r");

    // Get all articles with sales in period
    const articlesSql = `
      SELECT nm_id,
        COALESCE((ARRAY_REMOVE(ARRAY_AGG(NULLIF(sa_name, '') ORDER BY sale_dt DESC), NULL))[1], '') as sa_name,
        SUM(CASE WHEN supplier_oper_name = 'Продажа' THEN quantity ELSE 0 END) as sales_qty,
        SUM(CASE WHEN supplier_oper_name = 'Возврат' THEN quantity ELSE 0 END) as returns_qty,
        SUM(CASE WHEN supplier_oper_name = 'Продажа' THEN retail_price_withdisc_rub ELSE 0 END) as sales_rpwd,
        SUM(CASE WHEN supplier_oper_name = 'Возврат' THEN retail_price_withdisc_rub ELSE 0 END) as returns_rpwd,
        SUM(CASE WHEN supplier_oper_name = 'Продажа' THEN ppvz_for_pay ELSE 0 END) as sales_ppvz,
        SUM(CASE WHEN supplier_oper_name = 'Возврат' THEN ppvz_for_pay ELSE 0 END) as returns_ppvz,
        SUM(CASE WHEN supplier_oper_name = 'Продажа' THEN quantity * ${cogsCostSql("r", "sale_dt")} ELSE 0 END) as cogs_total,
        SUM(CASE WHEN supplier_oper_name = 'Возврат' THEN quantity * ${cogsCostSql("r", "sale_dt")} ELSE 0 END) as cogs_returns
      FROM realization r
      WHERE supplier_oper_name IN ('Продажа', 'Возврат')
        AND sale_dt >= ? AND sale_dt <= ?
        AND nm_id > 0
        ${dedupSale.sql}
      GROUP BY nm_id
      ORDER BY sales_rpwd DESC
    `;
    const articlesParams = [dateFrom, dateTo, ...dedupSale.params];
    const articles = await pgRows<Record<string, number>>(articlesSql, articlesParams);

    // Logistics by nm_id (from rr_dt)
    const logisticsSql = `
      SELECT nm_id,
        SUM(CASE WHEN supplier_oper_name = 'Логистика' THEN delivery_rub ELSE 0 END) as logistics
      FROM realization r
      WHERE rr_dt >= ? AND rr_dt <= ? AND nm_id > 0
        ${dedupRr.sql}
      GROUP BY nm_id
    `;
    const logisticsParams = [dateFrom, dateTo, ...dedupRr.params];
    const logistics = await pgRows<Record<string, number>>(logisticsSql, logisticsParams);
    const logMap = Object.fromEntries(logistics.map(r => [r.nm_id, r.logistics]));

    // Ad spend per article (точные данные из advertising с nm_id)
    const adsByArticleSql = `
      SELECT nm_id, SUM(amount) as total
      FROM advertising
      WHERE date >= ? AND date <= ? AND nm_id > 0
      GROUP BY nm_id
    `;
    const adsByArticle = await pgRows<{ nm_id: number; total: number }>(adsByArticleSql, [dateFrom, dateTo]);
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
