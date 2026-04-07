import Database from "better-sqlite3";
import path from "path";
import type { RealizationRow } from "./parse-daily-report";

const DB_PATH = path.join(process.cwd(), "data", "finance.db");

let writeDb: Database.Database | null = null;

function getWriteDb(): Database.Database {
  if (!writeDb) {
    writeDb = new Database(DB_PATH);
    writeDb.pragma("journal_mode = WAL");
    writeDb.pragma("cache_size = -64000");
  }
  return writeDb;
}

/**
 * Import daily report rows into the `realization` table.
 * - Deletes existing rows for the same date range (to avoid duplicates)
 * - Inserts new rows
 * - Returns count of inserted rows
 */
export function importDailyReport(rows: RealizationRow[], dateFrom: string, dateTo: string): {
  deleted: number;
  inserted: number;
} {
  const db = getWriteDb();

  // Mark imported rows with a special realizationreport_id range
  // to distinguish from weekly API imports
  const DAILY_REPORT_ID_BASE = 900000000;

  const result = db.transaction(() => {
    // Delete previous daily imports for this date range
    // Only delete rows that were daily-imported (realizationreport_id >= DAILY_REPORT_ID_BASE)
    const deleteStmt = db.prepare(`
      DELETE FROM realization
      WHERE sale_dt >= ? AND sale_dt <= ?
        AND realizationreport_id >= ?
    `);
    const deleteResult = deleteStmt.run(dateFrom, dateTo, DAILY_REPORT_ID_BASE);

    // Insert new rows
    const insertStmt = db.prepare(`
      INSERT INTO realization (
        rrd_id, realizationreport_id, date_from, date_to, rr_dt, sale_dt, order_dt,
        supplier_oper_name, nm_id, sa_name, ts_name, barcode, brand_name, subject_name,
        quantity, retail_price, retail_price_withdisc_rub, retail_amount,
        ppvz_for_pay, ppvz_sales_commission, acquiring_fee,
        delivery_rub, delivery_amount, return_amount,
        storage_fee, penalty, acceptance, rebill_logistic_cost, additional_payment,
        commission_percent, ppvz_spp_prc, ppvz_kvw_prc_base, ppvz_kvw_prc,
        ppvz_supplier_name, site_country, office_name, deduction, bonus_type_name
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?,
        ?, ?, ?, ?, ?
      )
    `);

    let inserted = 0;
    for (const row of rows) {
      // Use DAILY_REPORT_ID_BASE + a hash to mark as daily import
      const reportId = row.realizationreport_id || (DAILY_REPORT_ID_BASE + hashCode(row.sale_dt));

      insertStmt.run(
        row.rrd_id || 0,
        reportId,
        row.date_from || dateFrom,
        row.date_to || dateTo,
        row.rr_dt,
        row.sale_dt,
        row.order_dt,
        row.supplier_oper_name,
        row.nm_id,
        row.sa_name,
        row.ts_name,
        row.barcode,
        row.brand_name,
        row.subject_name,
        row.quantity,
        row.retail_price,
        row.retail_price_withdisc_rub,
        row.retail_amount,
        row.ppvz_for_pay,
        row.ppvz_sales_commission,
        row.acquiring_fee,
        row.delivery_rub,
        row.delivery_amount,
        row.return_amount,
        row.storage_fee,
        row.penalty,
        row.acceptance,
        row.rebill_logistic_cost,
        row.additional_payment,
        row.commission_percent,
        row.ppvz_spp_prc,
        row.ppvz_kvw_prc_base,
        row.ppvz_kvw_prc,
        row.ppvz_supplier_name,
        row.site_country,
        row.office_name,
        row.deduction,
        row.bonus_type_name
      );
      inserted++;
    }

    return { deleted: deleteResult.changes, inserted };
  })();

  return result;
}

/**
 * Check which dates already have data in realization table.
 * Returns dates that have weekly (non-daily) report data.
 */
export function getExistingWeeklyDates(dateFrom: string, dateTo: string): string[] {
  const db = getWriteDb();
  const DAILY_REPORT_ID_BASE = 900000000;

  const rows = db.prepare(`
    SELECT DISTINCT sale_dt as date FROM realization
    WHERE sale_dt >= ? AND sale_dt <= ?
      AND realizationreport_id < ?
    ORDER BY sale_dt
  `).all(dateFrom, dateTo, DAILY_REPORT_ID_BASE) as { date: string }[];

  return rows.map((r) => r.date);
}

/**
 * Remove daily-imported data for dates that now have weekly report data.
 * Called after weekly report import to clean up redundant daily data.
 */
export function cleanupDailyForWeeklyDates(dates: string[]): number {
  if (dates.length === 0) return 0;
  const db = getWriteDb();
  const DAILY_REPORT_ID_BASE = 900000000;

  let total = 0;
  const stmt = db.prepare(`
    DELETE FROM realization
    WHERE sale_dt = ? AND realizationreport_id >= ?
  `);

  for (const date of dates) {
    const r = stmt.run(date, DAILY_REPORT_ID_BASE);
    total += r.changes;
  }

  return total;
}

/**
 * Get the log of daily imports (what dates have been imported).
 */
export function getDailyImportLog(): { date: string; rowCount: number }[] {
  const db = getWriteDb();
  const DAILY_REPORT_ID_BASE = 900000000;

  return db.prepare(`
    SELECT sale_dt as date, COUNT(*) as rowCount
    FROM realization
    WHERE realizationreport_id >= ?
    GROUP BY sale_dt
    ORDER BY sale_dt DESC
    LIMIT 30
  `).all(DAILY_REPORT_ID_BASE) as { date: string; rowCount: number }[];
}

function hashCode(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash) % 100000000;
}
