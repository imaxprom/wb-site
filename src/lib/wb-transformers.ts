/**
 * Convert WB API responses into our internal types.
 */

import type { Product, StockItem, OrderRecord, SizeConfig } from "@/types";
import type { WBCard, WBStockItem, WBWarehouseRemainsItem, WBOrder } from "./wb-api";

/** Convert WB product cards to our Product[] */
export function transformCards(cards: WBCard[]): Product[] {
  return cards.map((card) => {
    const sizes: SizeConfig[] = card.sizes.map((s) => ({
      size: s.techSize,
      barcode: s.skus[0] || "",
      perBox: 0,
    }));

    return {
      name: card.vendorCode || "",
      articleWB: String(card.nmID),
      brand: card.brand || "",
      category: "",
      lengthCm: card.dimensions?.length || 0,
      widthCm: card.dimensions?.width || 0,
      heightCm: card.dimensions?.height || 0,
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

const TOTAL_WAREHOUSE_NAME = "всего находится на складах";
const IN_WAY_TO_CLIENTS_NAME = "в пути до получателей";
const IN_WAY_RETURNS_NAME = "в пути возвраты на склад wb";

function normalizeWarehouseName(value: string): string {
  return value.trim().toLocaleLowerCase("ru");
}

/** Convert WB Warehouses Inventory Report to our stock snapshot. */
export function transformWarehouseRemains(items: WBWarehouseRemainsItem[], products: Product[] = []): StockItem[] {
  const productByArticle = new Map(products.map((product) => [product.articleWB, product]));
  const sizeByBarcode = new Map<string, { product: Product; size: SizeConfig }>();
  for (const product of products) {
    for (const size of product.sizes) {
      if (size.barcode) sizeByBarcode.set(size.barcode, { product, size });
    }
  }

  return items
    .map((item) => {
      const warehouses: Record<string, number> = {};
      let totalQty = 0;
      let inTransitTo = 0;
      let inTransitFrom = 0;
      const barcode = item.barcode || "";
      const product = productByArticle.get(String(item.nmId || "")) || sizeByBarcode.get(barcode)?.product;
      const size = sizeByBarcode.get(barcode)?.size;

      for (const row of item.warehouses || []) {
        const warehouseName = row.warehouseName || "";
        const normalizedName = normalizeWarehouseName(warehouseName);
        const quantity = Number(row.quantity) || 0;
        if (!warehouseName || !quantity) continue;

        if (normalizedName === TOTAL_WAREHOUSE_NAME) {
          continue;
        }
        if (normalizedName === IN_WAY_TO_CLIENTS_NAME) {
          inTransitTo += quantity;
          continue;
        }
        if (normalizedName === IN_WAY_RETURNS_NAME) {
          inTransitFrom += quantity;
          continue;
        }

        warehouses[warehouseName] = (warehouses[warehouseName] || 0) + quantity;
        totalQty += quantity;
      }

      return {
        brand: item.brand || product?.brand || "",
        subject: item.subjectName || "",
        articleSeller: item.vendorCode || product?.name || "",
        articleWB: String(item.nmId || ""),
        volume: item.volume ? String(item.volume) : "",
        barcode,
        size: item.techSize || size?.size || "",
        inTransitToCustomers: inTransitTo,
        inTransitReturns: inTransitFrom,
        totalOnWarehouses: totalQty,
        warehouseStock: warehouses,
      };
    })
    .filter((item) => item.barcode && Object.keys(item.warehouseStock).length > 0);
}

/** Convert WB orders response to our OrderRecord[] */
export function transformOrders(orders: WBOrder[]): OrderRecord[] {
  return orders.map((o) => {
    const fallbackUid = `${o.barcode}:${o.date}:${o.warehouseName}`;
    return {
      orderUid: o.srid || o.gNumber || o.sticker || fallbackUid,
      gNumber: o.gNumber || "",
      sticker: o.sticker || "",
      srid: o.srid || "",
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
    };
  });
}
