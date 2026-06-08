/**
 * Sync Source 3: Воронка продаж — заказы (WB Seller Analytics API)
 * Независим от других sync-модулей.
 */
import { SourceStatus, emptySource, getApiKey, dateInMoscow, shiftIsoDate } from "./types";
import { pgGet, pgRows, withPgTransaction } from "@/lib/postgres";

interface WbSalesFunnelHistoryRow {
  date: string;
  orderSum: number;
  orderCount: number;
  buyoutSum?: number;
  buyoutCount?: number;
}

interface OrdersFunnelRow {
  date: string;
  order_sum: number;
  order_count: number;
  buyout_sum: number;
  buyout_count: number;
}

export interface OrdersRefreshChange {
  date: string;
  orderCountFrom: number;
  orderCountTo: number;
  orderSumFrom: number;
  orderSumTo: number;
  buyoutCountFrom: number;
  buyoutCountTo: number;
  buyoutSumFrom: number;
  buyoutSumTo: number;
}

export interface OrdersRefreshResult {
  ok: boolean;
  checked: number;
  updated: number;
  windowDays: number;
  lastAttempt: string;
  changes: OrdersRefreshChange[];
  error?: string;
}

async function fetchSalesFunnelHistory(start: string, end: string, apiKey: string): Promise<WbSalesFunnelHistoryRow[]> {
  const res = await fetch(
    "https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/grouped/history",
    {
      method: "POST",
      headers: { Authorization: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        brandNames: [],
        subjectIds: [],
        tagIds: [],
        selectedPeriod: { start, end },
        aggregationLevel: "day",
      }),
    }
  );
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const data = (await res.json()) as { data?: { history?: WbSalesFunnelHistoryRow[] }[] };
  return data?.data?.[0]?.history || [];
}

export async function syncOrders(date: string, prevValue: number): Promise<SourceStatus> {
  const s: SourceStatus = { ...emptySource(), lastAttempt: new Date().toISOString() };
  const apiKey = getApiKey();
  if (!apiKey) { s.error = "Нет WB API ключа"; return s; }

  try {
    const history = await fetchSalesFunnelHistory(date, date, apiKey);
    const day = history.find(h => h.date === date);

    if (!day || day.orderSum === 0) {
      s.error = "Нет данных о заказах за эту дату";
      return s;
    }

    const existing = await pgGet<{ order_sum: number; order_count: number; buyout_sum: number; buyout_count: number }>(
      "SELECT order_sum, order_count, buyout_sum, buyout_count FROM orders_funnel WHERE date = ?",
      [date]
    );
    const unchanged = existing
      && Math.abs((existing.order_sum || 0) - day.orderSum) < 0.01
      && (existing.order_count || 0) === (day.orderCount || 0)
      && Math.abs((existing.buyout_sum || 0) - (day.buyoutSum || 0)) < 0.01
      && (existing.buyout_count || 0) === (day.buyoutCount || 0);

    if (!unchanged) {
      await withPgTransaction(async (client) => {
        await client.query("DELETE FROM orders_funnel WHERE date = $1", [date]);
        await client.query(
          "INSERT INTO orders_funnel (date, order_sum, order_count, buyout_sum, buyout_count) VALUES ($1, $2, $3, $4, $5)",
          [date, day.orderSum, day.orderCount, day.buyoutSum || 0, day.buyoutCount || 0]
        );
      });
    }

    s.ok = true;
    s.value = day.orderSum;
    s.prevValue = prevValue;
    s.stable = prevValue > 0 && day.orderSum === prevValue;
  } catch (err) {
    s.error = err instanceof Error ? err.message : String(err);
  }
  return s;
}

export async function refreshRecentOrders(windowDays = 7): Promise<OrdersRefreshResult> {
  const result: OrdersRefreshResult = {
    ok: false,
    checked: 0,
    updated: 0,
    windowDays,
    lastAttempt: new Date().toISOString(),
    changes: [],
  };
  const apiKey = getApiKey();
  if (!apiKey) {
    result.error = "Нет WB API ключа";
    return result;
  }

  try {
    const end = shiftIsoDate(dateInMoscow(), -1);
    const start = shiftIsoDate(end, -(Math.max(1, windowDays) - 1));
    const history = await fetchSalesFunnelHistory(start, end, apiKey);
    const historyByDate = new Map(history.map((row) => [row.date, row]));

    const existingRows = await pgRows<OrdersFunnelRow>(
      "SELECT date, order_sum, order_count, buyout_sum, buyout_count FROM orders_funnel WHERE date >= ? AND date <= ?",
      [start, end]
    );
    const existingByDate = new Map(existingRows.map((row) => [String(row.date), row]));

    const changes: OrdersRefreshChange[] = [];
    for (let i = 0; i < Math.max(1, windowDays); i++) {
      const date = shiftIsoDate(start, i);
      const wb = historyByDate.get(date);
      if (!wb || Number(wb.orderSum || 0) <= 0) continue;
      const old = existingByDate.get(date);
      const oldOrderCount = Number(old?.order_count || 0);
      const oldOrderSum = Number(old?.order_sum || 0);
      const oldBuyoutCount = Number(old?.buyout_count || 0);
      const oldBuyoutSum = Number(old?.buyout_sum || 0);
      const nextOrderCount = Number(wb.orderCount || 0);
      const nextOrderSum = Number(wb.orderSum || 0);
      const nextBuyoutCount = Number(wb.buyoutCount || 0);
      const nextBuyoutSum = Number(wb.buyoutSum || 0);
      const changed = oldOrderCount !== nextOrderCount
        || Math.abs(oldOrderSum - nextOrderSum) > 0.01
        || oldBuyoutCount !== nextBuyoutCount
        || Math.abs(oldBuyoutSum - nextBuyoutSum) > 0.01;
      if (!changed) continue;
      changes.push({
        date,
        orderCountFrom: oldOrderCount,
        orderCountTo: nextOrderCount,
        orderSumFrom: oldOrderSum,
        orderSumTo: nextOrderSum,
        buyoutCountFrom: oldBuyoutCount,
        buyoutCountTo: nextBuyoutCount,
        buyoutSumFrom: oldBuyoutSum,
        buyoutSumTo: nextBuyoutSum,
      });
    }

    if (changes.length > 0) {
      await withPgTransaction(async (client) => {
        for (const change of changes) {
          await client.query("DELETE FROM orders_funnel WHERE date = $1", [change.date]);
          await client.query(
            "INSERT INTO orders_funnel (date, order_sum, order_count, buyout_sum, buyout_count) VALUES ($1, $2, $3, $4, $5)",
            [change.date, change.orderSumTo, change.orderCountTo, change.buyoutSumTo, change.buyoutCountTo]
          );
        }
      });
    }

    result.ok = true;
    result.checked = history.length;
    result.updated = changes.length;
    result.changes = changes;
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }
  return result;
}
