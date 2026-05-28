/**
 * SQLite storage for shipment data (orders, stock, products, meta).
 * Uses the existing finance.db database.
 */

import Database from "better-sqlite3";
import path from "path";
import type { OrderRecord, StockItem, Product, ProductOverride, ProductOverrides } from "@/types";
import { hashPassword } from "./auth";
import { isPostgresEnabled, isPostgresReadonlyConnection, pgGet, pgRows, withPgTransaction } from "@/lib/postgres";
import type { PoolClient } from "pg";

const DB_PATH = path.join(process.cwd(), "data", "finance.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH, { readonly: false });
    db.pragma("busy_timeout = 5000");
    db.pragma("journal_mode = WAL");
    db.pragma("cache_size = -64000");
  }
  return db;
}

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  name: string | null;
  role: string;
  created_at: string;
}

export interface AcceptedSupplyInput {
  supplyID: number;
  row: unknown;
  detail: Record<string, unknown>;
}

export interface AcceptedSupplyContentInput {
  supplyID: number;
  source: "package" | "goods";
  payload: unknown;
}

export interface SupplySnapshotInput {
  supplyID: number;
  row: unknown;
  detail: Record<string, unknown> | null;
  listPosition: number;
}

export interface StoredAcceptedSupply {
  supplyID: number;
  row: Record<string, unknown>;
  detail: Record<string, unknown>;
}

export interface StoredAcceptedSupplyContent {
  supplyID: number;
  source: "package" | "goods";
  payload: Record<string, unknown>;
}

export interface StoredSupplySnapshot {
  supplyID: number;
  row: Record<string, unknown>;
  detail: Record<string, unknown> | null;
}

export function initShipmentTables(): void {
  if (isPostgresEnabled()) return;

  const d = getDb();

  d.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT,
      role TEXT DEFAULT 'user',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  d.exec(`
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      PRIMARY KEY(user_id, key),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  d.exec(`
    CREATE TABLE IF NOT EXISTS auth_login_attempts (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0,
      first_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);

  d.exec(`
    CREATE TABLE IF NOT EXISTS product_overrides (
      user_id INTEGER NOT NULL,
      article_wb TEXT NOT NULL,
      barcode TEXT NOT NULL,
      custom_name TEXT,
      per_box INTEGER,
      disabled INTEGER DEFAULT 0,
      PRIMARY KEY(user_id, article_wb, barcode),
      FOREIGN KEY(user_id) REFERENCES users(id)
    )
  `);

  const userCount = (d.prepare(`SELECT COUNT(*) as count FROM users`).get() as { count: number }).count;
  if (process.env.NODE_ENV !== "production" && userCount === 0) {
    const adminHash = hashPassword("admin");
    d.prepare(`
      INSERT INTO users (email, password_hash, name, role)
      VALUES ('admin', ?, 'Администратор', 'admin')
    `).run(adminHash);
  }

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
      length_cm REAL DEFAULT 0,
      width_cm REAL DEFAULT 0,
      height_cm REAL DEFAULT 0,
      sizes_json TEXT
    )
  `);

  const productCols = d.prepare("PRAGMA table_info(shipment_products)").all() as { name: string }[];
  const productColNames = new Set(productCols.map((col) => col.name));
  if (!productColNames.has("length_cm")) d.prepare("ALTER TABLE shipment_products ADD COLUMN length_cm REAL DEFAULT 0").run();
  if (!productColNames.has("width_cm")) d.prepare("ALTER TABLE shipment_products ADD COLUMN width_cm REAL DEFAULT 0").run();
  if (!productColNames.has("height_cm")) d.prepare("ALTER TABLE shipment_products ADD COLUMN height_cm REAL DEFAULT 0").run();

  d.exec(`
    CREATE TABLE IF NOT EXISTS shipment_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  d.exec(`
    CREATE TABLE IF NOT EXISTS wb_supply_snapshots (
      supply_id INTEGER PRIMARY KEY,
      preorder_id INTEGER,
      status_id INTEGER,
      virtual_type_id INTEGER,
      box_type_id INTEGER,
      create_date TEXT,
      supply_date TEXT,
      fact_date TEXT,
      updated_date TEXT,
      warehouse_name TEXT,
      actual_warehouse_name TEXT,
      quantity INTEGER,
      accepted_quantity INTEGER,
      list_position INTEGER NOT NULL DEFAULT 0,
      row_json TEXT NOT NULL,
      detail_json TEXT,
      saved_at TEXT NOT NULL,
      refreshed_at TEXT NOT NULL
    )
  `);

  d.exec(`
    CREATE TABLE IF NOT EXISTS wb_accepted_supplies (
      supply_id INTEGER PRIMARY KEY,
      preorder_id INTEGER,
      status_id INTEGER,
      virtual_type_id INTEGER,
      box_type_id INTEGER,
      create_date TEXT,
      supply_date TEXT,
      fact_date TEXT,
      updated_date TEXT,
      warehouse_name TEXT,
      actual_warehouse_name TEXT,
      quantity INTEGER,
      accepted_quantity INTEGER,
      row_json TEXT NOT NULL,
      detail_json TEXT NOT NULL,
      saved_at TEXT NOT NULL,
      refreshed_at TEXT NOT NULL
    )
  `);

  d.exec(`
    CREATE TABLE IF NOT EXISTS wb_accepted_supply_contents (
      supply_id INTEGER PRIMARY KEY,
      source TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      saved_at TEXT NOT NULL,
      refreshed_at TEXT NOT NULL,
      FOREIGN KEY(supply_id) REFERENCES wb_accepted_supplies(supply_id)
    )
  `);
}

function canRunPostgresDdl(): boolean {
  return !isPostgresReadonlyConnection();
}

function assertPostgresWritable(): void {
  if (isPostgresReadonlyConnection()) {
    throw new Error("PostgreSQL connection is readonly; writes are disabled in local dev mode");
  }
}

