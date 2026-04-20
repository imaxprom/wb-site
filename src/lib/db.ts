import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { DEFAULT_COGS_PER_UNIT } from "./constants";

const DB_PATH = path.join(process.cwd(), "data", "finance.db");
const WEEKLY_DB_PATH = path.join(process.cwd(), "data", "weekly_reports.db");

let db: Database.Database | null = null;
let weeklyDb: Database.Database | null = null;
let cogsMap: Map<string, number> | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH, { readonly: true });
    db.pragma("journal_mode = WAL");
    db.pragma("cache_size = -64000"); // 64MB cache
    db.pragma("busy_timeout = 5000");
    // Индекс на source для дедупликации weekly_final
    try {
      const writeDb = new Database(DB_PATH);
      writeDb.exec("CREATE INDEX IF NOT EXISTS idx_real_source_dates ON realization(source, date_from, date_to)");
      writeDb.close();
    } catch { /* readonly fallback — индекс уже есть или нет прав */ }
  }
  return db;
}

/** Предзагрузка всех себестоимостей в Map (1 запрос вместо N) */
function getCogsMap(): Map<string, number> {
  if (cogsMap) return cogsMap;
  const d = getDb();
  const rows = d.prepare("SELECT barcode, cost FROM cogs").all() as { barcode: string; cost: number }[];
  cogsMap = new Map(rows.map(r => [r.barcode, r.cost]));
  return cogsMap;
}

export function getWeeklyDb(): Database.Database | null {
  if (!weeklyDb && fs.existsSync(WEEKLY_DB_PATH)) {
    weeklyDb = new Database(WEEKLY_DB_PATH, { readonly: true });
    weeklyDb.pragma("journal_mode = WAL");
    weeklyDb.pragma("busy_timeout = 5000");
  }
  return weeklyDb;
}

/**
 * Возвращает список недельных периодов, покрытых в weekly_reports.db
 */
function getWeeklyPeriods(wdb: Database.Database): { period_from: string; period_to: string }[] {
  return wdb.prepare(`
    SELECT DISTINCT period_from, period_to FROM weekly_rows 
    WHERE period_from != '' AND period_to != '' 
    ORDER BY period_from
  `).all() as { period_from: string; period_to: string }[];
}

/**
 * Гибридный P&L: Excel (эталон) за завершённые недели + API за «хвост».
 *
 * 1. Находим все Excel-недели, пересекающиеся с запрошенным периодом.
 * 2. Продажи/возвраты фильтруем по sale_dt (точность до дня).
 * 3. Услуги фильтруем по sale_dt (в Excel нет rr_dt).
 * 4. Граница раздела = MAX(period_to) из пересекающихся недель.
 * 5. Дни после границы — дополняем из finance.db (API-данные).
 */
