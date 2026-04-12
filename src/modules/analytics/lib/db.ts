/**
 * Модуль Аналитика — собственное подключение к БД.
 * Не зависит от других модулей.
 */
import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "finance.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH, { readonly: true });
    db.pragma("journal_mode = WAL");
    db.pragma("cache_size = -64000");
  }
  return db;
}

// ─── Dedup Filter ────────────────────────────────────────────

let wfPeriodsCache: { date_from: string; date_to: string }[] | null = null;

function getWeeklyFinalPeriods(d: Database.Database): { date_from: string; date_to: string }[] {
  if (wfPeriodsCache) return wfPeriodsCache;
  wfPeriodsCache = d.prepare(`
    SELECT DISTINCT date_from, date_to FROM realization
    WHERE source = 'weekly_final' AND date_from != '' AND date_to != ''
  `).all() as { date_from: string; date_to: string }[];
  return wfPeriodsCache;
}

export function getExcludeDailyFilter(d: Database.Database, dateCol: string = "sale_dt", alias: string = "r"): { sql: string; params: string[] } {
  const wfPeriods = getWeeklyFinalPeriods(d);
  if (wfPeriods.length === 0) return { sql: "", params: [] };
  const ranges = wfPeriods.map(() =>
    `(${alias}.${dateCol} >= ? AND ${alias}.${dateCol} <= ?)`
  ).join(" OR ");
  const params = wfPeriods.flatMap(p => [p.date_from, p.date_to]);
  return { sql: `AND NOT (${alias}.source IN ('daily', 'weekly') AND (${ranges}))`, params };
}