export async function initShipmentTablesPg(): Promise<void> {
  if (!isPostgresEnabled() || !canRunPostgresDdl()) return;

  await withPgTransaction(async (client) => {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name TEXT,
        role TEXT DEFAULT 'user',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS user_settings (
        user_id INTEGER NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        PRIMARY KEY(user_id, key)
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS auth_login_attempts (
        key TEXT PRIMARY KEY,
        count INTEGER NOT NULL DEFAULT 0,
        first_at BIGINT NOT NULL,
        updated_at BIGINT NOT NULL
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS product_overrides (
        user_id INTEGER NOT NULL,
        article_wb TEXT NOT NULL,
        barcode TEXT NOT NULL,
        custom_name TEXT,
        per_box INTEGER,
        disabled INTEGER DEFAULT 0,
        PRIMARY KEY(user_id, article_wb, barcode)
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS wb_supply_snapshots (
        supply_id BIGINT PRIMARY KEY,
        preorder_id BIGINT,
        status_id BIGINT,
        virtual_type_id BIGINT,
        box_type_id BIGINT,
        create_date TEXT,
        supply_date TEXT,
        fact_date TEXT,
        updated_date TEXT,
        warehouse_name TEXT,
        actual_warehouse_name TEXT,
        quantity BIGINT,
        accepted_quantity BIGINT,
        list_position BIGINT NOT NULL DEFAULT 0,
        row_json TEXT NOT NULL,
        detail_json TEXT,
        saved_at TEXT NOT NULL,
        refreshed_at TEXT NOT NULL
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS wb_accepted_supplies (
        supply_id BIGINT PRIMARY KEY,
        preorder_id BIGINT,
        status_id BIGINT,
        virtual_type_id BIGINT,
        box_type_id BIGINT,
        create_date TEXT,
        supply_date TEXT,
        fact_date TEXT,
        updated_date TEXT,
        warehouse_name TEXT,
        actual_warehouse_name TEXT,
        quantity BIGINT,
        accepted_quantity BIGINT,
        row_json TEXT NOT NULL,
        detail_json TEXT NOT NULL,
        saved_at TEXT NOT NULL,
        refreshed_at TEXT NOT NULL
      )
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS wb_accepted_supply_contents (
        supply_id BIGINT PRIMARY KEY REFERENCES wb_accepted_supplies(supply_id),
        source TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        saved_at TEXT NOT NULL,
        refreshed_at TEXT NOT NULL
      )
    `);

    if (process.env.NODE_ENV !== "production") {
      const count = await client.query<{ count: number }>("SELECT COUNT(*)::int AS count FROM users");
      if (count.rows[0]?.count === 0) {
        await client.query(`
          INSERT INTO users (email, password_hash, name, role)
          VALUES ($1, $2, $3, $4)
        `, ["admin", hashPassword("admin"), "Администратор", "admin"]);
      }
    }
  });
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

export function saveSupplySnapshot(input: SupplySnapshotInput): void {
  initShipmentTables();
  const d = getDb();
  const now = new Date().toISOString();
  const row = input.row as Record<string, unknown>;
  const detail = input.detail || {};

  d.prepare(`
    INSERT INTO wb_supply_snapshots (
      supply_id, preorder_id, status_id, virtual_type_id, box_type_id,
      create_date, supply_date, fact_date, updated_date,
      warehouse_name, actual_warehouse_name, quantity, accepted_quantity,
      list_position, row_json, detail_json, saved_at, refreshed_at
    )
    VALUES (
      @supplyID, @preorderID, @statusID, @virtualTypeID, @boxTypeID,
      @createDate, @supplyDate, @factDate, @updatedDate,
      @warehouseName, @actualWarehouseName, @quantity, @acceptedQuantity,
      @listPosition, @rowJson, @detailJson, @savedAt, @refreshedAt
    )
    ON CONFLICT(supply_id) DO UPDATE SET
      preorder_id = excluded.preorder_id,
      status_id = excluded.status_id,
      virtual_type_id = excluded.virtual_type_id,
      box_type_id = excluded.box_type_id,
      create_date = excluded.create_date,
      supply_date = excluded.supply_date,
      fact_date = excluded.fact_date,
      updated_date = excluded.updated_date,
      warehouse_name = excluded.warehouse_name,
      actual_warehouse_name = excluded.actual_warehouse_name,
      quantity = excluded.quantity,
      accepted_quantity = excluded.accepted_quantity,
      list_position = excluded.list_position,
      row_json = excluded.row_json,
      detail_json = excluded.detail_json,
      refreshed_at = excluded.refreshed_at
  `).run({
    supplyID: input.supplyID,
    preorderID: numberOrNull(row.preorderID),
    statusID: numberOrNull(detail.statusID ?? row.statusID),
    virtualTypeID: numberOrNull(detail.virtualTypeID),
    boxTypeID: numberOrNull(detail.boxTypeID ?? row.boxTypeID),
    createDate: stringOrNull(detail.createDate ?? row.createDate),
    supplyDate: stringOrNull(detail.supplyDate ?? row.supplyDate),
    factDate: stringOrNull(detail.factDate ?? row.factDate),
    updatedDate: stringOrNull(detail.updatedDate ?? row.updatedDate),
    warehouseName: stringOrNull(detail.warehouseName),
    actualWarehouseName: stringOrNull(detail.actualWarehouseName),
    quantity: numberOrNull(detail.quantity),
    acceptedQuantity: numberOrNull(detail.acceptedQuantity),
    listPosition: input.listPosition,
    rowJson: JSON.stringify(row),
    detailJson: input.detail ? JSON.stringify(detail) : null,
    savedAt: now,
    refreshedAt: now,
  });
}

export async function saveSupplySnapshotPg(input: SupplySnapshotInput): Promise<void> {
  await initShipmentTablesPg();
  if (isPostgresReadonlyConnection()) return;

  const now = new Date().toISOString();
  const row = input.row as Record<string, unknown>;
  const detail = input.detail || {};

  await pgGet(`
    INSERT INTO wb_supply_snapshots (
      supply_id, preorder_id, status_id, virtual_type_id, box_type_id,
      create_date, supply_date, fact_date, updated_date,
      warehouse_name, actual_warehouse_name, quantity, accepted_quantity,
      list_position, row_json, detail_json, saved_at, refreshed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(supply_id) DO UPDATE SET
      preorder_id = EXCLUDED.preorder_id,
      status_id = EXCLUDED.status_id,
      virtual_type_id = EXCLUDED.virtual_type_id,
      box_type_id = EXCLUDED.box_type_id,
      create_date = EXCLUDED.create_date,
      supply_date = EXCLUDED.supply_date,
      fact_date = EXCLUDED.fact_date,
      updated_date = EXCLUDED.updated_date,
      warehouse_name = EXCLUDED.warehouse_name,
      actual_warehouse_name = EXCLUDED.actual_warehouse_name,
      quantity = EXCLUDED.quantity,
      accepted_quantity = EXCLUDED.accepted_quantity,
      list_position = EXCLUDED.list_position,
      row_json = EXCLUDED.row_json,
      detail_json = EXCLUDED.detail_json,
      refreshed_at = EXCLUDED.refreshed_at
    RETURNING supply_id
  `, [
    input.supplyID,
    numberOrNull(row.preorderID),
    numberOrNull(detail.statusID ?? row.statusID),
    numberOrNull(detail.virtualTypeID),
    numberOrNull(detail.boxTypeID ?? row.boxTypeID),
    stringOrNull(detail.createDate ?? row.createDate),
    stringOrNull(detail.supplyDate ?? row.supplyDate),
    stringOrNull(detail.factDate ?? row.factDate),
    stringOrNull(detail.updatedDate ?? row.updatedDate),
    stringOrNull(detail.warehouseName),
    stringOrNull(detail.actualWarehouseName),
    numberOrNull(detail.quantity),
    numberOrNull(detail.acceptedQuantity),
    input.listPosition,
    JSON.stringify(row),
    input.detail ? JSON.stringify(detail) : null,
    now,
    now,
  ]);
}

export function getSupplySnapshots(limit = 20, offset = 0): StoredSupplySnapshot[] {
  initShipmentTables();
  const d = getDb();
  const rows = d.prepare(`
    SELECT supply_id, row_json, detail_json
    FROM wb_supply_snapshots
    ORDER BY list_position ASC, COALESCE(updated_date, supply_date, create_date) DESC, supply_id DESC
    LIMIT ? OFFSET ?
  `).all(limit, offset) as { supply_id: number; row_json: string; detail_json: string | null }[];

  return rows.flatMap((row) => {
    try {
      return [{
        supplyID: row.supply_id,
        row: JSON.parse(row.row_json),
        detail: row.detail_json ? JSON.parse(row.detail_json) : null,
      }];
    } catch {
      return [];
    }
  });
}

export async function getSupplySnapshotsPg(limit = 20, offset = 0): Promise<StoredSupplySnapshot[]> {
  await initShipmentTablesPg();
  let rows: { supply_id: number; row_json: string; detail_json: string | null }[] = [];
  try {
    rows = await pgRows<{ supply_id: number; row_json: string; detail_json: string | null }>(`
      SELECT supply_id, row_json, detail_json
      FROM wb_supply_snapshots
      ORDER BY list_position ASC, COALESCE(updated_date, supply_date, create_date) DESC, supply_id DESC
      LIMIT ? OFFSET ?
    `, [limit, offset]);
  } catch (error) {
    if (error instanceof Error && /relation .* does not exist/i.test(error.message)) return [];
    throw error;
  }

  return rows.flatMap((row) => {
    try {
      return [{
        supplyID: row.supply_id,
        row: JSON.parse(row.row_json),
        detail: row.detail_json ? JSON.parse(row.detail_json) : null,
      }];
    } catch {
      return [];
    }
  });
}

export function saveAcceptedSupply(input: AcceptedSupplyInput): void {
  initShipmentTables();
  const d = getDb();
  const now = new Date().toISOString();
  const row = input.row as Record<string, unknown>;
  const detail = input.detail || {};

  d.prepare(`
    INSERT INTO wb_accepted_supplies (
      supply_id, preorder_id, status_id, virtual_type_id, box_type_id,
      create_date, supply_date, fact_date, updated_date,
      warehouse_name, actual_warehouse_name, quantity, accepted_quantity,
      row_json, detail_json, saved_at, refreshed_at
    )
    VALUES (
      @supplyID, @preorderID, @statusID, @virtualTypeID, @boxTypeID,
      @createDate, @supplyDate, @factDate, @updatedDate,
      @warehouseName, @actualWarehouseName, @quantity, @acceptedQuantity,
      @rowJson, @detailJson, @savedAt, @refreshedAt
    )
    ON CONFLICT(supply_id) DO UPDATE SET
      preorder_id = excluded.preorder_id,
      status_id = excluded.status_id,
      virtual_type_id = excluded.virtual_type_id,
      box_type_id = excluded.box_type_id,
      create_date = excluded.create_date,
      supply_date = excluded.supply_date,
      fact_date = excluded.fact_date,
      updated_date = excluded.updated_date,
      warehouse_name = excluded.warehouse_name,
      actual_warehouse_name = excluded.actual_warehouse_name,
      quantity = excluded.quantity,
      accepted_quantity = excluded.accepted_quantity,
      row_json = excluded.row_json,
      detail_json = excluded.detail_json,
      refreshed_at = excluded.refreshed_at
  `).run({
    supplyID: input.supplyID,
    preorderID: numberOrNull(row.preorderID),
    statusID: numberOrNull(detail.statusID ?? row.statusID),
    virtualTypeID: numberOrNull(detail.virtualTypeID),
    boxTypeID: numberOrNull(detail.boxTypeID ?? row.boxTypeID),
    createDate: stringOrNull(detail.createDate ?? row.createDate),
    supplyDate: stringOrNull(detail.supplyDate ?? row.supplyDate),
    factDate: stringOrNull(detail.factDate ?? row.factDate),
    updatedDate: stringOrNull(detail.updatedDate ?? row.updatedDate),
    warehouseName: stringOrNull(detail.warehouseName),
    actualWarehouseName: stringOrNull(detail.actualWarehouseName),
    quantity: numberOrNull(detail.quantity),
    acceptedQuantity: numberOrNull(detail.acceptedQuantity),
    rowJson: JSON.stringify(row),
    detailJson: JSON.stringify(detail),
    savedAt: now,
    refreshedAt: now,
  });
}

export async function saveAcceptedSupplyPg(input: AcceptedSupplyInput): Promise<void> {
  await initShipmentTablesPg();
  if (isPostgresReadonlyConnection()) return;

  const now = new Date().toISOString();
  const row = input.row as Record<string, unknown>;
  const detail = input.detail || {};

  await pgGet(`
    INSERT INTO wb_accepted_supplies (
      supply_id, preorder_id, status_id, virtual_type_id, box_type_id,
      create_date, supply_date, fact_date, updated_date,
      warehouse_name, actual_warehouse_name, quantity, accepted_quantity,
      row_json, detail_json, saved_at, refreshed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(supply_id) DO UPDATE SET
      preorder_id = EXCLUDED.preorder_id,
      status_id = EXCLUDED.status_id,
      virtual_type_id = EXCLUDED.virtual_type_id,
      box_type_id = EXCLUDED.box_type_id,
      create_date = EXCLUDED.create_date,
      supply_date = EXCLUDED.supply_date,
      fact_date = EXCLUDED.fact_date,
      updated_date = EXCLUDED.updated_date,
      warehouse_name = EXCLUDED.warehouse_name,
      actual_warehouse_name = EXCLUDED.actual_warehouse_name,
      quantity = EXCLUDED.quantity,
      accepted_quantity = EXCLUDED.accepted_quantity,
      row_json = EXCLUDED.row_json,
      detail_json = EXCLUDED.detail_json,
      refreshed_at = EXCLUDED.refreshed_at
    RETURNING supply_id
  `, [
    input.supplyID,
    numberOrNull(row.preorderID),
    numberOrNull(detail.statusID ?? row.statusID),
    numberOrNull(detail.virtualTypeID),
    numberOrNull(detail.boxTypeID ?? row.boxTypeID),
    stringOrNull(detail.createDate ?? row.createDate),
    stringOrNull(detail.supplyDate ?? row.supplyDate),
    stringOrNull(detail.factDate ?? row.factDate),
    stringOrNull(detail.updatedDate ?? row.updatedDate),
    stringOrNull(detail.warehouseName),
    stringOrNull(detail.actualWarehouseName),
    numberOrNull(detail.quantity),
    numberOrNull(detail.acceptedQuantity),
    JSON.stringify(row),
    JSON.stringify(detail),
    now,
    now,
  ]);
}

export function getAcceptedSupply(supplyID: number): StoredAcceptedSupply | null {
  initShipmentTables();
  const d = getDb();
  const row = d.prepare(`
    SELECT supply_id, row_json, detail_json
    FROM wb_accepted_supplies
    WHERE supply_id = ?
  `).get(supplyID) as { supply_id: number; row_json: string; detail_json: string } | undefined;

  if (!row) return null;

  try {
    return {
      supplyID: row.supply_id,
      row: JSON.parse(row.row_json),
      detail: JSON.parse(row.detail_json),
    };
  } catch {
    return null;
  }
}

export async function getAcceptedSupplyPg(supplyID: number): Promise<StoredAcceptedSupply | null> {
  await initShipmentTablesPg();
  let row: { supply_id: number; row_json: string; detail_json: string } | undefined;
  try {
    row = await pgGet<{ supply_id: number; row_json: string; detail_json: string }>(`
      SELECT supply_id, row_json, detail_json
      FROM wb_accepted_supplies
      WHERE supply_id = ?
    `, [supplyID]);
  } catch (error) {
    if (error instanceof Error && /relation .* does not exist/i.test(error.message)) return null;
    throw error;
  }

  if (!row) return null;

  try {
    return {
      supplyID: row.supply_id,
      row: JSON.parse(row.row_json),
      detail: JSON.parse(row.detail_json),
    };
  } catch {
    return null;
  }
}

export function saveAcceptedSupplyContent(input: AcceptedSupplyContentInput): void {
  initShipmentTables();
  const d = getDb();
  const now = new Date().toISOString();
  d.prepare(`
    INSERT INTO wb_accepted_supply_contents (supply_id, source, payload_json, saved_at, refreshed_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(supply_id) DO UPDATE SET
      source = excluded.source,
      payload_json = excluded.payload_json,
      refreshed_at = excluded.refreshed_at
  `).run(input.supplyID, input.source, JSON.stringify(input.payload), now, now);
}

export async function saveAcceptedSupplyContentPg(input: AcceptedSupplyContentInput): Promise<void> {
  await initShipmentTablesPg();
  if (isPostgresReadonlyConnection()) return;

  const now = new Date().toISOString();
  await pgGet(`
    INSERT INTO wb_accepted_supply_contents (supply_id, source, payload_json, saved_at, refreshed_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(supply_id) DO UPDATE SET
      source = EXCLUDED.source,
      payload_json = EXCLUDED.payload_json,
      refreshed_at = EXCLUDED.refreshed_at
    RETURNING supply_id
  `, [input.supplyID, input.source, JSON.stringify(input.payload), now, now]);
}

export function getAcceptedSupplyContent(supplyID: number): StoredAcceptedSupplyContent | null {
  initShipmentTables();
  const d = getDb();
  const row = d.prepare(`
    SELECT supply_id, source, payload_json
    FROM wb_accepted_supply_contents
    WHERE supply_id = ?
  `).get(supplyID) as { supply_id: number; source: "package" | "goods"; payload_json: string } | undefined;

  if (!row) return null;

  try {
    return {
      supplyID: row.supply_id,
      source: row.source,
      payload: JSON.parse(row.payload_json),
    };
  } catch {
    return null;
  }
}

export async function getAcceptedSupplyContentPg(supplyID: number): Promise<StoredAcceptedSupplyContent | null> {
  await initShipmentTablesPg();
  let row: { supply_id: number; source: "package" | "goods"; payload_json: string } | undefined;
  try {
    row = await pgGet<{ supply_id: number; source: "package" | "goods"; payload_json: string }>(`
      SELECT supply_id, source, payload_json
      FROM wb_accepted_supply_contents
      WHERE supply_id = ?
    `, [supplyID]);
  } catch (error) {
    if (error instanceof Error && /relation .* does not exist/i.test(error.message)) return null;
    throw error;
  }

  if (!row) return null;

  try {
    return {
      supplyID: row.supply_id,
      source: row.source,
      payload: JSON.parse(row.payload_json),
    };
  } catch {
    return null;
  }
}

export function saveOrders(orders: OrderRecord[]): void {
  const d = getDb();
  // INSERT with ON CONFLICT UPDATE — accumulate orders and update cancel status
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

export async function saveOrdersPg(orders: OrderRecord[]): Promise<void> {
  await initShipmentTablesPg();
  assertPostgresWritable();
  await withPgTransaction(async (client) => {
    for (const o of orders) {
      await client.query(`
        INSERT INTO shipment_orders
          (date, warehouse, federal_district, region, article_seller, article_wb,
           barcode, category, subject, brand, size, total_price, discount_percent,
           spp, finished_price, price_with_disc, is_cancel, cancel_date)
        VALUES
          ($1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10, $11, $12, $13,
           $14, $15, $16, $17, $18)
        ON CONFLICT(barcode, date, warehouse) DO UPDATE SET
          is_cancel = EXCLUDED.is_cancel,
          cancel_date = EXCLUDED.cancel_date
      `, [
        o.date,
        o.warehouse,
        o.federalDistrict,
        o.region,
        o.articleSeller,
        Number(o.articleWB) || 0,
        o.barcode,
        o.category,
        o.subject,
        o.brand,
        o.size,
        o.totalPrice,
        o.discountPercent,
        o.spp,
        o.finishedPrice,
        o.priceWithDisc,
        o.isCancel ? 1 : 0,
        o.cancelDate || "",
      ]);
    }
  });
}

export function saveStock(stock: StockItem[]): { total: number; written: number; skipped: number } {
  const d = getDb();
  // Снимок quantity для diff (ключ: barcode|warehouse)
  const existingRows = d.prepare("SELECT barcode, warehouse, quantity FROM shipment_stock").all() as {
    barcode: string; warehouse: string; quantity: number;
  }[];
  const existing = new Map(existingRows.map(r => [`${r.barcode}|${r.warehouse}`, r.quantity]));

  const stmt = d.prepare(`
    REPLACE INTO shipment_stock
      (barcode, article_wb, article_seller, brand, size, warehouse, quantity, updated_at)
    VALUES
      (@barcode, @articleWB, @articleSeller, @brand, @size, @warehouse, @quantity, @updatedAt)
  `);

  const now = new Date().toISOString();
  let total = 0;
  let written = 0;
  let skipped = 0;

  const writeRow = (args: { barcode: string; articleWB: string; articleSeller: string; brand: string; size: string; warehouse: string; quantity: number }) => {
    total++;
    const key = `${args.barcode}|${args.warehouse}`;
    const prevQty = existing.get(key);
    if (prevQty !== undefined && prevQty === args.quantity) {
      skipped++;
      return;
    }
    stmt.run({ ...args, updatedAt: now });
    written++;
  };

  const insert = d.transaction((rows: StockItem[]) => {
    for (const s of rows) {
      const warehouses = Object.entries(s.warehouseStock);
      if (warehouses.length > 0) {
        for (const [warehouse, quantity] of warehouses) {
          writeRow({
            barcode: s.barcode,
            articleWB: s.articleWB,
            articleSeller: s.articleSeller,
            brand: s.brand,
            size: s.size,
            warehouse,
            quantity,
          });
        }
      } else {
        writeRow({
          barcode: s.barcode,
          articleWB: s.articleWB,
          articleSeller: s.articleSeller,
          brand: s.brand,
          size: s.size,
          warehouse: "",
          quantity: s.totalOnWarehouses,
        });
      }
    }
  });

  insert(stock);
  return { total, written, skipped };
}

export async function saveStockPg(stock: StockItem[]): Promise<{ total: number; written: number; skipped: number }> {
  await initShipmentTablesPg();
  assertPostgresWritable();
  const existingRows = await pgRows<{ barcode: string; warehouse: string; quantity: number }>(
    "SELECT barcode, warehouse, quantity FROM shipment_stock"
  );
  const existing = new Map(existingRows.map(r => [`${r.barcode}|${r.warehouse}`, r.quantity]));

  const now = new Date().toISOString();
  let total = 0;
  let written = 0;
  let skipped = 0;

  await withPgTransaction(async (client) => {
    const writeRow = async (args: { barcode: string; articleWB: string; articleSeller: string; brand: string; size: string; warehouse: string; quantity: number }) => {
      total++;
      const key = `${args.barcode}|${args.warehouse}`;
      const prevQty = existing.get(key);
      if (prevQty !== undefined && prevQty === args.quantity) {
        skipped++;
        return;
      }
      await client.query(`
        INSERT INTO shipment_stock
          (barcode, article_wb, article_seller, brand, size, warehouse, quantity, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT(barcode, warehouse) DO UPDATE SET
          article_wb = EXCLUDED.article_wb,
          article_seller = EXCLUDED.article_seller,
          brand = EXCLUDED.brand,
          size = EXCLUDED.size,
          quantity = EXCLUDED.quantity,
          updated_at = EXCLUDED.updated_at
      `, [args.barcode, args.articleWB, args.articleSeller, args.brand, args.size, args.warehouse, args.quantity, now]);
      written++;
    };

    for (const s of stock) {
      const warehouses = Object.entries(s.warehouseStock);
      if (warehouses.length > 0) {
        for (const [warehouse, quantity] of warehouses) {
          await writeRow({
            barcode: s.barcode,
            articleWB: s.articleWB,
            articleSeller: s.articleSeller,
            brand: s.brand,
            size: s.size,
            warehouse,
            quantity,
          });
        }
      } else {
        await writeRow({
          barcode: s.barcode,
          articleWB: s.articleWB,
          articleSeller: s.articleSeller,
          brand: s.brand,
          size: s.size,
          warehouse: "",
          quantity: s.totalOnWarehouses,
        });
      }
    }
  });

  return { total, written, skipped };
}

export function saveProducts(products: Product[]): { total: number; written: number; skipped: number } {
  const d = getDb();
  // Снимок текущих записей для diff
  const existingRows = d.prepare("SELECT article_wb, name, brand, category, length_cm, width_cm, height_cm, sizes_json FROM shipment_products").all() as {
    article_wb: string; name: string; brand: string; category: string; length_cm: number; width_cm: number; height_cm: number; sizes_json: string;
  }[];
  const existing = new Map(existingRows.map(r => [r.article_wb, r]));

  const stmt = d.prepare(`
    REPLACE INTO shipment_products (article_wb, name, brand, category, length_cm, width_cm, height_cm, sizes_json)
    VALUES (@articleWB, @name, @brand, @category, @lengthCm, @widthCm, @heightCm, @sizesJson)
  `);

  let written = 0;
  let skipped = 0;
  const insert = d.transaction((rows: Product[]) => {
    for (const p of rows) {
      const sizesJson = JSON.stringify(p.sizes);
      const lengthCm = Number(p.lengthCm) || 0;
      const widthCm = Number(p.widthCm) || 0;
      const heightCm = Number(p.heightCm) || 0;
      const old = existing.get(p.articleWB);
      if (old
        && old.name === p.name
        && old.brand === p.brand
        && old.category === p.category
        && Number(old.length_cm || 0) === lengthCm
        && Number(old.width_cm || 0) === widthCm
        && Number(old.height_cm || 0) === heightCm
        && old.sizes_json === sizesJson) {
        skipped++;
        continue;
      }
      stmt.run({
        articleWB: p.articleWB,
        name: p.name,
        brand: p.brand,
        category: p.category,
        lengthCm,
        widthCm,
        heightCm,
        sizesJson,
      });
      written++;
    }
  });

  insert(products);
  return { total: products.length, written, skipped };
}

export async function saveProductsPg(products: Product[]): Promise<{ total: number; written: number; skipped: number }> {
  await initShipmentTablesPg();
  assertPostgresWritable();
  const existingRows = await pgRows<{
    article_wb: string; name: string; brand: string; category: string; length_cm: number; width_cm: number; height_cm: number; sizes_json: string;
  }>("SELECT article_wb, name, brand, category, length_cm, width_cm, height_cm, sizes_json FROM shipment_products");
  const existing = new Map(existingRows.map(r => [r.article_wb, r]));

  let written = 0;
  let skipped = 0;
  await withPgTransaction(async (client) => {
    for (const p of products) {
      const sizesJson = JSON.stringify(p.sizes);
      const lengthCm = Number(p.lengthCm) || 0;
      const widthCm = Number(p.widthCm) || 0;
      const heightCm = Number(p.heightCm) || 0;
      const old = existing.get(p.articleWB);
      if (old
        && old.name === p.name
        && old.brand === p.brand
        && old.category === p.category
        && Number(old.length_cm || 0) === lengthCm
        && Number(old.width_cm || 0) === widthCm
        && Number(old.height_cm || 0) === heightCm
        && old.sizes_json === sizesJson) {
        skipped++;
        continue;
      }
      await client.query(`
        INSERT INTO shipment_products (article_wb, name, brand, category, length_cm, width_cm, height_cm, sizes_json)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT(article_wb) DO UPDATE SET
          name = EXCLUDED.name,
          brand = EXCLUDED.brand,
          category = EXCLUDED.category,
          length_cm = EXCLUDED.length_cm,
          width_cm = EXCLUDED.width_cm,
          height_cm = EXCLUDED.height_cm,
          sizes_json = EXCLUDED.sizes_json
      `, [p.articleWB, p.name, p.brand, p.category, lengthCm, widthCm, heightCm, sizesJson]);
      written++;
    }
  });

  return { total: products.length, written, skipped };
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
    articleWB: String(r.article_wb ?? ""),
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

export async function getOrdersPg(dateFrom: string, dateTo: string): Promise<OrderRecord[]> {
  await initShipmentTablesPg();
  const rows = await pgRows<Record<string, unknown>>(`
    SELECT * FROM shipment_orders
    WHERE date >= ? AND date < ?
    ORDER BY date DESC
  `, [dateFrom, dateTo]);

  return rows.map((r) => ({
    date: r.date as string,
    warehouse: r.warehouse as string,
    warehouseType: "",
    country: "",
    federalDistrict: r.federal_district as string,
    region: r.region as string,
    articleSeller: r.article_seller as string,
    articleWB: String(r.article_wb ?? ""),
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

/**
 * Get correction coefficient for last 7 days by comparing
 * supplier/orders (incomplete) with Sales Funnel (accurate).
 * Returns per-article multipliers for the last 7 days.
 */
export function getLastWeekCorrection(): Map<string, number> {
  const d = getDb();
  const corrections = new Map<string, number>();

  try {
    // Sales Funnel totals for last 7 days (accurate)
    const funnelRow = d.prepare(`
      SELECT SUM(order_count) as funnel_total
      FROM orders_funnel
      WHERE date >= date('now', '-7 days') AND date < date('now')
    `).get() as { funnel_total: number } | undefined;

    // supplier/orders totals for last 7 days
    const ordersRow = d.prepare(`
      SELECT COUNT(*) as orders_total
      FROM shipment_orders
      WHERE date >= date('now', '-7 days') AND date < date('now')
    `).get() as { orders_total: number } | undefined;

    const funnelTotal = funnelRow?.funnel_total || 0;
    const ordersTotal = ordersRow?.orders_total || 0;

    if (funnelTotal > 0 && ordersTotal > 0 && funnelTotal > ordersTotal) {
      // Global correction coefficient
      const globalCoeff = funnelTotal / ordersTotal;
      corrections.set("__global__", globalCoeff);
    }
  } catch {
    // If orders_funnel doesn't exist or error — no correction
  }

  return corrections;
}

export async function getLastWeekCorrectionPg(): Promise<Map<string, number>> {
  await initShipmentTablesPg();
  const corrections = new Map<string, number>();

  try {
    const funnelRow = await pgGet<{ funnel_total: number }>(`
      SELECT SUM(order_count) as funnel_total
      FROM orders_funnel
      WHERE date >= (CURRENT_DATE - INTERVAL '7 days')::text AND date < CURRENT_DATE::text
    `);
    const ordersRow = await pgGet<{ orders_total: number }>(`
      SELECT COUNT(*) as orders_total
      FROM shipment_orders
      WHERE date >= (CURRENT_DATE - INTERVAL '7 days')::text AND date < CURRENT_DATE::text
    `);

    const funnelTotal = funnelRow?.funnel_total || 0;
    const ordersTotal = ordersRow?.orders_total || 0;

    if (funnelTotal > 0 && ordersTotal > 0 && funnelTotal > ordersTotal) {
      corrections.set("__global__", funnelTotal / ordersTotal);
    }
  } catch {
    // If orders_funnel doesn't exist or error — no correction
  }

  return corrections;
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

export async function getStockPg(): Promise<StockItem[]> {
  await initShipmentTablesPg();
  const rows = await pgRows<Record<string, unknown>>(`
    SELECT barcode, article_wb, article_seller, brand, size,
           warehouse, quantity
    FROM shipment_stock
    ORDER BY barcode, warehouse
  `);

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
    SELECT article_wb, name, brand, category, length_cm, width_cm, height_cm, sizes_json
    FROM shipment_products
    ORDER BY article_wb
  `).all() as Record<string, unknown>[];

  return rows.map((r) => ({
    articleWB: r.article_wb as string,
    name: r.name as string,
    brand: r.brand as string,
    category: r.category as string,
    lengthCm: Number(r.length_cm) || 0,
    widthCm: Number(r.width_cm) || 0,
    heightCm: Number(r.height_cm) || 0,
    sizes: (() => {
      try {
        return JSON.parse(r.sizes_json as string);
      } catch {
        return [];
      }
    })(),
  }));
}

export async function getProductsPg(): Promise<Product[]> {
  await initShipmentTablesPg();
  const rows = await pgRows<Record<string, unknown>>(`
    SELECT article_wb, name, brand, category, length_cm, width_cm, height_cm, sizes_json
    FROM shipment_products
    ORDER BY article_wb
  `);

  return rows.map((r) => ({
    articleWB: r.article_wb as string,
    name: r.name as string,
    brand: r.brand as string,
    category: r.category as string,
    lengthCm: Number(r.length_cm) || 0,
    widthCm: Number(r.width_cm) || 0,
    heightCm: Number(r.height_cm) || 0,
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

export async function getUploadDatePg(): Promise<string | null> {
  await initShipmentTablesPg();
  const row = await pgGet<{ value: string }>(
    `SELECT value FROM shipment_meta WHERE key = 'uploadDate'`
  );
  return row?.value || null;
}

export function setUploadDate(date: string): void {
  const d = getDb();
  d.prepare(`INSERT INTO shipment_meta (key, value) VALUES ('uploadDate', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(date);
}

export async function setUploadDatePg(date: string): Promise<void> {
  await initShipmentTablesPg();
  assertPostgresWritable();
  await pgGet(`
    INSERT INTO shipment_meta (key, value) VALUES ('uploadDate', ?)
    ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value
    RETURNING key
  `, [date]);
}

// --- User functions ---

export function createUser(email: string, passwordHash: string, name: string, role: string): number {
  const d = getDb();
  const result = d.prepare(`
    INSERT INTO users (email, password_hash, name, role)
    VALUES (?, ?, ?, ?)
  `).run(email, passwordHash, name, role);
  return result.lastInsertRowid as number;
}

export async function createUserPg(email: string, passwordHash: string, name: string, role: string): Promise<number> {
  await initShipmentTablesPg();
  const row = await pgGet<{ id: number }>(`
    INSERT INTO users (email, password_hash, name, role)
    VALUES (?, ?, ?, ?)
    RETURNING id
  `, [email, passwordHash, name, role]);
  return row?.id || 0;
}

export function getUserByEmail(email: string): UserRow | null {
  const d = getDb();
  return (d.prepare(`SELECT * FROM users WHERE email = ?`).get(email) as UserRow) || null;
}

export async function getUserByEmailPg(email: string): Promise<UserRow | null> {
  await initShipmentTablesPg();
  return await pgGet<UserRow>(`SELECT * FROM users WHERE email = ?`, [email]) || null;
}

export function getUserById(id: number): UserRow | null {
  const d = getDb();
  return (d.prepare(`SELECT * FROM users WHERE id = ?`).get(id) as UserRow) || null;
}

export async function getUserByIdPg(id: number): Promise<UserRow | null> {
  await initShipmentTablesPg();
  return await pgGet<UserRow>(`SELECT * FROM users WHERE id = ?`, [id]) || null;
}

export function updateUserPasswordHash(userId: number, passwordHash: string): void {
  const d = getDb();
  d.prepare(`UPDATE users SET password_hash = ? WHERE id = ?`).run(passwordHash, userId);
}

export async function updateUserPasswordHashPg(userId: number, passwordHash: string): Promise<void> {
  await initShipmentTablesPg();
  await pgGet(`UPDATE users SET password_hash = ? WHERE id = ? RETURNING id`, [passwordHash, userId]);
}

// --- User settings ---

export function getUserSettings(userId: number): Record<string, unknown> {
  const d = getDb();
  const rows = d.prepare(`SELECT key, value FROM user_settings WHERE user_id = ?`).all(userId) as { key: string; value: string }[];
  const result: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      result[row.key] = JSON.parse(row.value);
    } catch {
      result[row.key] = row.value;
    }
  }
  return result;
}

export async function getUserSettingsPg(userId: number): Promise<Record<string, unknown>> {
  await initShipmentTablesPg();
  const rows = await pgRows<{ key: string; value: string }>(
    `SELECT key, value FROM user_settings WHERE user_id = ?`,
    [userId]
  );
  const result: Record<string, unknown> = {};
  for (const row of rows) {
    try {
      result[row.key] = JSON.parse(row.value);
    } catch {
      result[row.key] = row.value;
    }
  }
  return result;
}

export function setUserSetting(userId: number, key: string, value: unknown): void {
  const d = getDb();
  d.prepare(`
    INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
    ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value
  `).run(userId, key, JSON.stringify(value));
}

export async function setUserSettingPg(userId: number, key: string, value: unknown): Promise<void> {
  await initShipmentTablesPg();
  await pgGet(`
    INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
    ON CONFLICT(user_id, key) DO UPDATE SET value = EXCLUDED.value
    RETURNING user_id
  `, [userId, key, JSON.stringify(value)]);
}

// --- Product overrides ---

export function getUserOverrides(userId: number): ProductOverrides {
  const d = getDb();
  const rows = d.prepare(`
    SELECT article_wb, barcode, custom_name, per_box, disabled
    FROM product_overrides
    WHERE user_id = ?
  `).all(userId) as { article_wb: string; barcode: string; custom_name: string | null; per_box: number | null; disabled: number }[];

  const result: ProductOverrides = {};
  for (const row of rows) {
    if (!result[row.article_wb]) {
      result[row.article_wb] = { customName: row.custom_name || "", perBox: {}, disabledSizes: {} };
    }
    const override = result[row.article_wb];
    if (row.custom_name) override.customName = row.custom_name;
    if (row.per_box !== null) override.perBox[row.barcode] = row.per_box;
    if (row.disabled) override.disabledSizes = { ...(override.disabledSizes || {}), [row.barcode]: true };
  }
  return result;
}

export async function getUserOverridesPg(userId: number): Promise<ProductOverrides> {
  await initShipmentTablesPg();
  const rows = await pgRows<{ article_wb: string; barcode: string; custom_name: string | null; per_box: number | null; disabled: number }>(`
    SELECT article_wb, barcode, custom_name, per_box, disabled
    FROM product_overrides
    WHERE user_id = ?
  `, [userId]);

  const result: ProductOverrides = {};
  for (const row of rows) {
    if (!result[row.article_wb]) {
      result[row.article_wb] = { customName: row.custom_name || "", perBox: {}, disabledSizes: {} };
    }
    const override = result[row.article_wb];
    if (row.custom_name) override.customName = row.custom_name;
    if (row.per_box !== null) override.perBox[row.barcode] = row.per_box;
    if (row.disabled) override.disabledSizes = { ...(override.disabledSizes || {}), [row.barcode]: true };
  }
  return result;
}

export function setUserOverride(
  userId: number,
  articleWB: string,
  barcode: string,
  data: Partial<Pick<ProductOverride, "customName"> & { perBox?: number; disabled?: boolean }>
): void {
  const d = getDb();
  d.prepare(`
    INSERT INTO product_overrides (user_id, article_wb, barcode, custom_name, per_box, disabled)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, article_wb, barcode) DO UPDATE SET
      custom_name = COALESCE(excluded.custom_name, custom_name),
      per_box = COALESCE(excluded.per_box, per_box),
      disabled = COALESCE(excluded.disabled, disabled)
  `).run(
    userId,
    articleWB,
    barcode,
    data.customName ?? null,
    data.perBox !== undefined ? data.perBox : null,
    data.disabled !== undefined ? (data.disabled ? 1 : 0) : null,
  );
}

export async function setUserOverridePg(
  userId: number,
  articleWB: string,
  barcode: string,
  data: Partial<Pick<ProductOverride, "customName"> & { perBox?: number; disabled?: boolean }>
): Promise<void> {
  await initShipmentTablesPg();
  await pgGet(`
    INSERT INTO product_overrides (user_id, article_wb, barcode, custom_name, per_box, disabled)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id, article_wb, barcode) DO UPDATE SET
      custom_name = COALESCE(EXCLUDED.custom_name, product_overrides.custom_name),
      per_box = COALESCE(EXCLUDED.per_box, product_overrides.per_box),
      disabled = COALESCE(EXCLUDED.disabled, product_overrides.disabled)
    RETURNING user_id
  `, [
    userId,
    articleWB,
    barcode,
    data.customName ?? null,
    data.perBox !== undefined ? data.perBox : null,
    data.disabled !== undefined ? (data.disabled ? 1 : 0) : null,
  ]);
}

export async function getLoginAttemptPg(key: string): Promise<{ count: number; first_at: number } | null> {
  await initShipmentTablesPg();
  return await pgGet<{ count: number; first_at: number }>(
    "SELECT count, first_at FROM auth_login_attempts WHERE key = ?",
    [key]
  ) || null;
}

export async function deleteLoginAttemptPg(key: string): Promise<void> {
  await initShipmentTablesPg();
  if (isPostgresReadonlyConnection()) return;
  await pgGet("DELETE FROM auth_login_attempts WHERE key = ? RETURNING key", [key]);
}

export async function recordLoginFailurePg(key: string, now: number, windowMs: number): Promise<void> {
  await initShipmentTablesPg();
  if (isPostgresReadonlyConnection()) return;
  await withPgTransaction(async (client: PoolClient) => {
    await client.query("DELETE FROM auth_login_attempts WHERE updated_at < $1", [now - windowMs * 4]);
    const state = await client.query<{ count: number; first_at: number }>(
      "SELECT count, first_at FROM auth_login_attempts WHERE key = $1",
      [key]
    );
    const row = state.rows[0];
    if (!row || now - row.first_at > windowMs) {
      await client.query(`
        INSERT INTO auth_login_attempts (key, count, first_at, updated_at)
        VALUES ($1, 1, $2, $2)
        ON CONFLICT(key) DO UPDATE SET count = 1, first_at = EXCLUDED.first_at, updated_at = EXCLUDED.updated_at
      `, [key, now]);
      return;
    }

    await client.query(
      "UPDATE auth_login_attempts SET count = count + 1, updated_at = $1 WHERE key = $2",
      [now, key]
    );
  });
}
