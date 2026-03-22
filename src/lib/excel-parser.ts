import * as XLSX from "xlsx";
import type { StockItem, OrderRecord, Product, SizeConfig } from "@/types";
import { guessPerBox } from "./size-utils";
import { mergeStock, mergeOrders } from "./merge-utils";

export function parseStockSheet(workbook: XLSX.WorkBook, sheetName: string): StockItem[] {
  const ws = workbook.Sheets[sheetName];
  if (!ws) return [];

  const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: 0 });
  const items: StockItem[] = [];

  const knownFields = new Set([
    "Бренд", "Предмет", "Артикул продавца", "Артикул WB",
    "Объем, л", "Баркод", "Размер вещи",
    "В пути до получателей", "В пути возвраты на склад WB",
    "Всего находится на складах",
  ]);

  for (const row of data) {
    const warehouseStock: Record<string, number> = {};
    for (const [key, val] of Object.entries(row)) {
      if (!knownFields.has(key) && typeof val === "number") {
        warehouseStock[key] = val;
      } else if (!knownFields.has(key) && typeof val === "string") {
        const num = parseInt(val, 10);
        if (!isNaN(num)) warehouseStock[key] = num;
      }
    }

    items.push({
      brand: String(row["Бренд"] || ""),
      subject: String(row["Предмет"] || ""),
      articleSeller: String(row["Артикул продавца"] || ""),
      articleWB: String(row["Артикул WB"] || ""),
      volume: String(row["Объем, л"] || ""),
      barcode: String(row["Баркод"] || ""),
      size: String(row["Размер вещи"] || ""),
      inTransitToCustomers: Number(row["В пути до получателей"] || 0),
      inTransitReturns: Number(row["В пути возвраты на склад WB"] || 0),
      totalOnWarehouses: Number(row["Всего находится на складах"] || 0),
      warehouseStock,
    });
  }

  return items;
}

export function parseOrdersSheet(workbook: XLSX.WorkBook, sheetName: string): OrderRecord[] {
  const ws = workbook.Sheets[sheetName];
  if (!ws) return [];

  const data = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "" });
  const orders: OrderRecord[] = [];

  for (const row of data) {
    orders.push({
      date: String(row["date"] || ""),
      warehouse: String(row["warehouseName"] || ""),
      warehouseType: String(row["warehouseType"] || ""),
      country: String(row["countryName"] || ""),
      federalDistrict: String(row["oblastOkrugName"] || ""),
      region: String(row["regionName"] || ""),
      articleSeller: String(row["supplierArticle"] || ""),
      articleWB: Number(row["nmId"] || 0),
      barcode: String(row["barcode"] || ""),
      category: String(row["category"] || ""),
      subject: String(row["subject"] || ""),
      brand: String(row["brand"] || ""),
      size: String(row["techSize"] || ""),
      totalPrice: Number(row["totalPrice"] || 0),
      discountPercent: Number(row["discountPercent"] || 0),
      spp: Number(row["spp"] || 0),
      finishedPrice: Number(row["finishedPrice"] || 0),
      priceWithDisc: Number(row["priceWithDisc"] || 0),
      isCancel: row["isCancel"] === true || row["isCancel"] === "true" || row["isCancel"] === 1,
      cancelDate: String(row["cancelDate"] || ""),
    });
  }

  return orders;
}

export function detectProducts(stock: StockItem[]): Product[] {
  const productMap = new Map<string, { name: string; brand: string; category: string; sizes: SizeConfig[] }>();

  for (const item of stock) {
    const key = item.articleWB;
    if (!key) continue;

    if (!productMap.has(key)) {
      productMap.set(key, {
        name: `${item.subject} ${item.articleSeller}`.trim(),
        brand: item.brand,
        category: item.subject,
        sizes: [],
      });
    }

    const product = productMap.get(key)!;
    if (!product.sizes.find((s) => s.barcode === item.barcode)) {
      product.sizes.push({
        size: item.size,
        barcode: item.barcode,
        perBox: guessPerBox(item.size),
      });
    }
  }

  return Array.from(productMap.entries()).map(([articleWB, data]) => ({
    articleWB,
    ...data,
  }));
}


export interface ParseResult {
  stock: StockItem[];
  orders: OrderRecord[];
  products: Product[];
  sheetNames: string[];
}

export function parseExcelFile(buffer: ArrayBuffer): ParseResult {
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheetNames = workbook.SheetNames;

  const allStock: StockItem[] = [];
  const allOrders: OrderRecord[] = [];

  for (const name of sheetNames) {
    const ws = workbook.Sheets[name];
    const firstCell = ws["A1"]?.v || ws["B1"]?.v || "";
    const firstStr = String(firstCell).toLowerCase();

    if (firstStr.includes("бренд") || firstStr.includes("предмет")) {
      allStock.push(...parseStockSheet(workbook, name));
    } else if (firstStr === "date" || firstStr.includes("lastchangedate")) {
      allOrders.push(...parseOrdersSheet(workbook, name));
    }
  }

  const products = detectProducts(allStock);

  return { stock: allStock, orders: allOrders, products, sheetNames };
}

/** Merge multiple parse results, deduplicating stock by barcode and orders by date+barcode */
export function mergeParseResults(existing: ParseResult, incoming: ParseResult): ParseResult {
  const mergedStock = mergeStock(existing.stock, incoming.stock);
  const mergedOrders = mergeOrders(existing.orders, incoming.orders);

  const products = detectProducts(mergedStock);
  const sheetNames = [...new Set([...existing.sheetNames, ...incoming.sheetNames])];

  return { stock: mergedStock, orders: mergedOrders, products, sheetNames };
}
