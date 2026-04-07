import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-utils";
import Database from "better-sqlite3";
import path from "path";

const FINANCE_DB = path.join(process.cwd(), "data", "finance.db");
const WEEKLY_DB = path.join(process.cwd(), "data", "weekly_reports.db");

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
}

const EMPTY_METRICS: WeekMetrics = {
  salesQty: 0, returnsQty: 0, sales: 0, returns: 0,
  ppvz: 0, ppvzReturns: 0, logistics: 0, deliveryCount: 0,
  returnCount: 0, storage: 0, penalties: 0, acceptance: 0,
  deductions: 0, rebill: 0, acquiring: 0, compensation: 0,
};

/**
 * Метрики из finance.db (API reportDetailByPeriod)
 * Продажи/возвраты по sale_dt, сервисы по rr_dt
 */
function getFinanceMetrics(db: Database.Database, dateFrom: string, dateTo: string, source?: string): WeekMetrics {
  const sourceFilter = source ? ` AND source = '${source}'` : "";
  // weekly_final: фильтруем по date_from/date_to (период отчёта), т.к. sale_dt может быть из прошлого (коррекции)
  const useReportPeriod = source === "weekly_final";
  const saleDateFilter = useReportPeriod
    ? "date_from >= ? AND date_to <= ?"
    : "sale_dt >= ? AND sale_dt <= ?";
  const svcDateFilter = useReportPeriod
    ? "date_from >= ? AND date_to <= ?"
    : "rr_dt >= ? AND rr_dt <= ?";

  const salesRow = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN supplier_oper_name = 'Продажа' THEN quantity ELSE 0 END), 0) as salesQty,
      COALESCE(SUM(CASE WHEN supplier_oper_name = 'Возврат' THEN quantity ELSE 0 END), 0) as returnsQty,
      COALESCE(SUM(CASE WHEN supplier_oper_name = 'Продажа' THEN retail_price_withdisc_rub ELSE 0 END), 0) as sales,
      COALESCE(SUM(CASE WHEN supplier_oper_name = 'Возврат' THEN retail_price_withdisc_rub ELSE 0 END), 0) as returns,
      COALESCE(SUM(CASE WHEN supplier_oper_name = 'Продажа' THEN ppvz_for_pay ELSE 0 END), 0) as ppvz,
      COALESCE(SUM(CASE WHEN supplier_oper_name = 'Возврат' THEN ppvz_for_pay ELSE 0 END), 0) as ppvzReturns
    FROM realization
    WHERE ${saleDateFilter} ${sourceFilter}
  `).get(dateFrom, dateTo) as Record<string, number>;

  const svcRow = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN supplier_oper_name = 'Логистика' THEN delivery_rub ELSE 0 END), 0) as logistics,
      COALESCE(SUM(delivery_amount), 0) as deliveryCount,
      COALESCE(SUM(return_amount), 0) as returnCount,
      COALESCE(SUM(storage_fee), 0) as storage,
      COALESCE(SUM(penalty), 0) as penalties,
      COALESCE(SUM(acceptance), 0) as acceptance,
      COALESCE(SUM(deduction), 0) as deductions,
      COALESCE(SUM(rebill_logistic_cost), 0) as rebill,
      COALESCE(SUM(acquiring_fee), 0) as acquiring,
      COALESCE(SUM(additional_payment), 0) as compensation
    FROM realization
    WHERE ${svcDateFilter} ${sourceFilter}
  `).get(dateFrom, dateTo) as Record<string, number>;

  return {
    salesQty: Math.round(salesRow.salesQty),
    returnsQty: Math.round(salesRow.returnsQty),
    sales: Math.round(salesRow.sales),
    returns: Math.round(salesRow.returns),
    ppvz: Math.round(salesRow.ppvz),
    ppvzReturns: Math.round(salesRow.ppvzReturns),
    logistics: Math.round(svcRow.logistics),
    deliveryCount: Math.round(svcRow.deliveryCount),
    returnCount: Math.round(svcRow.returnCount),
    storage: Math.round(svcRow.storage),
    penalties: Math.round(svcRow.penalties),
    acceptance: Math.round(svcRow.acceptance),
    deductions: Math.round(svcRow.deductions),
    rebill: Math.round(svcRow.rebill),
    acquiring: Math.round(svcRow.acquiring),
    compensation: Math.round(svcRow.compensation),
  };
}

/**
 * Метрики из weekly_reports.db (Excel ЛК WB)
 * Все данные привязаны к sale_dt (единственная дата в Excel)
 */
