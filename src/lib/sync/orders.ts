/**
 * Sync Source 3: Воронка продаж — заказы (WB Seller Analytics API)
 * Независим от других sync-модулей.
 */
import Database from "better-sqlite3";
import { SourceStatus, emptySource, DB_PATH, getApiKey } from "./types";

export async function syncOrders(date: string, prevValue: number): Promise<SourceStatus> {
  const s: SourceStatus = { ...emptySource(), lastAttempt: new Date().toISOString() };
  const apiKey = getApiKey();
  if (!apiKey) { s.error = "Нет WB API ключа"; return s; }

  try {
    const res = await fetch(
      "https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/grouped/history",
      {
        method: "POST",
        headers: { Authorization: apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          brandNames: [], subjectIds: [], tagIds: [],
          selectedPeriod: { start: date, end: date },
          aggregationLevel: "day",
        }),
      }
    );
    if (!res.ok) { s.error = `API error: ${res.status}`; return s; }

    const data = (await res.json()) as { data?: { history?: { date: string; orderSum: number; orderCount: number; buyoutSum: number; buyoutCount: number }[] }[] };
    const day = data?.data?.[0]?.history?.find(h => h.date === date);

    if (!day || day.orderSum === 0) {
      s.error = "Нет данных о заказах за эту дату";
      return s;
    }

    const db = new Database(DB_PATH);
    db.pragma("busy_timeout = 5000");

    // Idempotency: проверяем, совпадают ли текущие данные в БД с тем, что пришло.
    const existing = db.prepare(
      "SELECT order_sum, order_count, buyout_sum, buyout_count FROM orders_funnel WHERE date = ?"
    ).get(date) as { order_sum: number; order_count: number; buyout_sum: number; buyout_count: number } | undefined;
    const unchanged = existing
      && Math.abs((existing.order_sum || 0) - day.orderSum) < 0.01
      && (existing.order_count || 0) === (day.orderCount || 0)
      && Math.abs((existing.buyout_sum || 0) - (day.buyoutSum || 0)) < 0.01
      && (existing.buyout_count || 0) === (day.buyoutCount || 0);

    if (!unchanged) {
      db.prepare("INSERT OR REPLACE INTO orders_funnel (date, order_sum, order_count, buyout_sum, buyout_count) VALUES (?, ?, ?, ?, ?)")
        .run(date, day.orderSum, day.orderCount, day.buyoutSum || 0, day.buyoutCount || 0);
    }
    db.close();

    s.ok = true;
    s.value = day.orderSum;
    s.prevValue = prevValue;
    s.stable = prevValue > 0 && day.orderSum === prevValue;
  } catch (err) {
    s.error = err instanceof Error ? err.message : String(err);
  }
  return s;
}
