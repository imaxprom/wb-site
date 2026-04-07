import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { DEFAULT_COGS_PER_UNIT } from "./constants";

const DB_PATH = path.join(process.cwd(), "data", "finance.db");
const WEEKLY_DB_PATH = path.join(process.cwd(), "data", "weekly_reports.db");

let db: Database.Database | null = null;
let weeklyDb: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH, { readonly: true });
    db.pragma("journal_mode = WAL");
    db.pragma("cache_size = -64000"); // 64MB cache
  }
  return db;
}

export function getWeeklyDb(): Database.Database | null {
  if (!weeklyDb && fs.existsSync(WEEKLY_DB_PATH)) {
    weeklyDb = new Database(WEEKLY_DB_PATH, { readonly: true });
    weeklyDb.pragma("journal_mode = WAL");
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
 * Получает P&L метрики из weekly_reports.db (Excel) за указанный период.
 * Возвращает null если нет данных.
 */
function getPnlFromExcel(wdb: Database.Database, dateFrom: string, dateTo: string, nmId?: number): {
  salesRow: Record<string, number>;
  returnsRow: Record<string, number>;
  svcRow: Record<string, number>;
  loyaltyComp: number;
  cogs: number;
  periodFilter: string;
} | null {
  const nmWhere = nmId ? "AND nm_id = ?" : "";
  const nmParams = nmId ? [nmId] : [];

  // Проверяем покрытие: все недели в запрошенном периоде должны быть в Excel
  const periods = getWeeklyPeriods(wdb);
  if (periods.length === 0) return null;
  
  // Фильтруем по period_from/period_to (как эталон ЛК WB)
  // Находим все недели, попадающие в запрошенный диапазон
  const matchingPeriods = periods.filter(p => p.period_from >= dateFrom && p.period_to <= dateTo);
  if (matchingPeriods.length === 0) return null;

  // Строим условие по неделям (параметризованные запросы)
  const periodPlaceholders = matchingPeriods.map(() => "(period_from = ? AND period_to = ?)").join(" OR ");
  const periodParams = matchingPeriods.flatMap(p => [p.period_from, p.period_to]);
  const pf = `AND (${periodPlaceholders})`;

  const salesRow = wdb.prepare(`
    SELECT
      COALESCE(SUM(retail_price_withdisc_rub), 0) as rpwd,
      COALESCE(SUM(retail_amount), 0) as ra,
      COALESCE(SUM(ppvz_for_pay), 0) as ppvz,
      COALESCE(SUM(quantity), 0) as qty
    FROM weekly_rows
    WHERE supplier_oper_name = 'Продажа' ${pf} ${nmWhere}
  `).get(...periodParams, ...nmParams) as Record<string, number>;

  if (!salesRow || salesRow.rpwd === 0) return null;

  const returnsRow = wdb.prepare(`
    SELECT
      COALESCE(SUM(retail_price_withdisc_rub), 0) as rpwd,
      COALESCE(SUM(retail_amount), 0) as ra,
      COALESCE(SUM(ppvz_for_pay), 0) as ppvz,
      COALESCE(SUM(quantity), 0) as qty
    FROM weekly_rows
    WHERE supplier_oper_name = 'Возврат' ${pf} ${nmWhere}
  `).get(...periodParams, ...nmParams) as Record<string, number>;

  // Сервисы — все строки попавших недель
  const svcRow = wdb.prepare(`
    SELECT
      COALESCE(SUM(delivery_rub), 0) as logistics,
      COALESCE(SUM(storage_fee), 0) as storage,
      COALESCE(SUM(penalty), 0) as penalty,
      COALESCE(SUM(acceptance), 0) as acceptance,
      COALESCE(SUM(rebill_logistic_cost), 0) as rebill,
      COALESCE(SUM(deduction), 0) as deduction
    FROM weekly_rows
    WHERE 1=1 ${pf} ${nmWhere}
  `).get(...periodParams, ...nmParams) as Record<string, number>;

  const loyaltyRow = wdb.prepare(`
    SELECT COALESCE(SUM(loyalty_compensation), 0) as total
    FROM weekly_rows
    WHERE 1=1 ${pf}
  `).get(...periodParams) as Record<string, number>;

  // COGS из cogs таблицы в finance.db
  const finDb = getDb();
  let cogs = 0;
  const qtyRows = wdb.prepare(`
    SELECT barcode, SUM(quantity) as qty FROM weekly_rows
    WHERE supplier_oper_name = 'Продажа' ${pf}
    GROUP BY barcode
  `).all(...periodParams) as { barcode: string; qty: number }[];
  for (const row of qtyRows) {
    const costRow = finDb.prepare("SELECT cost FROM cogs WHERE barcode = ?").get(row.barcode) as { cost: number } | undefined;
    cogs += row.qty * (costRow?.cost || DEFAULT_COGS_PER_UNIT);
  }
  let cogsReturns = 0;
  const retQtyRows = wdb.prepare(`
    SELECT barcode, SUM(quantity) as qty FROM weekly_rows
    WHERE supplier_oper_name = 'Возврат' ${pf}
    GROUP BY barcode
  `).all(...periodParams) as { barcode: string; qty: number }[];
  for (const row of retQtyRows) {
    const costRow = finDb.prepare("SELECT cost FROM cogs WHERE barcode = ?").get(row.barcode) as { cost: number } | undefined;
    cogsReturns += row.qty * (costRow?.cost || DEFAULT_COGS_PER_UNIT);
  }

  return {
    salesRow,
    returnsRow: returnsRow || { rpwd: 0, ra: 0, ppvz: 0, qty: 0 },
    svcRow,
    loyaltyComp: Math.round(loyaltyRow.total || 0),
    cogs: cogs - cogsReturns,
    periodFilter: pf,
  };
}

/**
 * Возвращает SQL-фрагмент для исключения daily-дублей.
 * Если за неделю есть weekly_final — daily за ту же неделю игнорируются.
 * dateCol: 'sale_dt' или 'rr_dt' — по какому полю фильтровать.
 * alias: алиас таблицы (по умолчанию 'r')
 */
export function getExcludeDailyFilter(d: Database.Database, dateCol: string = "sale_dt", alias: string = "r"): { sql: string; params: string[] } {
  const wfPeriods = d.prepare(`
    SELECT DISTINCT date_from, date_to FROM realization
    WHERE source = 'weekly_final' AND date_from != '' AND date_to != ''
  `).all() as { date_from: string; date_to: string }[];

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

  // Пробуем Excel (weekly_reports.db) как основной источник
  if (wdb && !nmId) {
    const excelData = getPnlFromExcel(wdb, dateFrom, dateTo, nmId);
    if (excelData) {
      const { salesRow, returnsRow, svcRow, loyaltyComp, cogs } = excelData;
      const commission = (salesRow.rpwd - salesRow.ppvz) - (returnsRow.rpwd - returnsRow.ppvz);

      // Реклама и заказы — из finance.db (отдельные таблицы)
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
        total_services: commission + svcRow.logistics + adRow.total + other + jam + (svcRow.rebill || 0),
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

  // Sales/Returns by sale_dt
  const salesWhere = nmId ? "AND nm_id = ?" : "";
  const salesNmParams = nmId ? [nmId] : [];
  const salesParams = [dateFrom, dateTo, ...salesNmParams, ...excludeDaily.params];

  const salesRow = d.prepare(`
    SELECT
      COALESCE(SUM(retail_price_withdisc_rub), 0) as rpwd,
      COALESCE(SUM(retail_amount), 0) as ra,
      COALESCE(SUM(ppvz_for_pay), 0) as ppvz,
      COALESCE(SUM(quantity), 0) as qty,
      COALESCE(SUM(quantity * COALESCE((SELECT cost FROM cogs WHERE cogs.barcode = r.barcode), ${DEFAULT_COGS_PER_UNIT})), 0) as cogs
    FROM realization r
    WHERE supplier_oper_name = 'Продажа'
      AND sale_dt >= ? AND sale_dt <= ? ${salesWhere} ${excludeDaily.sql}
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
      AND sale_dt >= ? AND sale_dt <= ? ${salesWhere} ${excludeDaily.sql}
  `).get(...salesParams) as Record<string, number>;

  // Services by rr_dt
  const svcWhere = nmId ? "AND nm_id = ?" : "";
  const svcParams = [dateFrom, dateTo, ...salesNmParams, ...excludeDailySvc.params];

  const svcRow = d.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN supplier_oper_name = 'Логистика' THEN delivery_rub ELSE 0 END), 0) as logistics,
      COALESCE(SUM(storage_fee), 0) as storage,
      COALESCE(SUM(penalty), 0) as penalty,
      COALESCE(SUM(acceptance), 0) as acceptance,
      COALESCE(SUM(rebill_logistic_cost), 0) as rebill
    FROM realization r
    WHERE rr_dt >= ? AND rr_dt <= ? ${svcWhere} ${excludeDailySvc.sql}
  `).get(...svcParams) as Record<string, number>;

  // Commission by sale_dt (matches WB dashboard calculation)
  const commSales = d.prepare(`
    SELECT COALESCE(SUM(retail_price_withdisc_rub - ppvz_for_pay), 0) as comm
    FROM realization r
    WHERE supplier_oper_name = 'Продажа' AND sale_dt >= ? AND sale_dt <= ? ${salesWhere} ${excludeDaily.sql}
  `).get(...salesParams) as Record<string, number>;

  const commReturns = d.prepare(`
    SELECT COALESCE(SUM(retail_price_withdisc_rub - ppvz_for_pay), 0) as comm
    FROM realization r
    WHERE supplier_oper_name = 'Возврат' AND sale_dt >= ? AND sale_dt <= ? ${salesWhere} ${excludeDaily.sql}
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
    WHERE bonus_type_name LIKE '%Джем%' AND rr_dt >= ? AND rr_dt <= ? ${excludeDailySvc.sql}
  `).get(dateFrom, dateTo, ...excludeDailySvc.params) as Record<string, number>;
  const jam = jamRow.total;

  // Компенсация скидки по программе лояльности — из weekly_reports.db
  let loyaltyComp = 0;
  try {
    const wkDbPath = path.join(process.cwd(), "data", "weekly_reports.db");
    const wkDb = new Database(wkDbPath, { readonly: true });
    const loyaltyRow = wkDb.prepare(`
      SELECT COALESCE(SUM(loyalty_compensation), 0) as total
      FROM weekly_rows
      WHERE period_from <= ? AND period_to >= ?
    `).get(dateFrom, dateFrom) as Record<string, number>;
    // Для диапазонов шире одной недели — суммируем все попавшие недели
    if (dateFrom !== dateTo) {
      const loyaltyRange = wkDb.prepare(`
        SELECT COALESCE(SUM(loyalty_compensation), 0) as total
        FROM weekly_rows
        WHERE period_from >= ? AND period_to <= ?
      `).get(dateFrom, dateTo) as Record<string, number>;
      loyaltyComp = Math.round(loyaltyRange.total || loyaltyRow.total || 0);
    } else {
      loyaltyComp = Math.round(loyaltyRow.total || 0);
    }
    wkDb.close();
  } catch {
    // weekly_reports.db может не существовать
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
    total_services: commission + svcRow.logistics + adRow.total + other + jam + (svcRow.rebill || 0),
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
      SUM(CASE WHEN supplier_oper_name = 'Логистика' THEN delivery_rub ELSE 0 END) as logistics,
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
export function getFilters() {
  const d = getDb();
  
  const suppliers = d.prepare(`
    SELECT DISTINCT ppvz_supplier_name as name FROM realization 
    WHERE supplier_oper_name = 'Продажа' AND ppvz_supplier_name != ''
    ORDER BY name
  `).all() as { name: string }[];

  const brands = d.prepare(`
    SELECT DISTINCT brand_name as name FROM realization 
    WHERE supplier_oper_name = 'Продажа' AND brand_name != ''
    ORDER BY name
  `).all() as { name: string }[];

  const subjects = d.prepare(`
    SELECT DISTINCT subject_name as name FROM realization 
    WHERE supplier_oper_name = 'Продажа' AND subject_name != ''
    ORDER BY name
  `).all() as { name: string }[];

  const articles = d.prepare(`
    SELECT DISTINCT nm_id, sa_name, brand_name, subject_name FROM realization 
    WHERE supplier_oper_name = 'Продажа' AND nm_id > 0
    ORDER BY sa_name
  `).all() as { nm_id: number; sa_name: string; brand_name: string; subject_name: string }[];

  const sizes = d.prepare(`
    SELECT DISTINCT ts_name as name FROM realization 
    WHERE supplier_oper_name = 'Продажа' AND ts_name != ''
    ORDER BY name
  `).all() as { name: string }[];

  return {
    suppliers: suppliers.map(r => r.name),
    brands: brands.map(r => r.name),
    subjects: subjects.map(r => r.name),
    articles: [...new Map(articles.map(a => [a.nm_id, a])).values()],
    sizes: sizes.map(r => r.name),
  };
}