function getPnlFromExcel(wdb: Database.Database, dateFrom: string, dateTo: string, nmId?: number): {
  salesRow: Record<string, number>;
  returnsRow: Record<string, number>;
  svcRow: Record<string, number>;
  loyaltyComp: number;
  cogs: number;
  commSales: number;
  commReturns: number;
} | null {
  const nmWhere = nmId ? "AND nm_id = ?" : "";
  const nmParams = nmId ? [nmId] : [];

  const periods = getWeeklyPeriods(wdb);
  if (periods.length === 0) return null;

  // Пересечение: неделя пересекается с [dateFrom, dateTo]
  const overlapping = periods.filter(p => p.period_from <= dateTo && p.period_to >= dateFrom);
  if (overlapping.length === 0) return null;

  // Граница Excel-покрытия
  const excelEnd = overlapping[overlapping.length - 1].period_to;
  // Excel sale_dt диапазон: [dateFrom, min(dateTo, excelEnd)]
  const excelSaleTo = excelEnd < dateTo ? excelEnd : dateTo;

  // Строим условие по пересекающимся неделям (для услуг без sale_dt, напр. loyalty)
  const periodPlaceholders = overlapping.map(() => "(period_from = ? AND period_to = ?)").join(" OR ");
  const periodParams = overlapping.flatMap(p => [p.period_from, p.period_to]);
  const pf = `AND (${periodPlaceholders})`;

  // ── Excel: продажи/возвраты по sale_dt (точная фильтрация) ──
  const salesRow = wdb.prepare(`
    SELECT
      COALESCE(SUM(retail_price_withdisc_rub), 0) as rpwd,
      COALESCE(SUM(retail_amount), 0) as ra,
      COALESCE(SUM(ppvz_for_pay), 0) as ppvz,
      COALESCE(SUM(quantity), 0) as qty
    FROM weekly_rows
    WHERE supplier_oper_name = 'Продажа'
      AND sale_dt >= ? AND sale_dt <= ? ${nmWhere}
  `).get(dateFrom, excelSaleTo, ...nmParams) as Record<string, number>;

  if (!salesRow || salesRow.rpwd === 0) return null;

  const returnsRow = wdb.prepare(`
    SELECT
      COALESCE(SUM(retail_price_withdisc_rub), 0) as rpwd,
      COALESCE(SUM(retail_amount), 0) as ra,
      COALESCE(SUM(ppvz_for_pay), 0) as ppvz,
      COALESCE(SUM(quantity), 0) as qty
    FROM weekly_rows
    WHERE supplier_oper_name = 'Возврат'
      AND sale_dt >= ? AND sale_dt <= ? ${nmWhere}
  `).get(dateFrom, excelSaleTo, ...nmParams) as Record<string, number>;

  // ── Excel: комиссия по sale_dt ──
  const commSalesRow = wdb.prepare(`
    SELECT COALESCE(SUM(retail_price_withdisc_rub - ppvz_for_pay), 0) as comm
    FROM weekly_rows
    WHERE supplier_oper_name = 'Продажа'
      AND sale_dt >= ? AND sale_dt <= ? ${nmWhere}
  `).get(dateFrom, excelSaleTo, ...nmParams) as Record<string, number>;

  const commReturnsRow = wdb.prepare(`
    SELECT COALESCE(SUM(retail_price_withdisc_rub - ppvz_for_pay), 0) as comm
    FROM weekly_rows
    WHERE supplier_oper_name = 'Возврат'
      AND sale_dt >= ? AND sale_dt <= ? ${nmWhere}
  `).get(dateFrom, excelSaleTo, ...nmParams) as Record<string, number>;

  // ── Excel: услуги по sale_dt ──
  const svcRow = wdb.prepare(`
    SELECT
      COALESCE(SUM(delivery_rub), 0) as logistics,
      COALESCE(SUM(storage_fee), 0) as storage,
      COALESCE(SUM(penalty), 0) as penalty,
      COALESCE(SUM(acceptance), 0) as acceptance,
      COALESCE(SUM(rebill_logistic_cost), 0) as rebill
    FROM weekly_rows
    WHERE sale_dt >= ? AND sale_dt <= ? ${nmWhere}
  `).get(dateFrom, excelSaleTo, ...nmParams) as Record<string, number>;

  // ── Excel: loyalty по period (нет sale_dt для этих строк) ──
  const loyaltyRow = wdb.prepare(`
    SELECT COALESCE(SUM(loyalty_compensation), 0) as total
    FROM weekly_rows
    WHERE 1=1 ${pf}
  `).get(...periodParams) as Record<string, number>;

  // ── Excel: COGS по sale_dt (Map вместо N запросов) ──
  const costs = getCogsMap();
  let cogs = 0;
  const qtyRows = wdb.prepare(`
    SELECT barcode, SUM(quantity) as qty FROM weekly_rows
    WHERE supplier_oper_name = 'Продажа' AND sale_dt >= ? AND sale_dt <= ?
    GROUP BY barcode
  `).all(dateFrom, excelSaleTo) as { barcode: string; qty: number }[];
  for (const row of qtyRows) {
    cogs += row.qty * (costs.get(row.barcode) || DEFAULT_COGS_PER_UNIT);
  }
  let cogsReturns = 0;
  const retQtyRows = wdb.prepare(`
    SELECT barcode, SUM(quantity) as qty FROM weekly_rows
    WHERE supplier_oper_name = 'Возврат' AND sale_dt >= ? AND sale_dt <= ?
    GROUP BY barcode
  `).all(dateFrom, excelSaleTo) as { barcode: string; qty: number }[];
  for (const row of retQtyRows) {
    cogsReturns += row.qty * (costs.get(row.barcode) || DEFAULT_COGS_PER_UNIT);
  }

  // ── API-хвост: дни после excelEnd (если dateTo > excelEnd) ──
  if (excelEnd < dateTo) {
    const tailFrom = nextDay(excelEnd);
    const tailTo = dateTo;
    const finDb = getDb();

    const tailSales = finDb.prepare(`
      SELECT
        COALESCE(SUM(retail_price_withdisc_rub), 0) as rpwd,
        COALESCE(SUM(retail_amount), 0) as ra,
        COALESCE(SUM(ppvz_for_pay), 0) as ppvz,
        COALESCE(SUM(quantity), 0) as qty,
        COALESCE(SUM(quantity * COALESCE((SELECT cost FROM cogs WHERE cogs.barcode = r.barcode), ${DEFAULT_COGS_PER_UNIT})), 0) as cogs
      FROM realization r
      WHERE supplier_oper_name = 'Продажа' AND sale_dt >= ? AND sale_dt <= ?
    `).get(tailFrom, tailTo) as Record<string, number>;

    const tailReturns = finDb.prepare(`
      SELECT
        COALESCE(SUM(retail_price_withdisc_rub), 0) as rpwd,
        COALESCE(SUM(retail_amount), 0) as ra,
        COALESCE(SUM(ppvz_for_pay), 0) as ppvz,
        COALESCE(SUM(quantity), 0) as qty,
        COALESCE(SUM(quantity * COALESCE((SELECT cost FROM cogs WHERE cogs.barcode = r.barcode), ${DEFAULT_COGS_PER_UNIT})), 0) as cogs
      FROM realization r
      WHERE supplier_oper_name = 'Возврат' AND sale_dt >= ? AND sale_dt <= ?
    `).get(tailFrom, tailTo) as Record<string, number>;

    const tailCommSales = finDb.prepare(`
      SELECT COALESCE(SUM(retail_price_withdisc_rub - ppvz_for_pay), 0) as comm
      FROM realization r
      WHERE supplier_oper_name = 'Продажа' AND sale_dt >= ? AND sale_dt <= ?
    `).get(tailFrom, tailTo) as Record<string, number>;

    const tailCommReturns = finDb.prepare(`
      SELECT COALESCE(SUM(retail_price_withdisc_rub - ppvz_for_pay), 0) as comm
      FROM realization r
      WHERE supplier_oper_name = 'Возврат' AND sale_dt >= ? AND sale_dt <= ?
    `).get(tailFrom, tailTo) as Record<string, number>;

    const tailSvc = finDb.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN supplier_oper_name IN ('Логистика', 'Коррекция логистики') THEN delivery_rub ELSE 0 END), 0) as logistics,
        COALESCE(SUM(storage_fee), 0) as storage,
        COALESCE(SUM(penalty), 0) as penalty,
        COALESCE(SUM(acceptance), 0) as acceptance,
        COALESCE(SUM(rebill_logistic_cost), 0) as rebill
      FROM realization r
      WHERE rr_dt >= ? AND rr_dt <= ?
    `).get(tailFrom, tailTo) as Record<string, number>;

    // Суммируем Excel + API-хвост
    salesRow.rpwd += tailSales.rpwd;
    salesRow.ra += tailSales.ra;
    salesRow.ppvz += tailSales.ppvz;
    salesRow.qty += tailSales.qty;
    (returnsRow as Record<string, number>).rpwd += tailReturns.rpwd;
    (returnsRow as Record<string, number>).ra += tailReturns.ra;
    (returnsRow as Record<string, number>).ppvz += tailReturns.ppvz;
    (returnsRow as Record<string, number>).qty += tailReturns.qty;
    commSalesRow.comm += tailCommSales.comm;
    commReturnsRow.comm += tailCommReturns.comm;
    svcRow.logistics += tailSvc.logistics;
    svcRow.storage += tailSvc.storage;
    svcRow.penalty += tailSvc.penalty;
    svcRow.acceptance += tailSvc.acceptance;
    svcRow.rebill += tailSvc.rebill;
    cogs += tailSales.cogs;
    cogsReturns += tailReturns.cogs;
  }

  return {
    salesRow,
    returnsRow: returnsRow || { rpwd: 0, ra: 0, ppvz: 0, qty: 0 },
    svcRow,
    loyaltyComp: Math.round(loyaltyRow.total || 0),
    cogs: cogs - cogsReturns,
    commSales: commSalesRow.comm,
    commReturns: commReturnsRow.comm,
  };
}

/** Следующий день в формате YYYY-MM-DD (без UTC-сдвига) */
function nextDay(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(y, m - 1, d + 1);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

function getWeeklyFinalPeriods(d: Database.Database): { date_from: string; date_to: string }[] {
  return d.prepare(`
    SELECT DISTINCT date_from, date_to FROM realization
    WHERE source = 'weekly_final' AND date_from != '' AND date_to != ''
  `).all() as { date_from: string; date_to: string }[];
}

/**
 * Возвращает SQL-фрагмент для исключения daily-дублей.
 * Если за неделю есть weekly_final — daily за ту же неделю игнорируются.
 * dateCol: 'sale_dt' или 'rr_dt' — по какому полю фильтровать.
 * alias: алиас таблицы (по умолчанию 'r')
 */
export function getExcludeDailyFilter(d: Database.Database, dateCol: string = "sale_dt", alias: string = "r"): { sql: string; params: string[] } {
  const wfPeriods = getWeeklyFinalPeriods(d);

  if (wfPeriods.length === 0) return { sql: "", params: [] };

  const ranges = wfPeriods.map(() =>
    `(${alias}.${dateCol} >= ? AND ${alias}.${dateCol} <= ?)`
  ).join(" OR ");
  const params = wfPeriods.flatMap(p => [p.date_from, p.date_to]);

  return { sql: `AND NOT (${alias}.source IN ('daily', 'weekly') AND (${ranges}))`, params };
}

// ─── P&L Summary ───────────────────────────────────────────
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

export function getPnl(dateFrom: string, dateTo: string, nmId?: number): PnlResult {
  const d = getDb();
  const wdb = getWeeklyDb();

  // Гибридный источник: Excel (эталон за завершённые недели) + API (хвост)
  if (wdb && !nmId) {
    const excelData = getPnlFromExcel(wdb, dateFrom, dateTo, nmId);
    if (excelData) {
      const { salesRow, returnsRow, svcRow, loyaltyComp, cogs, commSales, commReturns } = excelData;
      const commission = commSales - commReturns;

      // Реклама и заказы — из finance.db (отдельные таблицы, полный период)
      const adRow = d.prepare(`SELECT COALESCE(SUM(amount), 0) as total FROM advertising WHERE date >= ? AND date <= ?`).get(dateFrom, dateTo) as Record<string, number>;
      const ordRow = d.prepare(`SELECT COALESCE(SUM(order_sum), 0) as total FROM orders_funnel WHERE date >= ? AND date <= ?`).get(dateFrom, dateTo) as Record<string, number>;
      const jamRow = d.prepare(`SELECT COALESCE(SUM(deduction), 0) as total FROM realization WHERE bonus_type_name LIKE '%Джем%' AND rr_dt >= ? AND rr_dt <= ?`).get(dateFrom, dateTo) as Record<string, number>;
      const jam = jamRow.total || 0;

      const other = svcRow.storage + svcRow.penalty + svcRow.acceptance;

      return {
        realization: salesRow.rpwd - returnsRow.rpwd,
        sales_rpwd: salesRow.rpwd,
        returns_rpwd: returnsRow.rpwd,
        retail_amount: salesRow.ra - returnsRow.ra,
        loyalty_compensation: loyaltyComp,
        ppvz: salesRow.ppvz - returnsRow.ppvz,
        commission,
        logistics: svcRow.logistics,
        storage: svcRow.storage,
        penalty: svcRow.penalty,
        acceptance: svcRow.acceptance,
        other_services: other,
        jam,
        rebill: svcRow.rebill || 0,
        total_services: commission + svcRow.logistics + adRow.total + other + jam,
        cogs,
        ad_spend: adRow.total,
        orders_sum: ordRow.total,
        sales_qty: salesRow.qty,
        returns_qty: returnsRow.qty,
        net_qty: salesRow.qty - returnsRow.qty,
      };
    }
  }

  // Fallback: finance.db (API данные)
  // Исключаем daily за те недели, где уже есть weekly_final (чтобы не задваивать)
  const excludeDaily = getExcludeDailyFilter(d, "sale_dt", "r");
  const excludeDailySvc = getExcludeDailyFilter(d, "rr_dt", "r");

  // weekly_final: фильтруем по date_from/date_to (период отчёта), т.к. sale_dt может быть из прошлого (коррекции)
  // daily/weekly: фильтруем по sale_dt/rr_dt как раньше
  const saleDateFilter = `((r.source = 'weekly_final' AND r.date_from >= ? AND r.date_to <= ?) OR (r.source != 'weekly_final' AND r.sale_dt >= ? AND r.sale_dt <= ?))`;
  const svcDateFilter = `((r.source = 'weekly_final' AND r.date_from >= ? AND r.date_to <= ?) OR (r.source != 'weekly_final' AND r.rr_dt >= ? AND r.rr_dt <= ?))`;
  // Параметры: dateFrom, dateTo передаются дважды (для каждой ветки OR)
  const saleDateParams = [dateFrom, dateTo, dateFrom, dateTo];
  const svcDateParams = [dateFrom, dateTo, dateFrom, dateTo];

  // Sales/Returns
  const salesWhere = nmId ? "AND nm_id = ?" : "";
  const salesNmParams = nmId ? [nmId] : [];
  const salesParams = [...saleDateParams, ...salesNmParams, ...excludeDaily.params];

  const salesRow = d.prepare(`
    SELECT
      COALESCE(SUM(retail_price_withdisc_rub), 0) as rpwd,
      COALESCE(SUM(retail_amount), 0) as ra,
      COALESCE(SUM(ppvz_for_pay), 0) as ppvz,
      COALESCE(SUM(quantity), 0) as qty,
      COALESCE(SUM(quantity * COALESCE((SELECT cost FROM cogs WHERE cogs.barcode = r.barcode), ${DEFAULT_COGS_PER_UNIT})), 0) as cogs
    FROM realization r
    WHERE supplier_oper_name = 'Продажа'
      AND ${saleDateFilter} ${salesWhere} ${excludeDaily.sql}
  `).get(...salesParams) as Record<string, number>;

  const returnsRow = d.prepare(`
    SELECT
      COALESCE(SUM(retail_price_withdisc_rub), 0) as rpwd,
      COALESCE(SUM(retail_amount), 0) as ra,
      COALESCE(SUM(ppvz_for_pay), 0) as ppvz,
      COALESCE(SUM(quantity), 0) as qty,
      COALESCE(SUM(quantity * COALESCE((SELECT cost FROM cogs WHERE cogs.barcode = r.barcode), ${DEFAULT_COGS_PER_UNIT})), 0) as cogs
    FROM realization r
    WHERE supplier_oper_name = 'Возврат'
      AND ${saleDateFilter} ${salesWhere} ${excludeDaily.sql}
  `).get(...salesParams) as Record<string, number>;

  // Services
  const svcWhere = nmId ? "AND nm_id = ?" : "";
  const svcParams = [...svcDateParams, ...salesNmParams, ...excludeDailySvc.params];

  const svcRow = d.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN supplier_oper_name IN ('Логистика', 'Коррекция логистики') THEN delivery_rub ELSE 0 END), 0) as logistics,
      COALESCE(SUM(storage_fee), 0) as storage,
      COALESCE(SUM(penalty), 0) as penalty,
      COALESCE(SUM(acceptance), 0) as acceptance,
      COALESCE(SUM(rebill_logistic_cost), 0) as rebill
    FROM realization r
    WHERE ${svcDateFilter} ${svcWhere} ${excludeDailySvc.sql}
  `).get(...svcParams) as Record<string, number>;

  // Commission (matches WB dashboard calculation)
  const commSales = d.prepare(`
    SELECT COALESCE(SUM(retail_price_withdisc_rub - ppvz_for_pay), 0) as comm
    FROM realization r
    WHERE supplier_oper_name = 'Продажа' AND ${saleDateFilter} ${salesWhere} ${excludeDaily.sql}
  `).get(...salesParams) as Record<string, number>;

  const commReturns = d.prepare(`
    SELECT COALESCE(SUM(retail_price_withdisc_rub - ppvz_for_pay), 0) as comm
    FROM realization r
    WHERE supplier_oper_name = 'Возврат' AND ${saleDateFilter} ${salesWhere} ${excludeDaily.sql}
  `).get(...salesParams) as Record<string, number>;

  // Advertising
  const adRow = d.prepare(`
    SELECT COALESCE(SUM(amount), 0) as total
    FROM advertising
    WHERE date >= ? AND date <= ?
  `).get(dateFrom, dateTo) as Record<string, number>;

  // Orders from Sales Funnel
  const ordRow = d.prepare(`
    SELECT COALESCE(SUM(order_sum), 0) as total
    FROM orders_funnel
    WHERE date >= ? AND date <= ?
  `).get(dateFrom, dateTo) as Record<string, number>;

  const commission = commSales.comm - commReturns.comm;
  
  // Jam subscription — from deduction field (single payment in specific week)
  const jamRow = d.prepare(`
    SELECT COALESCE(SUM(deduction), 0) as total
    FROM realization r
    WHERE bonus_type_name LIKE '%Джем%' AND ${svcDateFilter} ${excludeDailySvc.sql}
  `).get(...svcDateParams, ...excludeDailySvc.params) as Record<string, number>;
  const jam = jamRow.total;

  // Компенсация скидки по программе лояльности — из weekly_reports.db (кэшированное соединение)
  let loyaltyComp = 0;
  const wkDb = getWeeklyDb();
  if (wkDb) {
    try {
      const loyaltyRange = wkDb.prepare(`
        SELECT COALESCE(SUM(loyalty_compensation), 0) as total
        FROM weekly_rows
        WHERE period_from >= ? AND period_to <= ?
      `).get(dateFrom, dateTo) as Record<string, number>;
      loyaltyComp = Math.round(loyaltyRange.total || 0);
    } catch { /* weekly_reports.db может не иметь данных */ }
  }
  
  const other = svcRow.storage + svcRow.penalty + svcRow.acceptance;

  return {
    realization: salesRow.rpwd - returnsRow.rpwd,
    sales_rpwd: salesRow.rpwd,
    returns_rpwd: returnsRow.rpwd,
    retail_amount: salesRow.ra - returnsRow.ra,
    loyalty_compensation: loyaltyComp,
    ppvz: salesRow.ppvz - returnsRow.ppvz,
    commission,
    logistics: svcRow.logistics,
    storage: svcRow.storage,
    penalty: svcRow.penalty,
    acceptance: svcRow.acceptance,
    other_services: other,
    jam,
    rebill: svcRow.rebill || 0,
    total_services: commission + svcRow.logistics + adRow.total + other + jam,
    cogs: salesRow.cogs - returnsRow.cogs,
    ad_spend: adRow.total,
    orders_sum: ordRow.total,
    sales_qty: salesRow.qty,
    returns_qty: returnsRow.qty,
    net_qty: salesRow.qty - returnsRow.qty,
  };
}

