/**
 * Convert WB API responses into our internal types.
 */

import type { Product, StockItem, OrderRecord, SizeConfig } from "@/types";
import type { WBCard, WBStockItem, WBOrder } from "./wb-api";
import { guessPerBox } from "./size-utils";

/** Convert WB product cards to our Product[] */
export function transformCards(cards: WBCard[]): Product[] {
  return cards.map((card) => {
    const sizes: SizeConfig[] = card.sizes.map((s) => ({
      size: s.techSize,
      barcode: s.skus[0] || "",
      perBox: guessPerBox(s.techSize),
    }));

    return {
      name: card.vendorCode || "",
      articleWB: String(card.nmID),
      brand: card.brand || "",
      category: "",
      sizes,
    };
  });
}

/** Convert WB stock response to our StockItem[] */
export function transformStocks(items: WBStockItem[]): StockItem[] {
  // Group by barcode, aggregate warehouse quantities
  const byBarcode = new Map<string, {
    item: WBStockItem;
    warehouses: Record<string, number>;
    totalQty: number;
    inTransitTo: number;
    inTransitFrom: number;
  }>();

  for (const item of items) {
    const key = item.barcode;
    if (!byBarcode.has(key)) {
      byBarcode.set(key, {
        item,
        warehouses: {},
        totalQty: 0,
        inTransitTo: 0,
        inTransitFrom: 0,
      });
    }
    const entry = byBarcode.get(key)!;
    // Актуальный остаток = quantity (свободное) + inWayFromClient (возвраты скоро упадут в остаток)
    const actualQty = (item.quantity || 0) + (item.inWayFromClient || 0);
    entry.warehouses[item.warehouseName] =
      (entry.warehouses[item.warehouseName] || 0) + actualQty;
    entry.totalQty += actualQty;
    entry.inTransitTo += item.inWayToClient;
    entry.inTransitFrom += item.inWayFromClient;
  }

  return Array.from(byBarcode.values()).map(({ item, warehouses, totalQty, inTransitTo, inTransitFrom }) => ({
    brand: item.brand,
    subject: item.subject,
    articleSeller: item.supplierArticle,
    articleWB: String(item.nmId),
    volume: "",
    barcode: item.barcode,
    size: item.techSize,
    inTransitToCustomers: inTransitTo,
    inTransitReturns: inTransitFrom,
    totalOnWarehouses: totalQty,
    warehouseStock: warehouses,
  }));
}

/** Convert WB orders response to our OrderRecord[] */
export function transformOrders(orders: WBOrder[]): OrderRecord[] {
  return orders.map((o) => ({
    date: o.date,
    warehouse: o.warehouseName,
    warehouseType: "",
    country: o.countryName || "",
    federalDistrict: o.oblastOkrugName || "",
    region: o.regionName || "",
    articleSeller: o.supplierArticle,
    articleWB: String(o.nmId),
    barcode: o.barcode,
    category: o.category,
    subject: o.subject,
    brand: o.brand,
    size: o.techSize,
    totalPrice: o.totalPrice,
    discountPercent: o.discountPercent,
    spp: o.spp,
    finishedPrice: o.finishedPrice,
    priceWithDisc: o.priceWithDisc,
    isCancel: o.isCancel,
    cancelDate: o.cancelDate || "",
  }));
}
