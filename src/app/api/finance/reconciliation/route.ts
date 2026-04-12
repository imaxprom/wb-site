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
  corrections: number;
}

const EMPTY_METRICS: WeekMetrics = {
  salesQty: 0, returnsQty: 0, sales: 0, returns: 0,
  ppvz: 0, ppvzReturns: 0, logistics: 0, deliveryCount: 0,
  returnCount: 0, storage: 0, penalties: 0, acceptance: 0,
  deductions: 0, rebill: 0, acquiring: 0, compensation: 0,
  corrections: 0,
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
      COALESCE(SUM(CASE WHEN supplier_oper_name = 'Возврат' THEN ppvz_for_pay ELSE 0 END), 0) as ppvzReturns,
      COALESCE(SUM(CASE WHEN supplier_oper_name NOT IN (
        'Продажа','Возврат','Логистика','Хранение','Штраф','Удержание',
        'Обработка товара','Возмещение за выдачу и возврат товаров на ПВЗ',
        'Возмещение издержек по перевозке/по складским операциям с товаром',
        'Компенсация скидки по программе лояльности'
      ) THEN COALESCE(ppvz_for_pay, 0) + COALESCE(delivery_rub, 0) ELSE 0 END), 0) as corrections
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
    corrections: Math.round(salesRow.corrections),
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
    corrections: 0,
  };
}

/**
 * Получить loyalty_compensation из weekly_reports.db для периода.
 * В finance.db weekly_final строки «Компенсация скидки по программе лояльности»
 * имеют additional_payment = 0, поэтому берём реальные данные из weekly_reports.db.
 */
function getLoyaltyCompensation(db: Database.Database | null, dateFrom: string, dateTo: string): number {
  if (!db) return 0;
  const row = db.prepare(`
    SELECT COALESCE(SUM(loyalty_compensation), 0) as lc
    FROM weekly_rows
    WHERE period_from = ? AND period_to = ?
  `).get(dateFrom, dateTo) as { lc: number } | undefined;
  return row ? Math.round(row.lc) : 0;
}

/**
 * GET /api/finance/reconciliation
 * Сверка: API weekly_final vs Excel ЛК
 * Показывает расхождения между двумя источниками данных WB
 */
export async function GET(request: NextRequest) {
  try {
    const finDb = new Database(FINANCE_DB, { readonly: true });
    finDb.pragma("busy_timeout = 5000");
    finDb.pragma("journal_mode = WAL");

    let wkDb: Database.Database | null = null;
    try {
      wkDb = new Database(WEEKLY_DB, { readonly: true });
      wkDb.pragma("busy_timeout = 5000");
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
      apiWeekly: WeekMetrics; excelLk: WeekMetrics;
      hasExcel: boolean;
    }> = weeks.map(w => {
      const apiWeekly = getFinanceMetrics(finDb, w.date_from, w.date_to, "weekly_final");
      // weekly_final в finance.db имеет additional_payment=0 для лояльности,
      // берём реальную сумму из weekly_reports.db
      const loyaltyFromWeekly = getLoyaltyCompensation(wkDb, w.date_from, w.date_to);
      if (loyaltyFromWeekly !== 0) {
        apiWeekly.compensation = loyaltyFromWeekly;
      }
      const excelLk = wkDb ? getExcelMetrics(wkDb, w.date_from, w.date_to) : { ...EMPTY_METRICS };
      const hasExcel = excelLk.sales > 0 || excelLk.logistics > 0;

      return {
        dateFrom: w.date_from,
        dateTo: w.date_to,
        status: "final" as const,
        apiWeekly,
        excelLk,
        hasExcel,
      };
    });

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

    finDb.close();
    wkDb?.close();

    return NextResponse.json({ weeks: result, totalApi, totalExcel });
  } catch (error) {
    return apiError(error);
  }
}
