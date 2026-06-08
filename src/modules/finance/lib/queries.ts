/**
 * Модуль Финансы — собственные запросы к БД.
 * Не зависит от других модулей (Отгрузка, Аналитика, Отзывы).
 */
import { pgGet, pgRows } from "@/lib/postgres";
import { getPgExcludeDailyFilter } from "@/modules/analytics/lib/db";

const ZERO_COGS_PER_UNIT = 0;

function pgCogsCostSql(alias: string, dateColumn: string): string {
  return `COALESCE((
    SELECT h.cost FROM cogs_history h
    WHERE h.barcode = ${alias}.barcode
      AND h.valid_from <= ${alias}.${dateColumn}
      AND (h.valid_to IS NULL OR h.valid_to >= ${alias}.${dateColumn})
    ORDER BY h.valid_from DESC
    LIMIT 1
  ), 0)`;
}

function jamDedupSql(): string {
  return `
    WITH jam_rows AS (
      SELECT DISTINCT
        bonus_type_name,
        rr_dt,
        deduction,
        source,
        CASE source
          WHEN 'weekly_final' THEN 3
          WHEN 'weekly' THEN 2
          WHEN 'daily' THEN 1
          ELSE 0
        END AS source_rank
      FROM realization
      WHERE bonus_type_name LIKE '%Джем%'
        AND rr_dt >= ?
        AND rr_dt <= ?
    ),
    ranked AS (
      SELECT *,
        MAX(source_rank) OVER (
          PARTITION BY bonus_type_name, rr_dt, deduction
        ) AS max_source_rank
      FROM jam_rows
    )
    SELECT COALESCE(SUM(deduction), 0) AS total
    FROM ranked
    WHERE source_rank = max_source_rank
  `;
}

async function getJamTotalPg(dateFrom: string, dateTo: string): Promise<number> {
  const row = await pgGet<Record<string, number>>(jamDedupSql(), [dateFrom, dateTo]) || {};
  return row.total || 0;
}

// ─── Helpers ─────────────────────────────────────────────────

