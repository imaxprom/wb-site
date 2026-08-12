import { NextRequest, NextResponse } from "next/server";
import { activateAuthenticatedRequestContext, requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { pgGet, pgRows } from "@/lib/postgres";

interface WeekMetrics {
  salesQty: number;
  returnsQty: number;
  sales: number;
  returns: number;
  ppvz: number;
  ppvzReturns: number;
  logistics: number;
  deliveryCount: number;
  returnCount: number;
  storage: number;
  penalties: number;
  acceptance: number;
  deductions: number;
  rebill: number;
  acquiring: number;
  compensation: number;
  corrections: number;
}

const EMPTY_METRICS: WeekMetrics = {
  salesQty: 0, returnsQty: 0, sales: 0, returns: 0,
  ppvz: 0, ppvzReturns: 0, logistics: 0, deliveryCount: 0,
  returnCount: 0, storage: 0, penalties: 0, acceptance: 0,
  deductions: 0, rebill: 0, acquiring: 0, compensation: 0,
  corrections: 0,
};

async function getFinanceMetricsPg(dateFrom: string, dateTo: string, source?: string): Promise<WeekMetrics> {
  const sourceFilter = source ? " AND source = ?" : "";
  const queryParams = source ? [dateFrom, dateTo, source] : [dateFrom, dateTo];
  const useReportPeriod = source === "weekly_final";
  const saleDateFilter = useReportPeriod
    ? "date_from >= ? AND date_to <= ?"
    : "sale_dt >= ? AND sale_dt <= ?";
  const svcDateFilter = useReportPeriod
    ? "date_from >= ? AND date_to <= ?"
    : "rr_dt >= ? AND rr_dt <= ?";

  const salesRow = await pgGet<Record<string, number>>(`
    SELECT
      COALESCE(SUM(CASE WHEN supplier_oper_name = 'Продажа' THEN quantity ELSE 0 END), 0) as "salesQty",
      COALESCE(SUM(CASE WHEN supplier_oper_name = 'Возврат' THEN quantity ELSE 0 END), 0) as "returnsQty",
      COALESCE(SUM(CASE WHEN supplier_oper_name = 'Продажа' THEN retail_price_withdisc_rub ELSE 0 END), 0) as sales,
      COALESCE(SUM(CASE WHEN supplier_oper_name = 'Возврат' THEN retail_price_withdisc_rub ELSE 0 END), 0) as returns,
      COALESCE(SUM(CASE WHEN supplier_oper_name = 'Продажа' THEN ppvz_for_pay ELSE 0 END), 0) as ppvz,
      COALESCE(SUM(CASE WHEN supplier_oper_name = 'Возврат' THEN ppvz_for_pay ELSE 0 END), 0) as "ppvzReturns",
      COALESCE(SUM(CASE WHEN supplier_oper_name NOT IN (
        'Продажа','Возврат','Логистика','Хранение','Штраф','Удержание',
        'Обработка товара','Возмещение за выдачу и возврат товаров на ПВЗ',
        'Возмещение издержек по перевозке/по складским операциям с товаром',
        'Компенсация скидки по программе лояльности'
      ) THEN COALESCE(ppvz_for_pay, 0) + COALESCE(delivery_rub, 0) ELSE 0 END), 0) as corrections
    FROM realization
    WHERE ${saleDateFilter} ${sourceFilter}
  `, queryParams) || {};

  const svcRow = await pgGet<Record<string, number>>(`
    SELECT
      COALESCE(SUM(CASE WHEN supplier_oper_name = 'Логистика' THEN delivery_rub ELSE 0 END), 0) as logistics,
      COALESCE(SUM(delivery_amount), 0) as "deliveryCount",
      COALESCE(SUM(return_amount), 0) as "returnCount",
      COALESCE(SUM(storage_fee), 0) as storage,
      COALESCE(SUM(penalty), 0) as penalties,
      COALESCE(SUM(acceptance), 0) as acceptance,
      COALESCE(SUM(deduction), 0) as deductions,
      COALESCE(SUM(rebill_logistic_cost), 0) as rebill,
      COALESCE(SUM(acquiring_fee), 0) as acquiring,
      COALESCE(SUM(additional_payment), 0) as compensation
    FROM realization
    WHERE ${svcDateFilter} ${sourceFilter}
  `, queryParams) || {};

  return {
    salesQty: Math.round(salesRow.salesQty || 0),
    returnsQty: Math.round(salesRow.returnsQty || 0),
    sales: Math.round(salesRow.sales || 0),
    returns: Math.round(salesRow.returns || 0),
    ppvz: Math.round(salesRow.ppvz || 0),
    ppvzReturns: Math.round(salesRow.ppvzReturns || 0),
    logistics: Math.round(svcRow.logistics || 0),
    deliveryCount: Math.round(svcRow.deliveryCount || 0),
    returnCount: Math.round(svcRow.returnCount || 0),
    storage: Math.round(svcRow.storage || 0),
    penalties: Math.round(svcRow.penalties || 0),
    acceptance: Math.round(svcRow.acceptance || 0),
    deductions: Math.round(svcRow.deductions || 0),
    rebill: Math.round(svcRow.rebill || 0),
    acquiring: Math.round(svcRow.acquiring || 0),
    compensation: Math.round(svcRow.compensation || 0),
    corrections: Math.round(salesRow.corrections || 0),
  };
}

async function getExcelMetricsPg(dateFrom: string, dateTo: string): Promise<WeekMetrics> {
  const row = await pgGet<Record<string, number>>(`
    SELECT
      COALESCE(SUM(CASE WHEN supplier_oper_name = 'Продажа' THEN quantity ELSE 0 END), 0) as "salesQty",
      COALESCE(SUM(CASE WHEN supplier_oper_name = 'Возврат' THEN quantity ELSE 0 END), 0) as "returnsQty",
      COALESCE(SUM(CASE WHEN supplier_oper_name = 'Продажа' THEN retail_price_withdisc_rub ELSE 0 END), 0) as sales,
      COALESCE(SUM(CASE WHEN supplier_oper_name = 'Возврат' THEN retail_price_withdisc_rub ELSE 0 END), 0) as returns,
      COALESCE(SUM(CASE WHEN supplier_oper_name = 'Продажа' THEN ppvz_for_pay ELSE 0 END), 0) as ppvz,
      COALESCE(SUM(CASE WHEN supplier_oper_name = 'Возврат' THEN ppvz_for_pay ELSE 0 END), 0) as "ppvzReturns",
      COALESCE(SUM(delivery_rub), 0) as logistics,
      COALESCE(SUM(delivery_amount), 0) as "deliveryCount",
      COALESCE(SUM(return_amount), 0) as "returnCount",
      COALESCE(SUM(storage_fee), 0) as storage,
      COALESCE(SUM(penalty), 0) as penalties,
      COALESCE(SUM(acceptance), 0) as acceptance,
      COALESCE(SUM(deduction), 0) as deductions,
      COALESCE(SUM(rebill_logistic_cost), 0) as rebill,
      COALESCE(SUM(acquiring_fee), 0) as acquiring,
      COALESCE(SUM(loyalty_compensation), 0) as compensation
    FROM weekly_rows
    WHERE period_from = ? AND period_to = ?
  `, [dateFrom, dateTo]);

  if (!row) return { ...EMPTY_METRICS };

  return {
    salesQty: Math.round(row.salesQty || 0),
    returnsQty: Math.round(row.returnsQty || 0),
    sales: Math.round(row.sales || 0),
    returns: Math.round(row.returns || 0),
    ppvz: Math.round(row.ppvz || 0),
    ppvzReturns: Math.round(row.ppvzReturns || 0),
    logistics: Math.round(row.logistics || 0),
    deliveryCount: Math.round(row.deliveryCount || 0),
    returnCount: Math.round(row.returnCount || 0),
    storage: Math.round(row.storage || 0),
    penalties: Math.round(row.penalties || 0),
    acceptance: Math.round(row.acceptance || 0),
    deductions: Math.round(row.deductions || 0),
    rebill: Math.round(row.rebill || 0),
    acquiring: Math.round(row.acquiring || 0),
    compensation: Math.round(row.compensation || 0),
    corrections: 0,
  };
}

async function getLoyaltyCompensationPg(dateFrom: string, dateTo: string): Promise<number> {
  const row = await pgGet<{ lc: number }>(`
    SELECT COALESCE(SUM(loyalty_compensation), 0) as lc
    FROM weekly_rows
    WHERE period_from = ? AND period_to = ?
  `, [dateFrom, dateTo]);
  return row ? Math.round(row.lc || 0) : 0;
}

/**
 * GET /api/finance/reconciliation
 * Сверка: API weekly_final vs Excel ЛК
 * Показывает расхождения между двумя источниками данных WB
 */
export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  activateAuthenticatedRequestContext(request);

  try {
    const weeks = await pgRows<{ date_from: string; date_to: string; has_api: boolean; has_excel: boolean }>(`
      WITH periods AS (
        SELECT date_from, date_to, TRUE AS has_api, FALSE AS has_excel
        FROM realization
        WHERE source = 'weekly_final' AND date_from != '' AND date_to != ''
        GROUP BY date_from, date_to

        UNION ALL

        SELECT period_from AS date_from, period_to AS date_to, FALSE AS has_api, TRUE AS has_excel
        FROM weekly_rows
        WHERE period_from != '' AND period_to != ''
        GROUP BY period_from, period_to
      )
      SELECT date_from, date_to,
        BOOL_OR(has_api) AS has_api,
        BOOL_OR(has_excel) AS has_excel
      FROM periods
      GROUP BY date_from, date_to
      ORDER BY date_from DESC
    `);

    const result: Array<{
      dateFrom: string; dateTo: string; status: "final" | "preliminary";
      apiWeekly: WeekMetrics; excelLk: WeekMetrics;
      hasExcel: boolean;
    }> = [];

    for (const w of weeks) {
      const apiWeekly = w.has_api
        ? await getFinanceMetricsPg(w.date_from, w.date_to, "weekly_final")
        : { ...EMPTY_METRICS };
      if (w.has_api) {
        const loyaltyFromWeekly = await getLoyaltyCompensationPg(w.date_from, w.date_to);
        if (loyaltyFromWeekly !== 0) {
          apiWeekly.compensation = loyaltyFromWeekly;
        }
      }
      const excelLk = await getExcelMetricsPg(w.date_from, w.date_to);
      const hasExcel = excelLk.sales > 0 || excelLk.logistics > 0;

      result.push({
        dateFrom: w.date_from,
        dateTo: w.date_to,
        status: w.has_api ? "final" as const : "preliminary" as const,
        apiWeekly,
        excelLk,
        hasExcel,
      });
    }

    // Итог по всем завершённым неделям (суммы API и Excel)
    const totalApi: WeekMetrics = { ...EMPTY_METRICS };
    const totalExcel: WeekMetrics = { ...EMPTY_METRICS };
    for (const w of result) {
      if (w.status !== "final") continue;
      for (const key of Object.keys(EMPTY_METRICS) as (keyof WeekMetrics)[]) {
        totalApi[key] += w.apiWeekly[key];
        if (w.hasExcel) totalExcel[key] += w.excelLk[key];
      }
    }

    return NextResponse.json({ weeks: result, totalApi, totalExcel });
  } catch (error) {
    return apiError(error);
  }
}
