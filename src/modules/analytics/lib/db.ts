/**
 * Модуль Аналитика — собственное подключение к БД.
 * Не зависит от других модулей.
 */
import { pgRows } from "@/lib/postgres";

// ─── Dedup Filter ────────────────────────────────────────────

export function getExcludeDailyFilter(): never {
  throw new Error("Removed analytics file DB helper. Use getPgExcludeDailyFilter instead.");
}

export async function getPgExcludeDailyFilter(dateCol: string = "sale_dt", alias: string = "r"): Promise<{ sql: string; params: string[] }> {
  const wfPeriods = await pgRows<{ date_from: string; date_to: string }>(`
    SELECT DISTINCT date_from, date_to FROM realization
    WHERE source = 'weekly_final' AND date_from != '' AND date_to != ''
  `);
  if (wfPeriods.length === 0) return { sql: "", params: [] };
  const ranges = wfPeriods.map(() =>
    `(${alias}.${dateCol} >= ? AND ${alias}.${dateCol} <= ?)`
  ).join(" OR ");
  const params = wfPeriods.flatMap(p => [p.date_from, p.date_to]);
  return { sql: `AND NOT (${alias}.source IN ('daily', 'weekly') AND (${ranges}))`, params };
}
