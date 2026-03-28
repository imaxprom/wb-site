/**
 * SQLite storage for shipment data (orders, stock, products, meta).
 * Uses the existing finance.db database.
 */

import Database from "better-sqlite3";
import path from "path";
import type { OrderRecord, StockItem, Product } from "@/types";

const DB_PATH = path.join(process.cwd(), "data", "finance.db");

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH, { readonly: false });
    db.pragma("journal_mode = WAL");
    db.pragma("cache_size = -64000");
  }
  return db;
}

export function initShipmentTables(): void {
  const d = getDb();

  d.exec(`
    CREATE TABLE IF NOT EXISTS shipment_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      date TEXT,
      warehouse TEXT,
      federal_district TEXT,
      region TEXT,
      article_seller TEXT,
      article_wb INTEGER,
      barcode TEXT,
      category TEXT,
      subject TEXT,
      brand TEXT,
      size TEXT,
      total_price REAL,
      discount_percent REAL,
      spp REAL,
      finished_price REAL,
      price_with_disc REAL,
      is_cancel INTEGER,
      cancel_date TEXT,
      UNIQUE(barcode, date, warehouse)
    )
  `);

  d.exec(`
    CREATE TABLE IF NOT EXISTS shipment_stock (
      barcode TEXT,
      article_wb TEXT,
      article_seller TEXT,
      brand TEXT,
      size TEXT,
      warehouse TEXT,
      quantity INTEGER,
      updated_at TEXT,
      PRIMARY KEY(barcode, warehouse)
    )
  `);

  d.exec(`
    CREATE TABLE IF NOT EXISTS shipment_products (
      article_wb TEXT PRIMARY KEY,
      name TEXT,
      brand TEXT,
      category TEXT,
      sizes_json TEXT
    )
  `);

  d.exec(`
    CREATE TABLE IF NOT EXISTS shipment_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);
}

export function saveOrders(orders: OrderRecord[]): void {
  const d = getDb();
  const stmt = d.prepare(`
    INSERT INTO shipment_orders
      (date, warehouse, federal_district, region, article_seller, article_wb,
       barcode, category, subject, brand, size, total_price, discount_percent,
       spp, finished_price, price_with_disc, is_cancel, cancel_date)
    VALUES
      (@date, @warehouse, @federalDistrict, @region, @articleSeller, @articleWB,
       @barcode, @category, @subject, @brand, @size, @totalPrice, @discountPercent,
       @spp, @finishedPrice, @priceWithDisc, @isCancel, @cancelDate)
    ON CONFLICT(barcode, date, warehouse) DO UPDATE SET
      federal_district = excluded.federal_district,
      region = excluded.region,
      article_seller = excluded.article_seller,
      article_wb = excluded.article_wb,
      category = excluded.category,
      subject = excluded.subject,
      brand = excluded.brand,
      size = excluded.size,
      total_price = excluded.total_price,
      discount_percent = excluded.discount_percent,
      spp = excluded.spp,
      finished_price = excluded.finished_price,
      price_with_disc = excluded.price_with_disc,
      is_cancel = excluded.is_cancel,
      cancel_date = excluded.cancel_date
  `);

  const insert = d.transaction((rows: OrderRecord[]) => {
    for (const o of rows) {
      stmt.run({
        date: o.date,
        warehouse: o.warehouse,
        federalDistrict: o.federalDistrict,
        region: o.region,
        articleSeller: o.articleSeller,
        articleWB: o.articleWB,
        barcode: o.barcode,
        category: o.category,
        subject: o.subject,
        brand: o.brand,
        size: o.size,
        totalPrice: o.totalPrice,
        discountPercent: o.discountPercent,
        spp: o.spp,
        finishedPrice: o.finishedPrice,
        priceWithDisc: o.priceWithDisc,
        isCancel: o.isCancel ? 1 : 0,
        cancelDate: o.cancelDate || "",
      });
    }
  });

  insert(orders);
}

export function saveStock(stock: StockItem[]): void {
  const d = getDb();
  const stmt = d.prepare(`
    REPLACE INTO shipment_stock
      (barcode, article_wb, article_seller, brand, size, warehouse, quantity, updated_at)
    VALUES
      (@barcode, @articleWB, @articleSeller, @brand, @size, @warehouse, @quantity, @updatedAt)
  `);

  const now = new Date().toISOString();
  const insert = d.transaction((rows: StockItem[]) => {
    for (const s of rows) {
      // If stock has per-warehouse data, insert one row per warehouse
      const warehouses = Object.entries(s.warehouseStock);
      if (warehouses.length > 0) {
        for (const [warehouse, quantity] of warehouses) {
          stmt.run({
            barcode: s.barcode,
            articleWB: s.articleWB,
            articleSeller: s.articleSeller,
            brand: s.brand,
            size: s.size,
            warehouse,
            quantity,
            updatedAt: now,
          });
        }
      } else {
        stmt.run({
          barcode: s.barcode,
          articleWB: s.articleWB,
          articleSeller: s.articleSeller,
          brand: s.brand,
          size: s.size,
          warehouse: "",
          quantity: s.totalOnWarehouses,
          updatedAt: now,
        });
      }
    }
  });

  insert(stock);
}

export function saveProducts(products: Product[]): void {
  const d = getDb();
  const stmt = d.prepare(`
    REPLACE INTO shipment_products (article_wb, name, brand, category, sizes_json)
    VALUES (@articleWB, @name, @brand, @category, @sizesJson)
  `);

  const insert = d.transaction((rows: Product[]) => {
    for (const p of rows) {
      stmt.run({
        articleWB: p.articleWB,
        name: p.name,
        brand: p.brand,
        category: p.category,
        sizesJson: JSON.stringify(p.sizes),
      });
    }
  });

  insert(products);
}

export function getOrders(dateFrom: string, dateTo: string): OrderRecord[] {
  const d = getDb();
  const rows = d.prepare(`
    SELECT * FROM shipment_orders
    WHERE date >= ? AND date < ?
    ORDER BY date DESC
  `).all(dateFrom, dateTo) as Record<string, unknown>[];

  return rows.map((r) => ({
    date: r.date as string,
    warehouse: r.warehouse as string,
    warehouseType: "",
    country: "",
    federalDistrict: r.federal_district as string,
    region: r.region as string,
    articleSeller: r.article_seller as string,
    articleWB: r.article_wb as number,
    barcode: r.barcode as string,
    category: r.category as string,
    subject: r.subject as string,
    brand: r.brand as string,
    size: r.size as string,
    totalPrice: r.total_price as number,
    discountPercent: r.discount_percent as number,
    spp: r.spp as number,
    finishedPrice: r.finished_price as number,
    priceWithDisc: r.price_with_disc as number,
    isCancel: (r.is_cancel as number) === 1,
    cancelDate: r.cancel_date as string,
  }));
}

export function getStock(): StockItem[] {
  const d = getDb();
  const rows = d.prepare(`
    SELECT barcode, article_wb, article_seller, brand, size,
           warehouse, quantity
    FROM shipment_stock
    ORDER BY barcode, warehouse
  `).all() as Record<string, unknown>[];

  // Group by barcode to reconstruct StockItem with warehouseStock
  const byBarcode = new Map<string, StockItem>();

  for (const r of rows) {
    const barcode = r.barcode as string;
    if (!byBarcode.has(barcode)) {
      byBarcode.set(barcode, {
        brand: r.brand as string,
        subject: "",
        articleSeller: r.article_seller as string,
        articleWB: r.article_wb as string,
        volume: "",
        barcode,
        size: r.size as string,
        inTransitToCustomers: 0,
        inTransitReturns: 0,
        totalOnWarehouses: 0,
        warehouseStock: {},
      });
    }
    const item = byBarcode.get(barcode)!;
    const qty = r.quantity as number;
    const warehouse = r.warehouse as string;
    if (warehouse) {
      item.warehouseStock[warehouse] = (item.warehouseStock[warehouse] || 0) + qty;
    }
    item.totalOnWarehouses += qty;
  }

  return Array.from(byBarcode.values());
}

export function getProducts(): Product[] {
  const d = getDb();
  const rows = d.prepare(`
    SELECT article_wb, name, brand, category, sizes_json
    FROM shipment_products
    ORDER BY article_wb
  `).all() as Record<string, unknown>[];

  return rows.map((r) => ({
    articleWB: r.article_wb as string,
    name: r.name as string,
    brand: r.brand as string,
    category: r.category as string,
    sizes: (() => {
      try {
        return JSON.parse(r.sizes_json as string);
      } catch {
        return [];
      }
    })(),
  }));
}

export function getUploadDate(): string | null {
  const d = getDb();
  const row = d.prepare(`SELECT value FROM shipment_meta WHERE key = 'uploadDate'`).get() as { value: string } | undefined;
  return row?.value || null;
}

export function setUploadDate(date: string): void {
  const d = getDb();
  d.prepare(`INSERT INTO shipment_meta (key, value) VALUES ('uploadDate', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(date);
}