// ─── Daily Data ────────────────────────────────────────────
export interface DailyDbRow {
  date: string;
  orders_rub: number;
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

export function getDaily(dateFrom: string, dateTo: string, nmId?: number): DailyDbRow[] {
  const d = getDb();
  const nmWhere = nmId ? "AND nm_id = ?" : "";
  const nmParams = nmId ? [nmId] : [];
  const exSale = getExcludeDailyFilter(d, "sale_dt", "r");
  const exRr = getExcludeDailyFilter(d, "rr_dt", "r");
  const saleParams = [dateFrom, dateTo, ...nmParams, ...exSale.params];
  const rrParams = [dateFrom, dateTo, ...nmParams, ...exRr.params];

  // Sales by sale_dt per day
  const salesDaily = d.prepare(`
    SELECT sale_dt as date,
      SUM(retail_price_withdisc_rub) as rpwd,
      SUM(ppvz_for_pay) as ppvz,
      SUM(quantity) as qty,
      SUM(quantity * COALESCE((SELECT cost FROM cogs WHERE cogs.barcode = r.barcode), ${DEFAULT_COGS_PER_UNIT})) as cogs_sum
    FROM realization r
    WHERE supplier_oper_name = 'Продажа' AND sale_dt >= ? AND sale_dt <= ? ${nmWhere} ${exSale.sql}
    GROUP BY sale_dt
  `).all(...saleParams) as Record<string, number>[];

  const returnsDaily = d.prepare(`
    SELECT sale_dt as date,
      SUM(retail_price_withdisc_rub) as rpwd,
      SUM(ppvz_for_pay) as ppvz,
      SUM(quantity) as qty
    FROM realization r
    WHERE supplier_oper_name = 'Возврат' AND sale_dt >= ? AND sale_dt <= ? ${nmWhere} ${exSale.sql}
    GROUP BY sale_dt
  `).all(...saleParams) as Record<string, number>[];

  // Services by rr_dt per day
  const svcDaily = d.prepare(`
    SELECT rr_dt as date,
      SUM(CASE WHEN supplier_oper_name IN ('Логистика', 'Коррекция логистики') THEN delivery_rub ELSE 0 END) as logistics,
      SUM(storage_fee) as storage,
      SUM(penalty) as penalty
    FROM realization r
    WHERE rr_dt >= ? AND rr_dt <= ? ${nmWhere} ${exRr.sql}
    GROUP BY rr_dt
  `).all(...rrParams) as Record<string, number>[];

  // Commission by rr_dt
  const commDaily = d.prepare(`
    SELECT rr_dt as date,
      SUM(CASE WHEN supplier_oper_name = 'Продажа' THEN retail_price_withdisc_rub - ppvz_for_pay ELSE 0 END)
      - SUM(CASE WHEN supplier_oper_name = 'Возврат' THEN retail_price_withdisc_rub - ppvz_for_pay ELSE 0 END) as comm
    FROM realization r
    WHERE supplier_oper_name IN ('Продажа','Возврат') AND rr_dt >= ? AND rr_dt <= ? ${nmWhere} ${exRr.sql}
    GROUP BY rr_dt
  `).all(...rrParams) as Record<string, number>[];

  // Ads per day
  const adsDaily = d.prepare(`
    SELECT date, SUM(amount) as total FROM advertising
    WHERE date >= ? AND date <= ? GROUP BY date
  `).all(dateFrom, dateTo) as Record<string, number>[];

  // Orders per day
  const ordersDaily = d.prepare(`
    SELECT date, order_sum FROM orders_funnel
    WHERE date >= ? AND date <= ?
  `).all(dateFrom, dateTo) as Record<string, number>[];

  // Merge all by date
  const map = new Map<string, DailyDbRow>();
  const allDates = new Set<string>();

  for (const r of salesDaily) { allDates.add(r.date as unknown as string); }
  for (const r of svcDaily) { allDates.add(r.date as unknown as string); }
  for (const r of ordersDaily) { allDates.add(r.date as unknown as string); }

  const salesMap = Object.fromEntries(salesDaily.map(r => [r.date, r]));
  const retMap = Object.fromEntries(returnsDaily.map(r => [r.date, r]));
  const svcMap = Object.fromEntries(svcDaily.map(r => [r.date, r]));
  const commMap = Object.fromEntries(commDaily.map(r => [r.date, r]));
  const adsMap = Object.fromEntries(adsDaily.map(r => [r.date, r]));
  const ordMap = Object.fromEntries(ordersDaily.map(r => [r.date, r]));

  const result: DailyDbRow[] = [];

  for (const dt of Array.from(allDates).sort()) {
    const s = salesMap[dt] || { rpwd: 0, ppvz: 0, qty: 0, cogs_sum: 0 };
    const ret = retMap[dt] || { rpwd: 0, ppvz: 0, qty: 0 };
    const svc = svcMap[dt] || { logistics: 0, storage: 0, penalty: 0 };
    const comm = commMap[dt] || { comm: 0 };
    const ad = adsMap[dt] || { total: 0 };
    const ord = ordMap[dt] || { order_sum: 0 };

    const realization = s.rpwd - ret.rpwd;
    const netQty = s.qty - ret.qty;
    const ppvz = s.ppvz - ret.ppvz;
    const nds = ppvz * 5 / 105;
    const usn = (ppvz - nds) * 0.01;
    const totalSvc = comm.comm + svc.logistics + ad.total + svc.storage + svc.penalty;
    const avgCogs = s.qty > 0 ? s.cogs_sum / s.qty : 300;
    const profit = realization - totalSvc - s.cogs_sum + (retMap[dt]?.qty || 0) * avgCogs - usn - nds;

    result.push({
      date: dt as unknown as string,
      orders_rub: ord.order_sum,
      sales_rub: s.rpwd,
      returns_rub: ret.rpwd,
      realization,
      sales_qty: s.qty,
      returns_qty: ret.qty,
      net_qty: netQty,
      commission: comm.comm,
      logistics: svc.logistics,
      storage: svc.storage,
      penalty: svc.penalty,
      ad_spend: ad.total,
      cogs: s.cogs_sum,
      profit,
    });
  }

  return result;
}

// ─── Filters ───────────────────────────────────────────────
/** Кэш фильтров (меняются редко, пересчёт раз в 10 минут) */
let filtersCache: { suppliers: string[]; brands: string[]; subjects: string[]; articles: { nm_id: number; sa_name: string; brand_name: string; subject_name: string }[]; sizes: string[] } | null = null;
let filtersCacheTime = 0;
const FILTERS_CACHE_TTL = 10 * 60 * 1000; // 10 минут

export function getFilters() {
  if (filtersCache && Date.now() - filtersCacheTime < FILTERS_CACHE_TTL) {
    return filtersCache;
  }

  const d = getDb();

  // Один запрос вместо 5 отдельных DISTINCT по 2.1M строк
  const articles = d.prepare(`
    SELECT DISTINCT nm_id, sa_name, brand_name, subject_name, ppvz_supplier_name, ts_name
    FROM realization
    WHERE supplier_oper_name = 'Продажа' AND nm_id > 0
  `).all() as { nm_id: number; sa_name: string; brand_name: string; subject_name: string; ppvz_supplier_name: string; ts_name: string }[];

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
    if (!articleMap.has(a.nm_id)) {
      articleMap.set(a.nm_id, { nm_id: a.nm_id, sa_name: a.sa_name, brand_name: a.brand_name, subject_name: a.subject_name });
    }
  }

  const result = {
    suppliers: [...suppliers].sort(),
    brands: [...brands].sort(),
    subjects: [...subjects].sort(),
    articles: [...articleMap.values()].sort((a, b) => (a.sa_name || "").localeCompare(b.sa_name || "")),
    sizes: [...sizes].sort(),
  };

  filtersCache = result;
  filtersCacheTime = Date.now();
  return result;
}
