/**
 * Shared merge utilities for stock and order data.
 * Used by: DataProvider (runtime merging), excel-parser (file merging).
 */

import type { StockItem, OrderRecord } from "@/types";

/**
 * Merge two stock arrays. Incoming items replace existing ones with the same barcode.
 */
export function mergeStock(existing: StockItem[], incoming: StockItem[]): StockItem[] {
  const map = new Map<string, StockItem>();
  for (const item of existing) map.set(item.barcode, item);
  for (const item of incoming) map.set(item.barcode, item);
  return Array.from(map.values());
}

/**
 * Merge two order arrays, deduplicating by date+barcode+warehouse key.
 */
export function mergeOrders(existing: OrderRecord[], incoming: OrderRecord[]): OrderRecord[] {
  const keys = new Set<string>();
  const result: OrderRecord[] = [];
  for (const o of [...existing, ...incoming]) {
    const key = `${o.date}|${o.barcode}|${o.warehouse}`;
    if (!keys.has(key)) {
      keys.add(key);
      result.push(o);
    }
  }
  return result;
}