function nextDay(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

async function getWeeklyPeriodsPg(): Promise<{ period_from: string; period_to: string }[]> {
  try {
    return await pgRows<{ period_from: string; period_to: string }>(`
      SELECT DISTINCT period_from, period_to FROM weekly_rows
      WHERE period_from != '' AND period_to != ''
      ORDER BY period_from
    `);
  } catch (error) {
    if (error instanceof Error && /relation .* does not exist/i.test(error.message)) return [];
    throw error;
  }
}

// ─── P&L ─────────────────────────────────────────────────────

export interface PnlResult {
  realization: number;
  sales_rpwd: number;
  returns_rpwd: number;
  retail_amount: number;
  loyalty_compensation: number;
  ppvz: number;
  commission: number;
  logistics: number;
  storage: number;
  penalty: number;
  acceptance: number;
  other_services: number;
  jam: number;
  rebill: number;
  total_services: number;
  cogs: number;
  ad_spend: number;
  orders_sum: number;
  sales_qty: number;
  returns_qty: number;
  net_qty: number;
}

async function getPnlFromExcelPg(dateFrom: string, dateTo: string, nmId?: number): Promise<{
  salesRow: Record<string, number>;
  returnsRow: Record<string, number>;
  svcRow: Record<string, number>;
  loyaltyComp: number;
  cogs: number;
  commSales: number;
  commReturns: number;
} | null> {
  const nmWhere = nmId ? "AND nm_id = ?" : "";
  const nmParams = nmId ? [nmId] : [];

  const periods = await getWeeklyPeriodsPg();
  if (periods.length === 0) return null;

  const overlapping = periods.filter(p => p.period_from <= dateTo && p.period_to >= dateFrom);
  if (overlapping.length === 0) return null;

  const excelEnd = overlapping[overlapping.length - 1].period_to;
  const excelSaleTo = excelEnd < dateTo ? excelEnd : dateTo;

  const periodPlaceholders = overlapping.map(() => "(period_from = ? AND period_to = ?)").join(" OR ");
  const periodParams = overlapping.flatMap(p => [p.period_from, p.period_to]);
  const pf = `AND (${periodPlaceholders})`;

  const salesRow = await pgGet<Record<string, number>>(`
    SELECT
      COALESCE(SUM(retail_price_withdisc_rub), 0) as rpwd,
      COALESCE(SUM(retail_amount), 0) as ra,
      COALESCE(SUM(ppvz_for_pay), 0) as ppvz,
      COALESCE(SUM(quantity), 0) as qty
    FROM weekly_rows
    WHERE supplier_oper_name = 'Продажа'
      AND sale_dt >= ? AND sale_dt <= ? ${nmWhere}
  `, [dateFrom, excelSaleTo, ...nmParams]) || {};

  if (!salesRow || (salesRow.rpwd || 0) === 0) return null;

  const returnsRow = await pgGet<Record<string, number>>(`
    SELECT
      COALESCE(SUM(retail_price_withdisc_rub), 0) as rpwd,
      COALESCE(SUM(retail_amount), 0) as ra,
      COALESCE(SUM(ppvz_for_pay), 0) as ppvz,
      COALESCE(SUM(quantity), 0) as qty
    FROM weekly_rows
    WHERE supplier_oper_name = 'Возврат'
      AND sale_dt >= ? AND sale_dt <= ? ${nmWhere}
  `, [dateFrom, excelSaleTo, ...nmParams]) || {};

  const commSalesRow = await pgGet<Record<string, number>>(`
    SELECT COALESCE(SUM(retail_price_withdisc_rub - ppvz_for_pay), 0) as comm
    FROM weekly_rows
    WHERE supplier_oper_name = 'Продажа'
      AND sale_dt >= ? AND sale_dt <= ? ${nmWhere}
  `, [dateFrom, excelSaleTo, ...nmParams]) || {};

  const commReturnsRow = await pgGet<Record<string, number>>(`
    SELECT COALESCE(SUM(retail_price_withdisc_rub - ppvz_for_pay), 0) as comm
    FROM weekly_rows
    WHERE supplier_oper_name = 'Возврат'
      AND sale_dt >= ? AND sale_dt <= ? ${nmWhere}
  `, [dateFrom, excelSaleTo, ...nmParams]) || {};

  const svcRow = await pgGet<Record<string, number>>(`
    SELECT
      COALESCE(SUM(delivery_rub), 0) as logistics,
      COALESCE(SUM(storage_fee), 0) as storage,
      COALESCE(SUM(penalty), 0) as penalty,
      COALESCE(SUM(acceptance), 0) as acceptance,
      COALESCE(SUM(rebill_logistic_cost), 0) as rebill
    FROM weekly_rows
    WHERE sale_dt >= ? AND sale_dt <= ? ${nmWhere}
  `, [dateFrom, excelSaleTo, ...nmParams]) || {};

  const loyaltyRow = await pgGet<Record<string, number>>(`
    SELECT COALESCE(SUM(loyalty_compensation), 0) as total
    FROM weekly_rows
    WHERE 1=1 ${pf}
  `, periodParams) || {};

  const cogsSalesRow = await pgGet<Record<string, number>>(`
    SELECT COALESCE(SUM(w.qty * COALESCE((
      SELECT h.cost FROM cogs_history h
      WHERE h.barcode = w.barcode
        AND h.valid_from <= w.sale_dt
        AND (h.valid_to IS NULL OR h.valid_to >= w.sale_dt)
      ORDER BY h.valid_from DESC
      LIMIT 1
    ), 0)), 0) as total
    FROM (
      SELECT barcode, sale_dt, SUM(quantity) as qty
      FROM weekly_rows
      WHERE supplier_oper_name = 'Продажа' AND sale_dt >= ? AND sale_dt <= ?
      GROUP BY barcode, sale_dt
    ) w
  `, [dateFrom, excelSaleTo]) || {};

  const cogsReturnsRow = await pgGet<Record<string, number>>(`
    SELECT COALESCE(SUM(w.qty * COALESCE((
      SELECT h.cost FROM cogs_history h
      WHERE h.barcode = w.barcode
        AND h.valid_from <= w.sale_dt
        AND (h.valid_to IS NULL OR h.valid_to >= w.sale_dt)
      ORDER BY h.valid_from DESC
      LIMIT 1
    ), 0)), 0) as total
    FROM (
      SELECT barcode, sale_dt, SUM(quantity) as qty
      FROM weekly_rows
      WHERE supplier_oper_name = 'Возврат' AND sale_dt >= ? AND sale_dt <= ?
      GROUP BY barcode, sale_dt
    ) w
  `, [dateFrom, excelSaleTo]) || {};

  let cogs = cogsSalesRow.total || 0;
  let cogsReturns = cogsReturnsRow.total || 0;

  if (excelEnd < dateTo) {
    const tailFrom = nextDay(excelEnd);
    const tailTo = dateTo;

    const tailSales = await pgGet<Record<string, number>>(`
      SELECT
        COALESCE(SUM(retail_price_withdisc_rub), 0) as rpwd,
        COALESCE(SUM(retail_amount), 0) as ra,
        COALESCE(SUM(ppvz_for_pay), 0) as ppvz,
        COALESCE(SUM(quantity), 0) as qty,
        COALESCE(SUM(quantity * ${pgCogsCostSql("r", "sale_dt")}), 0) as cogs
      FROM realization r
      WHERE supplier_oper_name = 'Продажа' AND sale_dt >= ? AND sale_dt <= ?
    `, [tailFrom, tailTo]) || {};

    const tailReturns = await pgGet<Record<string, number>>(`
      SELECT
        COALESCE(SUM(retail_price_withdisc_rub), 0) as rpwd,
        COALESCE(SUM(retail_amount), 0) as ra,
        COALESCE(SUM(ppvz_for_pay), 0) as ppvz,
        COALESCE(SUM(quantity), 0) as qty,
        COALESCE(SUM(quantity * ${pgCogsCostSql("r", "sale_dt")}), 0) as cogs
      FROM realization r
      WHERE supplier_oper_name = 'Возврат' AND sale_dt >= ? AND sale_dt <= ?
    `, [tailFrom, tailTo]) || {};

    const tailCommSales = await pgGet<Record<string, number>>(`
      SELECT COALESCE(SUM(retail_price_withdisc_rub - ppvz_for_pay), 0) as comm
      FROM realization r WHERE supplier_oper_name = 'Продажа' AND sale_dt >= ? AND sale_dt <= ?
    `, [tailFrom, tailTo]) || {};

    const tailCommReturns = await pgGet<Record<string, number>>(`
      SELECT COALESCE(SUM(retail_price_withdisc_rub - ppvz_for_pay), 0) as comm
      FROM realization r WHERE supplier_oper_name = 'Возврат' AND sale_dt >= ? AND sale_dt <= ?
    `, [tailFrom, tailTo]) || {};

    const tailSvc = await pgGet<Record<string, number>>(`
      SELECT
        COALESCE(SUM(CASE WHEN supplier_oper_name IN ('Логистика', 'Коррекция логистики') THEN delivery_rub ELSE 0 END), 0) as logistics,
        COALESCE(SUM(storage_fee), 0) as storage,
        COALESCE(SUM(penalty), 0) as penalty,
        COALESCE(SUM(acceptance), 0) as acceptance,
        COALESCE(SUM(rebill_logistic_cost), 0) as rebill
      FROM realization r WHERE rr_dt >= ? AND rr_dt <= ?
    `, [tailFrom, tailTo]) || {};

    salesRow.rpwd = (salesRow.rpwd || 0) + (tailSales.rpwd || 0);
    salesRow.ra = (salesRow.ra || 0) + (tailSales.ra || 0);
    salesRow.ppvz = (salesRow.ppvz || 0) + (tailSales.ppvz || 0);
    salesRow.qty = (salesRow.qty || 0) + (tailSales.qty || 0);
    returnsRow.rpwd = (returnsRow.rpwd || 0) + (tailReturns.rpwd || 0);
    returnsRow.ra = (returnsRow.ra || 0) + (tailReturns.ra || 0);
    returnsRow.ppvz = (returnsRow.ppvz || 0) + (tailReturns.ppvz || 0);
    returnsRow.qty = (returnsRow.qty || 0) + (tailReturns.qty || 0);
    commSalesRow.comm = (commSalesRow.comm || 0) + (tailCommSales.comm || 0);
    commReturnsRow.comm = (commReturnsRow.comm || 0) + (tailCommReturns.comm || 0);
    svcRow.logistics = (svcRow.logistics || 0) + (tailSvc.logistics || 0);
    svcRow.storage = (svcRow.storage || 0) + (tailSvc.storage || 0);
    svcRow.penalty = (svcRow.penalty || 0) + (tailSvc.penalty || 0);
    svcRow.acceptance = (svcRow.acceptance || 0) + (tailSvc.acceptance || 0);
    svcRow.rebill = (svcRow.rebill || 0) + (tailSvc.rebill || 0);
    cogs += tailSales.cogs || 0;
    cogsReturns += tailReturns.cogs || 0;
  }

  return {
    salesRow,
    returnsRow: returnsRow || { rpwd: 0, ra: 0, ppvz: 0, qty: 0 },
    svcRow,
    loyaltyComp: Math.round(loyaltyRow.total || 0),
    cogs: cogs - cogsReturns,
    commSales: commSalesRow.comm || 0,
    commReturns: commReturnsRow.comm || 0,
  };
}

export async function getPnlPg(dateFrom: string, dateTo: string, nmId?: number): Promise<PnlResult> {
  if (!nmId) {
    const excelData = await getPnlFromExcelPg(dateFrom, dateTo, nmId);
    if (excelData) {
      const { salesRow, returnsRow, svcRow, loyaltyComp, cogs, commSales, commReturns } = excelData;
      const commission = commSales - commReturns;
      const adRow = await pgGet<Record<string, number>>(
        `SELECT COALESCE(SUM(amount), 0) as total FROM advertising WHERE date >= ? AND date <= ?`,
        [dateFrom, dateTo]
      ) || {};
      const ordRow = await pgGet<Record<string, number>>(
        `SELECT COALESCE(SUM(order_sum), 0) as total FROM orders_funnel WHERE date >= ? AND date <= ?`,
        [dateFrom, dateTo]
      ) || {};
      const jam = await getJamTotalPg(dateFrom, dateTo);
      const other = (svcRow.storage || 0) + (svcRow.penalty || 0) + (svcRow.acceptance || 0);

      return {
        realization: (salesRow.rpwd || 0) - (returnsRow.rpwd || 0),
        sales_rpwd: salesRow.rpwd || 0,
        returns_rpwd: returnsRow.rpwd || 0,
        retail_amount: (salesRow.ra || 0) - (returnsRow.ra || 0),
        loyalty_compensation: loyaltyComp,
        ppvz: (salesRow.ppvz || 0) - (returnsRow.ppvz || 0),
        commission,
        logistics: svcRow.logistics || 0,
        storage: svcRow.storage || 0,
        penalty: svcRow.penalty || 0,
        acceptance: svcRow.acceptance || 0,
        other_services: other,
        jam,
        rebill: svcRow.rebill || 0,
        total_services: commission + (svcRow.logistics || 0) + (adRow.total || 0) + other + jam,
        cogs,
        ad_spend: adRow.total || 0,
        orders_sum: ordRow.total || 0,
        sales_qty: salesRow.qty || 0,
        returns_qty: returnsRow.qty || 0,
        net_qty: (salesRow.qty || 0) - (returnsRow.qty || 0),
      };
    }
  }

  const excludeDaily = await getPgExcludeDailyFilter("sale_dt", "r");
  const excludeDailySvc = await getPgExcludeDailyFilter("rr_dt", "r");
  const saleDateFilter = `((r.source = 'weekly_final' AND r.date_from >= ? AND r.date_to <= ?) OR (r.source != 'weekly_final' AND r.sale_dt >= ? AND r.sale_dt <= ?))`;
  const svcDateFilter = `((r.source = 'weekly_final' AND r.date_from >= ? AND r.date_to <= ?) OR (r.source != 'weekly_final' AND r.rr_dt >= ? AND r.rr_dt <= ?))`;
  const saleDateParams = [dateFrom, dateTo, dateFrom, dateTo];
  const svcDateParams = [dateFrom, dateTo, dateFrom, dateTo];
  const salesWhere = nmId ? "AND nm_id = ?" : "";
  const salesNmParams = nmId ? [nmId] : [];
  const salesParams = [...saleDateParams, ...salesNmParams, ...excludeDaily.params];
  const svcWhere = nmId ? "AND nm_id = ?" : "";
  const svcParams = [...svcDateParams, ...salesNmParams, ...excludeDailySvc.params];

  const salesRow = await pgGet<Record<string, number>>(`
    SELECT COALESCE(SUM(retail_price_withdisc_rub), 0) as rpwd, COALESCE(SUM(retail_amount), 0) as ra,
      COALESCE(SUM(ppvz_for_pay), 0) as ppvz, COALESCE(SUM(quantity), 0) as qty,
      COALESCE(SUM(quantity * ${pgCogsCostSql("r", "sale_dt")}), 0) as cogs
    FROM realization r WHERE supplier_oper_name = 'Продажа' AND ${saleDateFilter} ${salesWhere} ${excludeDaily.sql}
  `, salesParams) || {};

  const returnsRow = await pgGet<Record<string, number>>(`
    SELECT COALESCE(SUM(retail_price_withdisc_rub), 0) as rpwd, COALESCE(SUM(retail_amount), 0) as ra,
      COALESCE(SUM(ppvz_for_pay), 0) as ppvz, COALESCE(SUM(quantity), 0) as qty,
      COALESCE(SUM(quantity * ${pgCogsCostSql("r", "sale_dt")}), 0) as cogs
    FROM realization r WHERE supplier_oper_name = 'Возврат' AND ${saleDateFilter} ${salesWhere} ${excludeDaily.sql}
  `, salesParams) || {};

  const svcRow = await pgGet<Record<string, number>>(`
    SELECT COALESCE(SUM(CASE WHEN supplier_oper_name IN ('Логистика', 'Коррекция логистики') THEN delivery_rub ELSE 0 END), 0) as logistics,
      COALESCE(SUM(storage_fee), 0) as storage, COALESCE(SUM(penalty), 0) as penalty,
      COALESCE(SUM(acceptance), 0) as acceptance, COALESCE(SUM(rebill_logistic_cost), 0) as rebill
    FROM realization r WHERE ${svcDateFilter} ${svcWhere} ${excludeDailySvc.sql}
  `, svcParams) || {};

  const commSales = await pgGet<Record<string, number>>(`
    SELECT COALESCE(SUM(retail_price_withdisc_rub - ppvz_for_pay), 0) as comm
    FROM realization r WHERE supplier_oper_name = 'Продажа' AND ${saleDateFilter} ${salesWhere} ${excludeDaily.sql}
  `, salesParams) || {};

  const commReturns = await pgGet<Record<string, number>>(`
    SELECT COALESCE(SUM(retail_price_withdisc_rub - ppvz_for_pay), 0) as comm
    FROM realization r WHERE supplier_oper_name = 'Возврат' AND ${saleDateFilter} ${salesWhere} ${excludeDaily.sql}
  `, salesParams) || {};

  const adRow = await pgGet<Record<string, number>>(
    `SELECT COALESCE(SUM(amount), 0) as total FROM advertising WHERE date >= ? AND date <= ?`,
    [dateFrom, dateTo]
  ) || {};
  const ordRow = await pgGet<Record<string, number>>(
    `SELECT COALESCE(SUM(order_sum), 0) as total FROM orders_funnel WHERE date >= ? AND date <= ?`,
    [dateFrom, dateTo]
  ) || {};
  const commission = (commSales.comm || 0) - (commReturns.comm || 0);
  const jam = await getJamTotalPg(dateFrom, dateTo);
  const other = (svcRow.storage || 0) + (svcRow.penalty || 0) + (svcRow.acceptance || 0);

  return {
    realization: (salesRow.rpwd || 0) - (returnsRow.rpwd || 0),
    sales_rpwd: salesRow.rpwd || 0,
    returns_rpwd: returnsRow.rpwd || 0,
    retail_amount: (salesRow.ra || 0) - (returnsRow.ra || 0),
    loyalty_compensation: 0,
    ppvz: (salesRow.ppvz || 0) - (returnsRow.ppvz || 0),
    commission,
    logistics: svcRow.logistics || 0,
    storage: svcRow.storage || 0,
    penalty: svcRow.penalty || 0,
    acceptance: svcRow.acceptance || 0,
    other_services: other,
    jam,
    rebill: svcRow.rebill || 0,
    total_services: commission + (svcRow.logistics || 0) + (adRow.total || 0) + other + jam,
    cogs: (salesRow.cogs || 0) - (returnsRow.cogs || 0),
    ad_spend: adRow.total || 0,
    orders_sum: ordRow.total || 0,
    sales_qty: salesRow.qty || 0,
    returns_qty: returnsRow.qty || 0,
    net_qty: (salesRow.qty || 0) - (returnsRow.qty || 0),
  };
}

// ─── Daily Data ──────────────────────────────────────────────

export interface DailyDbRow {
  date: string;
  orders_rub: number;
  orders_count: number;
  sales_rub: number;
  returns_rub: number;
  realization: number;
  sales_qty: number;
  returns_qty: number;
  net_qty: number;
  commission: number;
  logistics: number;
  storage: number;
  penalty: number;
  ad_spend: number;
  cogs: number;
  profit: number;
}

export async function getDailyPg(dateFrom: string, dateTo: string, nmId?: number): Promise<DailyDbRow[]> {
  const nmWhere = nmId ? "AND nm_id = ?" : "";
  const nmParams = nmId ? [nmId] : [];
  const exSale = await getPgExcludeDailyFilter("sale_dt", "r");
  const exRr = await getPgExcludeDailyFilter("rr_dt", "r");
  const saleParams = [dateFrom, dateTo, ...nmParams, ...exSale.params];
  const rrParams = [dateFrom, dateTo, ...nmParams, ...exRr.params];

  const salesDaily = await pgRows<Record<string, number | string>>(`
    SELECT sale_dt as date, SUM(retail_price_withdisc_rub) as rpwd, SUM(ppvz_for_pay) as ppvz,
      SUM(quantity) as qty, SUM(quantity * ${pgCogsCostSql("r", "sale_dt")}) as cogs_sum
    FROM realization r WHERE supplier_oper_name = 'Продажа' AND sale_dt >= ? AND sale_dt <= ? ${nmWhere} ${exSale.sql}
    GROUP BY sale_dt
  `, saleParams);

  const returnsDaily = await pgRows<Record<string, number | string>>(`
    SELECT sale_dt as date, SUM(retail_price_withdisc_rub) as rpwd, SUM(ppvz_for_pay) as ppvz, SUM(quantity) as qty
    FROM realization r WHERE supplier_oper_name = 'Возврат' AND sale_dt >= ? AND sale_dt <= ? ${nmWhere} ${exSale.sql}
    GROUP BY sale_dt
  `, saleParams);

  const svcDaily = await pgRows<Record<string, number | string>>(`
    SELECT rr_dt as date, SUM(CASE WHEN supplier_oper_name IN ('Логистика', 'Коррекция логистики') THEN delivery_rub ELSE 0 END) as logistics,
      SUM(storage_fee) as storage, SUM(penalty) as penalty
    FROM realization r WHERE rr_dt >= ? AND rr_dt <= ? ${nmWhere} ${exRr.sql}
    GROUP BY rr_dt
  `, rrParams);

  const commDaily = await pgRows<Record<string, number | string>>(`
    SELECT rr_dt as date,
      SUM(CASE WHEN supplier_oper_name = 'Продажа' THEN retail_price_withdisc_rub - ppvz_for_pay ELSE 0 END)
      - SUM(CASE WHEN supplier_oper_name = 'Возврат' THEN retail_price_withdisc_rub - ppvz_for_pay ELSE 0 END) as comm
    FROM realization r WHERE supplier_oper_name IN ('Продажа','Возврат') AND rr_dt >= ? AND rr_dt <= ? ${nmWhere} ${exRr.sql}
    GROUP BY rr_dt
  `, rrParams);

  const adsDaily = await pgRows<Record<string, number | string>>(
    `SELECT date, SUM(amount) as total FROM advertising WHERE date >= ? AND date <= ? GROUP BY date`,
    [dateFrom, dateTo]
  );
  const ordersDaily = await pgRows<Record<string, number | string>>(
    `SELECT date, order_sum, order_count FROM orders_funnel WHERE date >= ? AND date <= ?`,
    [dateFrom, dateTo]
  );

  const allDates = new Set<string>();
  for (const r of salesDaily) allDates.add(String(r.date));
  for (const r of svcDaily) allDates.add(String(r.date));
  for (const r of ordersDaily) allDates.add(String(r.date));

  const salesMap = Object.fromEntries(salesDaily.map(r => [String(r.date), r]));
  const retMap = Object.fromEntries(returnsDaily.map(r => [String(r.date), r]));
  const svcMap = Object.fromEntries(svcDaily.map(r => [String(r.date), r]));
  const commMap = Object.fromEntries(commDaily.map(r => [String(r.date), r]));
  const adsMap = Object.fromEntries(adsDaily.map(r => [String(r.date), r]));
  const ordMap = Object.fromEntries(ordersDaily.map(r => [String(r.date), r]));

  const result: DailyDbRow[] = [];
  for (const dt of Array.from(allDates).sort()) {
    const s = salesMap[dt] || { rpwd: 0, ppvz: 0, qty: 0, cogs_sum: 0 };
    const ret = retMap[dt] || { rpwd: 0, ppvz: 0, qty: 0 };
    const svc = svcMap[dt] || { logistics: 0, storage: 0, penalty: 0 };
    const comm = commMap[dt] || { comm: 0 };
    const ad = adsMap[dt] || { total: 0 };
    const ord = ordMap[dt] || { order_sum: 0, order_count: 0 };

    const salesRpwd = Number(s.rpwd) || 0;
    const returnsRpwd = Number(ret.rpwd) || 0;
    const salesQty = Number(s.qty) || 0;
    const returnsQty = Number(ret.qty) || 0;
    const realization = salesRpwd - returnsRpwd;
    const ppvz = (Number(s.ppvz) || 0) - (Number(ret.ppvz) || 0);
    const nds = ppvz * 5 / 105;
    const usn = (ppvz - nds) * 0.01;
    const totalSvc = (Number(comm.comm) || 0) + (Number(svc.logistics) || 0) + (Number(ad.total) || 0) + (Number(svc.storage) || 0) + (Number(svc.penalty) || 0);
    const cogsSum = Number(s.cogs_sum) || 0;
    const avgCogs = salesQty > 0 ? cogsSum / salesQty : ZERO_COGS_PER_UNIT;
    const profit = realization - totalSvc - cogsSum + returnsQty * avgCogs - usn - nds;

    result.push({
      date: dt,
      orders_rub: Number(ord.order_sum) || 0,
      orders_count: Number(ord.order_count) || 0,
      sales_rub: salesRpwd,
      returns_rub: returnsRpwd,
      realization,
      sales_qty: salesQty,
      returns_qty: returnsQty,
      net_qty: salesQty - returnsQty,
      commission: Number(comm.comm) || 0,
      logistics: Number(svc.logistics) || 0,
      storage: Number(svc.storage) || 0,
      penalty: Number(svc.penalty) || 0,
      ad_spend: Number(ad.total) || 0,
      cogs: cogsSum,
      profit,
    });
  }
  return result;
}

// ─── Filters ─────────────────────────────────────────────────

let filtersCache: { suppliers: string[]; brands: string[]; subjects: string[]; articles: { nm_id: number; sa_name: string; brand_name: string; subject_name: string }[]; sizes: string[] } | null = null;
let filtersCacheTime = 0;
const FILTERS_CACHE_TTL = 10 * 60 * 1000;

export async function getFiltersPg() {
  const articles = await pgRows<{ nm_id: number; sa_name: string; brand_name: string; subject_name: string; ppvz_supplier_name: string; ts_name: string }>(`
    SELECT DISTINCT nm_id, sa_name, brand_name, subject_name, ppvz_supplier_name, ts_name
    FROM realization WHERE supplier_oper_name = 'Продажа' AND nm_id > 0
  `);

  const suppliers = new Set<string>();
  const brands = new Set<string>();
  const subjects = new Set<string>();
  const sizes = new Set<string>();
  const articleMap = new Map<number, { nm_id: number; sa_name: string; brand_name: string; subject_name: string }>();

  for (const a of articles) {
    if (a.ppvz_supplier_name) suppliers.add(a.ppvz_supplier_name);
    if (a.brand_name) brands.add(a.brand_name);
    if (a.subject_name) subjects.add(a.subject_name);
    if (a.ts_name) sizes.add(a.ts_name);
    if (!articleMap.has(a.nm_id)) articleMap.set(a.nm_id, { nm_id: a.nm_id, sa_name: a.sa_name, brand_name: a.brand_name, subject_name: a.subject_name });
  }

  return {
    suppliers: [...suppliers].sort(),
    brands: [...brands].sort(),
    subjects: [...subjects].sort(),
    sizes: [...sizes].sort(),
    articles: [...articleMap.values()].sort((a, b) => (a.sa_name || "").localeCompare(b.sa_name || "")),
  };
}