function getExcelMetrics(db: Database.Database, dateFrom: string, dateTo: string): WeekMetrics {
  const row = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN supplier_oper_name = 'Продажа' THEN quantity ELSE 0 END), 0) as salesQty,
      COALESCE(SUM(CASE WHEN supplier_oper_name = 'Возврат' THEN quantity ELSE 0 END), 0) as returnsQty,
      COALESCE(SUM(CASE WHEN supplier_oper_name = 'Продажа' THEN retail_price_withdisc_rub ELSE 0 END), 0) as sales,
      COALESCE(SUM(CASE WHEN supplier_oper_name = 'Возврат' THEN retail_price_withdisc_rub ELSE 0 END), 0) as returns,
      COALESCE(SUM(CASE WHEN supplier_oper_name = 'Продажа' THEN ppvz_for_pay ELSE 0 END), 0) as ppvz,
      COALESCE(SUM(CASE WHEN supplier_oper_name = 'Возврат' THEN ppvz_for_pay ELSE 0 END), 0) as ppvzReturns,
      COALESCE(SUM(delivery_rub), 0) as logistics,
      COALESCE(SUM(delivery_amount), 0) as deliveryCount,
      COALESCE(SUM(return_amount), 0) as returnCount,
      COALESCE(SUM(storage_fee), 0) as storage,
      COALESCE(SUM(penalty), 0) as penalties,
      COALESCE(SUM(acceptance), 0) as acceptance,
      COALESCE(SUM(deduction), 0) as deductions,
      COALESCE(SUM(rebill_logistic_cost), 0) as rebill,
      COALESCE(SUM(acquiring_fee), 0) as acquiring,
      COALESCE(SUM(loyalty_compensation), 0) as compensation
    FROM weekly_rows
    WHERE period_from = ? AND period_to = ?
  `).get(dateFrom, dateTo) as Record<string, number> | undefined;

  if (!row) return { ...EMPTY_METRICS };

  return {
    salesQty: Math.round(row.salesQty),
    returnsQty: Math.round(row.returnsQty),
    sales: Math.round(row.sales),
    returns: Math.round(row.returns),
    ppvz: Math.round(row.ppvz),
    ppvzReturns: Math.round(row.ppvzReturns),
    logistics: Math.round(row.logistics),
    deliveryCount: Math.round(row.deliveryCount),
    returnCount: Math.round(row.returnCount),
    storage: Math.round(row.storage),
    penalties: Math.round(row.penalties),
    acceptance: Math.round(row.acceptance),
    deductions: Math.round(row.deductions),
    rebill: Math.round(row.rebill),
    acquiring: Math.round(row.acquiring),
    compensation: Math.round(row.compensation),
  };
}

/**
 * GET /api/finance/reconciliation
 * Три столбца: API недельный | Excel ЛК | 7 дней ежедневный
 */
export async function GET(request: NextRequest) {
  try {
    const finDb = new Database(FINANCE_DB, { readonly: true });
    finDb.pragma("journal_mode = WAL");

    let wkDb: Database.Database | null = null;
    try {
      wkDb = new Database(WEEKLY_DB, { readonly: true });
      wkDb.pragma("journal_mode = WAL");
    } catch {
      // weekly_reports.db может не существовать
    }

    // Все недели с weekly_final
    const weeks = finDb.prepare(`
      SELECT DISTINCT date_from, date_to 
      FROM realization 
      WHERE source = 'weekly_final' AND date_from != '' AND date_to != ''
      GROUP BY date_from, date_to
      ORDER BY date_from DESC
      LIMIT 12
    `).all() as { date_from: string; date_to: string }[];

    const result: Array<{
      dateFrom: string; dateTo: string; status: "final" | "preliminary";
      apiWeekly: WeekMetrics; excelLk: WeekMetrics; daily7: WeekMetrics;
      hasDaily: boolean; hasExcel: boolean;
    }> = weeks.map(w => {
      const apiWeekly = getFinanceMetrics(finDb, w.date_from, w.date_to, "weekly_final");
      const daily7 = getFinanceMetrics(finDb, w.date_from, w.date_to, "daily");
      const excelLk = wkDb ? getExcelMetrics(wkDb, w.date_from, w.date_to) : { ...EMPTY_METRICS };
      const hasDaily = daily7.sales > 0 || daily7.logistics > 0;
      const hasExcel = excelLk.sales > 0 || excelLk.logistics > 0;

      return {
        dateFrom: w.date_from,
        dateTo: w.date_to,
        status: "final" as const,
        apiWeekly,
        excelLk,
        daily7,
        hasDaily,
        hasExcel,
      };
    });

    // Текущая неделя (только daily, нет weekly_final)
    const now = new Date();
    const msk = new Date(now.getTime() + 3 * 60 * 60 * 1000);
    const dayOfWeek = msk.getDay();
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    const thisMonday = new Date(msk);
    thisMonday.setDate(msk.getDate() - daysToMonday);
    const thisMondayStr = thisMonday.toISOString().slice(0, 10);
    const todayStr = msk.toISOString().slice(0, 10);

    const currentDaily = getFinanceMetrics(finDb, thisMondayStr, todayStr);
    if (currentDaily.sales > 0) {
      result.unshift({
        dateFrom: thisMondayStr,
        dateTo: todayStr,
        status: "preliminary",
        apiWeekly: { ...EMPTY_METRICS },
        excelLk: { ...EMPTY_METRICS },
        daily7: currentDaily,
        hasDaily: true,
        hasExcel: false,
      });
    }

    finDb.close();
    wkDb?.close();

    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
