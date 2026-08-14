import crypto from "node:crypto";
import type { PoolClient } from "pg";
import { pgGet, pgRows, withPgTransaction } from "@/lib/postgres";
import {
  getFbsCardByNmId,
  getFbsOrderStatuses,
  getFbsOrdersSince,
  getFbsStock,
  getFbsStocks,
  getFbsWarehouses,
  getNewFbsOrders,
  putFbsStock,
  waitForFbsRateLimit,
  FbsWbApiError,
  type FbsWbOrder,
  type FbsWbOrderStatus,
} from "@/lib/fbs-wb-api";
import { allocateFbsStock } from "@/lib/fbs-stock-allocation";

interface ProductRow {
  id: number;
  nm_id: number;
  chrt_id: number;
  vendor_code: string;
  title: string;
  photo_url: string;
  size_name: string;
  physical_quantity: number;
  enabled: boolean;
  baseline_at: string | null;
  last_new_orders_at: string | null;
  last_history_at: string | null;
  last_sync_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
}

interface WarehouseRow {
  product_id: number;
  warehouse_id: number;
  warehouse_name: string;
  enabled: boolean;
  target_quantity: number;
  confirmed_quantity: number | null;
  last_checked_at: string | null;
  last_error: string | null;
  orders_30d?: number;
}

export interface FbsProductDiscovery {
  card: Awaited<ReturnType<typeof getFbsCardByNmId>>;
  warehouses: Array<Awaited<ReturnType<typeof getFbsWarehouses>>[number] & { amount: number | null; error?: string }>;
}

export interface ConfigureFbsProductInput {
  nmId: number;
  chrtId: number;
  physicalQuantity: number;
  warehouseIds: number[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asDate(value: string | Date | null | undefined, fallback = new Date(0)): Date {
  const date = value instanceof Date ? value : new Date(value || "");
  return Number.isNaN(date.getTime()) ? fallback : date;
}

async function audit(
  client: PoolClient,
  input: {
    productId?: number | null;
    orderId?: number | null;
    action: string;
    status?: string;
    warehouseFromId?: number | null;
    warehouseToId?: number | null;
    quantity?: number | null;
    message?: string;
    details?: unknown;
  },
): Promise<void> {
  await client.query(`
    INSERT INTO fbs_stock_audit (
      product_id, order_id, action, status, warehouse_from_id,
      warehouse_to_id, quantity, message, details_json
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
  `, [
    input.productId || null,
    input.orderId || null,
    input.action,
    input.status || "ok",
    input.warehouseFromId || null,
    input.warehouseToId || null,
    input.quantity ?? null,
    input.message || "",
    JSON.stringify(input.details || {}),
  ]);
}

function isMissingFbsWarehouse(error: unknown): boolean {
  return error instanceof FbsWbApiError && error.status === 404;
}

async function disableWarehousesMissingFromWb(
  liveWarehouses: Array<{ id: number; name: string }>,
  productIds?: number[],
): Promise<void> {
  const liveIds = liveWarehouses.map((warehouse) => Number(warehouse.id));
  const scopedProductIds = Array.from(new Set((productIds || []).map(Number).filter(Number.isSafeInteger)));
  await withPgTransaction(async (client) => {
    const result = await client.query<{ product_id: number; warehouse_id: number; warehouse_name: string }>(`
      UPDATE fbs_stock_warehouses
      SET enabled=FALSE,
          target_quantity=0,
          confirmed_quantity=0,
          last_checked_at=CURRENT_TIMESTAMP,
          last_error=NULL,
          updated_at=CURRENT_TIMESTAMP
      WHERE NOT (warehouse_id=ANY($1::bigint[]))
        ${scopedProductIds.length ? "AND product_id=ANY($2::bigint[])" : ""}
        AND (enabled=TRUE OR target_quantity<>0 OR confirmed_quantity IS DISTINCT FROM 0 OR last_error IS NOT NULL)
      RETURNING product_id,warehouse_id,warehouse_name
    `, scopedProductIds.length ? [liveIds, scopedProductIds] : [liveIds]);
    const removedByProduct = new Map<number, Array<{ id: number; name: string }>>();
    for (const row of result.rows) {
      const productId = Number(row.product_id);
      const removed = removedByProduct.get(productId) || [];
      removed.push({ id: Number(row.warehouse_id), name: row.warehouse_name });
      removedByProduct.set(productId, removed);
    }
    for (const [productId, removed] of removedByProduct) {
      await audit(client, {
        productId,
        action: "warehouse_removed",
        quantity: removed.length,
        message: `Удалённые в WB склады исключены из управления: ${removed.map((warehouse) => warehouse.name).join(", ")}`,
        details: { warehouses: removed },
      });
    }
  });
}

export async function discoverFbsProduct(nmId: number): Promise<FbsProductDiscovery> {
  const [card, warehouses] = await Promise.all([
    getFbsCardByNmId(nmId),
    getFbsWarehouses(),
  ]);
  const chrtId = card.variants.length === 1 ? card.variants[0].chrtId : null;
  const withStock: FbsProductDiscovery["warehouses"] = [];
  for (const warehouse of warehouses) {
    if (!chrtId) {
      withStock.push({ ...warehouse, amount: null });
      continue;
    }
    try {
      withStock.push({ ...warehouse, amount: await getFbsStock(warehouse.id, chrtId) });
    } catch (error) {
      withStock.push({ ...warehouse, amount: null, error: errorMessage(error) });
    }
    await waitForFbsRateLimit();
  }
  return { card, warehouses: withStock };
}

async function loadProduct(productId: number): Promise<ProductRow | undefined> {
  return pgGet<ProductRow>(`SELECT * FROM fbs_stock_products WHERE id = ?`, [productId]);
}

async function processOrder(product: ProductRow, order: FbsWbOrder): Promise<"inserted" | "existing"> {
  if (Number(order.nmId) !== Number(product.nm_id) || Number(order.chrtId) !== Number(product.chrt_id)) {
    return "existing";
  }
  const orderId = Number(order.id);
  const warehouseId = Number(order.warehouseId);
  const createdAt = asDate(order.createdAt);
  if (!Number.isSafeInteger(orderId) || !Number.isSafeInteger(warehouseId) || createdAt.getTime() <= 0) {
    return "existing";
  }

  return withPgTransaction(async (client) => {
    const activeWarehouse = await client.query<{ enabled: boolean }>(`
      SELECT enabled FROM fbs_stock_warehouses
      WHERE product_id = $1 AND warehouse_id = $2
    `, [product.id, warehouseId]);
    const baselineAt = asDate(product.baseline_at);
    const state = createdAt < baselineAt
      ? "baseline"
      : activeWarehouse.rows[0]?.enabled
        ? "counted"
        : "external_warehouse";
    const inserted = await client.query<{ order_id: number }>(`
      INSERT INTO fbs_stock_orders (
        order_id, product_id, nm_id, chrt_id, warehouse_id, created_at_wb,
        accounting_state, counted_at, raw_json
      ) VALUES ($1, $2, $3, $4, $5, $6, $7,
        CASE WHEN $7 = 'counted' THEN CURRENT_TIMESTAMP ELSE NULL END, $8::jsonb)
      ON CONFLICT (order_id) DO NOTHING
      RETURNING order_id
    `, [orderId, product.id, product.nm_id, product.chrt_id, warehouseId, createdAt, state, JSON.stringify(order)]);
    if (inserted.rowCount === 0) return "existing";

    if (state === "counted") {
      const quantity = await client.query<{ physical_quantity: number }>(`
        UPDATE fbs_stock_products
        SET physical_quantity = GREATEST(physical_quantity - 1, 0), updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING physical_quantity
      `, [product.id]);
      await client.query(`
        UPDATE fbs_stock_warehouses
        SET target_quantity = GREATEST(target_quantity - 1, 0), updated_at = CURRENT_TIMESTAMP
        WHERE product_id = $1 AND warehouse_id = $2 AND enabled = TRUE
      `, [product.id, warehouseId]);
      await audit(client, {
        productId: product.id,
        orderId,
        action: "order_counted",
        warehouseFromId: warehouseId,
        quantity: 1,
        message: `Заказ учтён, доступно ${quantity.rows[0]?.physical_quantity ?? 0} шт.`,
      });
    } else {
      await audit(client, {
        productId: product.id,
        orderId,
        action: state,
        warehouseFromId: warehouseId,
        message: state === "baseline"
          ? "Существующий заказ зафиксирован в базовой точке без повторного списания"
          : "Заказ относится к складу вне управляемого пула",
      });
    }
    return "inserted";
  });
}

function shouldReleaseOrder(supplierStatus: string, wbStatus: string): boolean {
  return supplierStatus === "cancel" || wbStatus === "declined_by_client";
}

async function refreshOrderStatuses(productId: number, suppliedStatuses?: FbsWbOrderStatus[]): Promise<number> {
  const rows = await pgRows<{ order_id: number }>(`
    SELECT order_id
    FROM fbs_stock_orders
    WHERE product_id = ?
      AND accounting_state = 'counted'
      AND created_at_wb >= CURRENT_TIMESTAMP - INTERVAL '30 days'
    ORDER BY created_at_wb DESC
  `, [productId]);
  if (rows.length === 0) return 0;
  const orderIds = new Set(rows.map((row) => Number(row.order_id)));
  const statuses = suppliedStatuses
    ? suppliedStatuses.filter((status) => orderIds.has(Number(status.id)))
    : await getFbsOrderStatuses(Array.from(orderIds));
  let released = 0;
  for (const status of statuses) {
    const supplierStatus = String(status.supplierStatus || "");
    const wbStatus = String(status.wbStatus || "");
    await withPgTransaction(async (client) => {
      const current = await client.query<{
        accounting_state: string;
        product_id: number;
        warehouse_id: number;
      }>(`
        SELECT accounting_state, product_id, warehouse_id
        FROM fbs_stock_orders
        WHERE order_id = $1
        FOR UPDATE
      `, [status.id]);
      const order = current.rows[0];
      if (!order) return;
      await client.query(`
        UPDATE fbs_stock_orders
        SET supplier_status = $2, wb_status = $3, updated_at = CURRENT_TIMESTAMP
        WHERE order_id = $1
      `, [status.id, supplierStatus, wbStatus]);
      if (order.accounting_state !== "counted" || !shouldReleaseOrder(supplierStatus, wbStatus)) return;

      await client.query(`
        UPDATE fbs_stock_orders
        SET accounting_state = 'released', released_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE order_id = $1
      `, [status.id]);
      await client.query(`
        UPDATE fbs_stock_products
        SET physical_quantity = physical_quantity + 1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [order.product_id]);
      const restored = await client.query(`
        UPDATE fbs_stock_warehouses
        SET target_quantity = target_quantity + 1, updated_at = CURRENT_TIMESTAMP
        WHERE product_id = $1 AND warehouse_id = $2 AND enabled = TRUE
      `, [order.product_id, order.warehouse_id]);
      await audit(client, {
        productId: order.product_id,
        orderId: Number(status.id),
        action: "order_released",
        warehouseToId: restored.rowCount ? order.warehouse_id : null,
        quantity: 1,
        message: `Резерв освобождён по статусу ${supplierStatus || "-"}/${wbStatus || "-"}`,
      });
      released += 1;
    });
  }
  return released;
}

async function collectOrders(product: ProductRow): Promise<{ inserted: number; released: number; history: boolean }> {
  const now = new Date();
  const newOrders = await getNewFbsOrders();
  let history = false;
  let recoveryOrders: FbsWbOrder[] = [];
  const lastHistory = asDate(product.last_history_at);
  if (!product.last_history_at || now.getTime() - lastHistory.getTime() >= 10 * 60_000) {
    history = true;
    const baseline = asDate(product.baseline_at, now);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60_000);
    const overlap = product.last_history_at
      ? new Date(lastHistory.getTime() - 15 * 60_000)
      : baseline;
    recoveryOrders = await getFbsOrdersSince(new Date(Math.max(thirtyDaysAgo.getTime(), overlap.getTime())), now);
  }
  const unique = new Map<number, FbsWbOrder>();
  for (const order of [...newOrders, ...recoveryOrders]) unique.set(Number(order.id), order);
  let inserted = 0;
  for (const order of unique.values()) {
    if (await processOrder(product, order) === "inserted") inserted += 1;
  }
  const released = await refreshOrderStatuses(product.id);
  await withPgTransaction(async (client) => {
    await client.query(`
      UPDATE fbs_stock_products
      SET last_new_orders_at = CURRENT_TIMESTAMP,
          last_history_at = CASE WHEN $2 THEN CURRENT_TIMESTAMP ELSE last_history_at END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [product.id, history]);
  });
  return { inserted, released, history };
}

function needsHistoryRecovery(product: ProductRow, now: Date): boolean {
  return !product.last_history_at || now.getTime() - asDate(product.last_history_at).getTime() >= 10 * 60_000;
}

function historyRecoveryStart(product: ProductRow, now: Date): Date {
  const baseline = asDate(product.baseline_at, now);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60_000);
  const overlap = product.last_history_at
    ? new Date(asDate(product.last_history_at).getTime() - 15 * 60_000)
    : baseline;
  return new Date(Math.max(thirtyDaysAgo.getTime(), overlap.getTime()));
}

async function collectOrdersFromSharedFeed(
  product: ProductRow,
  newOrders: FbsWbOrder[],
  recoveryOrders: FbsWbOrder[],
  history: boolean,
  statuses?: FbsWbOrderStatus[],
): Promise<{ inserted: number; released: number; history: boolean }> {
  const unique = new Map<number, FbsWbOrder>();
  for (const order of [...newOrders, ...(history ? recoveryOrders : [])]) unique.set(Number(order.id), order);
  let inserted = 0;
  for (const order of unique.values()) {
    if (await processOrder(product, order) === "inserted") inserted += 1;
  }
  const released = await refreshOrderStatuses(product.id, statuses);
  await withPgTransaction(async (client) => {
    await client.query(`
      UPDATE fbs_stock_products
      SET last_new_orders_at = CURRENT_TIMESTAMP,
          last_history_at = CASE WHEN $2 THEN CURRENT_TIMESTAMP ELSE last_history_at END,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [product.id, history]);
  });
  return { inserted, released, history };
}

async function normalizeTargets(productId: number): Promise<Array<{ from: number; to: number; quantity: number }>> {
  return withPgTransaction(async (client) => {
    const productResult = await client.query<{ physical_quantity: number }>(`
      SELECT physical_quantity FROM fbs_stock_products WHERE id = $1 FOR UPDATE
    `, [productId]);
    if (!productResult.rows[0]) throw new Error("FBS-товар не найден");
    const result = await client.query<WarehouseRow>(`
      SELECT w.*,
        (SELECT COUNT(*)::int FROM fbs_stock_orders o
         WHERE o.product_id = w.product_id AND o.warehouse_id = w.warehouse_id
           AND o.accounting_state = 'counted'
           AND o.created_at_wb >= CURRENT_TIMESTAMP - INTERVAL '30 days') AS orders_30d
      FROM fbs_stock_warehouses w
      WHERE w.product_id = $1 AND w.enabled = TRUE
      ORDER BY w.warehouse_id
      FOR UPDATE OF w
    `, [productId]);
    const warehouses = result.rows;
    if (warehouses.length === 0) throw new Error("Не выбран ни один FBS-склад");
    const total = Number(productResult.rows[0].physical_quantity || 0);
    const allocation = allocateFbsStock(warehouses.map((row) => ({
      warehouseId: Number(row.warehouse_id),
      targetQuantity: Number(row.target_quantity || 0),
      orders30d: Number(row.orders_30d || 0),
    })), total);
    const targets = new Map(allocation.warehouses.map((row) => [row.warehouseId, row.targetQuantity]));
    const transfers = allocation.transfers;

    for (const row of warehouses) {
      await client.query(`
        UPDATE fbs_stock_warehouses
        SET target_quantity = $3, updated_at = CURRENT_TIMESTAMP
        WHERE product_id = $1 AND warehouse_id = $2
      `, [productId, row.warehouse_id, targets.get(Number(row.warehouse_id)) || 0]);
    }
    if (transfers.length > 0) {
      const transferredQuantity = transfers.reduce((sum, transfer) => sum + transfer.quantity, 0);
      await audit(client, {
        productId,
        action: "rebalance",
        quantity: transferredQuantity,
        message: `Перераспределено ${transferredQuantity} шт. по рейтингу заказов за 30 дней`,
        details: {
          transfers,
          ranking: warehouses.map((row) => ({
            warehouseId: Number(row.warehouse_id),
            warehouseName: row.warehouse_name,
            orders30d: Number(row.orders_30d || 0),
            previousQuantity: Number(row.target_quantity || 0),
            targetQuantity: targets.get(Number(row.warehouse_id)) || 0,
          })).sort((a, b) => b.orders30d - a.orders30d || a.warehouseId - b.warehouseId),
        },
      });
    }
    return transfers;
  });
}

async function readAndStoreActual(productId: number, chrtId: number): Promise<Array<WarehouseRow & { actual: number }>> {
  const liveWarehouses = await getFbsWarehouses();
  await disableWarehousesMissingFromWb(liveWarehouses, [productId]);
  const liveWarehouseIds = liveWarehouses.map((warehouse) => Number(warehouse.id));
  if (!liveWarehouseIds.length) return [];
  const rows = await pgRows<WarehouseRow>(`
    SELECT * FROM fbs_stock_warehouses
    WHERE product_id = ? AND warehouse_id=ANY(?::bigint[])
    ORDER BY warehouse_id
  `, [productId, liveWarehouseIds]);
  const result: Array<WarehouseRow & { actual: number }> = [];
  for (const row of rows) {
    try {
      const actual = await getFbsStock(Number(row.warehouse_id), chrtId);
      await withPgTransaction(async (client) => {
        await client.query(`
          UPDATE fbs_stock_warehouses
          SET confirmed_quantity = $3, last_checked_at = CURRENT_TIMESTAMP,
              last_error = NULL, updated_at = CURRENT_TIMESTAMP
          WHERE product_id = $1 AND warehouse_id = $2
        `, [productId, row.warehouse_id, actual]);
      });
      result.push({ ...row, actual });
    } catch (error) {
      const message = errorMessage(error);
      await withPgTransaction(async (client) => {
        await client.query(`
          UPDATE fbs_stock_warehouses SET last_error = $3, updated_at = CURRENT_TIMESTAMP
          WHERE product_id = $1 AND warehouse_id = $2
        `, [productId, row.warehouse_id, message]);
      });
      throw error;
    }
    await waitForFbsRateLimit();
  }
  return result;
}

async function readAndStoreOrganizationActual(products: ProductRow[]): Promise<{
  rowsByProduct: Map<number, Array<WarehouseRow & { actual: number }>>;
  errorsByProduct: Map<number, Error>;
}> {
  const productIds = products.map((product) => product.id);
  if (!productIds.length) return { rowsByProduct: new Map(), errorsByProduct: new Map() };
  const liveWarehouses = await getFbsWarehouses();
  await disableWarehousesMissingFromWb(liveWarehouses, productIds);
  const liveWarehouseIds = liveWarehouses.map((warehouse) => Number(warehouse.id));
  if (!liveWarehouseIds.length) return { rowsByProduct: new Map(), errorsByProduct: new Map() };
  const rows = await pgRows<WarehouseRow>(`
    SELECT * FROM fbs_stock_warehouses
    WHERE product_id = ANY(?::bigint[])
      AND warehouse_id = ANY(?::bigint[])
    ORDER BY warehouse_id, product_id
  `, [productIds, liveWarehouseIds]);
  const productById = new Map(products.map((product) => [product.id, product]));
  const byWarehouse = new Map<number, WarehouseRow[]>();
  for (const row of rows) {
    const warehouseId = Number(row.warehouse_id);
    const group = byWarehouse.get(warehouseId) || [];
    group.push(row);
    byWarehouse.set(warehouseId, group);
  }
  const rowsByProduct = new Map<number, Array<WarehouseRow & { actual: number }>>();
  const errorsByProduct = new Map<number, Error>();
  const confirmed: Array<{ productId: number; warehouseId: number; actual: number }> = [];
  const failed: Array<{ productId: number; warehouseId: number; message: string }> = [];

  for (const [warehouseId, warehouseRows] of byWarehouse) {
    const chrtIds = warehouseRows
      .map((row) => productById.get(Number(row.product_id))?.chrt_id || 0)
      .filter((id) => id > 0);
    try {
      const stocks = await getFbsStocks(warehouseId, chrtIds);
      for (const row of warehouseRows) {
        const product = productById.get(Number(row.product_id));
        if (!product) continue;
        const actual = stocks.get(Number(product.chrt_id)) || 0;
        const productRows = rowsByProduct.get(product.id) || [];
        productRows.push({ ...row, actual });
        rowsByProduct.set(product.id, productRows);
        confirmed.push({ productId: product.id, warehouseId, actual });
      }
    } catch (error) {
      if (isMissingFbsWarehouse(error)) {
        await disableWarehousesMissingFromWb(
          liveWarehouses.filter((warehouse) => Number(warehouse.id) !== warehouseId),
          warehouseRows.map((row) => Number(row.product_id)),
        );
        continue;
      }
      // A transient WB failure or one invalid variant must not take every
      // managed product down with the warehouse batch. Fall back to the old
      // isolated reads only on the exceptional path.
      for (const row of warehouseRows) {
        const productId = Number(row.product_id);
        const product = productById.get(productId);
        if (!product) continue;
        try {
          const actual = await getFbsStock(warehouseId, Number(product.chrt_id));
          const productRows = rowsByProduct.get(productId) || [];
          productRows.push({ ...row, actual });
          rowsByProduct.set(productId, productRows);
          confirmed.push({ productId, warehouseId, actual });
        } catch (isolatedError) {
          const message = errorMessage(isolatedError || error);
          errorsByProduct.set(productId, isolatedError instanceof Error ? isolatedError : new Error(message));
          failed.push({ productId, warehouseId, message });
        }
        await waitForFbsRateLimit();
      }
    }
    await waitForFbsRateLimit();
  }

  await withPgTransaction(async (client) => {
    if (confirmed.length) {
      await client.query(`
        UPDATE fbs_stock_warehouses w SET
          confirmed_quantity=v.actual,
          last_checked_at=CURRENT_TIMESTAMP,
          last_error=NULL,
          updated_at=CURRENT_TIMESTAMP
        FROM unnest($1::bigint[], $2::bigint[], $3::int[]) AS v(product_id, warehouse_id, actual)
        WHERE w.product_id=v.product_id AND w.warehouse_id=v.warehouse_id
      `, [
        confirmed.map((row) => row.productId),
        confirmed.map((row) => row.warehouseId),
        confirmed.map((row) => row.actual),
      ]);
    }
    if (failed.length) {
      await client.query(`
        UPDATE fbs_stock_warehouses w SET
          last_error=v.message,
          updated_at=CURRENT_TIMESTAMP
        FROM unnest($1::bigint[], $2::bigint[], $3::text[]) AS v(product_id, warehouse_id, message)
        WHERE w.product_id=v.product_id AND w.warehouse_id=v.warehouse_id
      `, [
        failed.map((row) => row.productId),
        failed.map((row) => row.warehouseId),
        failed.map((row) => row.message),
      ]);
    }
  });
  for (const productRows of rowsByProduct.values()) {
    productRows.sort((a, b) => Number(a.warehouse_id) - Number(b.warehouse_id));
  }
  return { rowsByProduct, errorsByProduct };
}

async function writeAndVerify(productId: number, warehouse: WarehouseRow & { actual: number }, chrtId: number): Promise<void> {
  const target = warehouse.enabled ? Number(warehouse.target_quantity) : 0;
  await putFbsStock(Number(warehouse.warehouse_id), chrtId, target);
  let confirmed = -1;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await waitForFbsRateLimit();
    confirmed = await getFbsStock(Number(warehouse.warehouse_id), chrtId);
    if (confirmed === target) break;
    await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
  }
  const matches = confirmed === target;
  await withPgTransaction(async (client) => {
    await client.query(`
      UPDATE fbs_stock_warehouses
      SET confirmed_quantity = $3, last_checked_at = CURRENT_TIMESTAMP,
          last_error = $4, updated_at = CURRENT_TIMESTAMP
      WHERE product_id = $1 AND warehouse_id = $2
    `, [productId, warehouse.warehouse_id, Math.max(0, confirmed), matches ? null : `WB вернул ${confirmed}, ожидалось ${target}`]);
    await audit(client, {
      productId,
      action: target < warehouse.actual ? "stock_decrease" : "stock_increase",
      status: matches ? "ok" : "error",
      warehouseFromId: target < warehouse.actual ? warehouse.warehouse_id : null,
      warehouseToId: target > warehouse.actual ? warehouse.warehouse_id : null,
      quantity: Math.abs(target - warehouse.actual),
      message: `${warehouse.warehouse_name}: ${warehouse.actual} → ${target}${matches ? "" : `, проверка показала ${confirmed}`}`,
    });
  });
  if (!matches) throw new Error(`${warehouse.warehouse_name}: WB не подтвердил остаток ${target}`);
}

async function applyTargets(
  product: ProductRow,
  suppliedActualRows?: Array<WarehouseRow & { actual: number }>,
): Promise<{ changed: number; published: number }> {
  const actualRows = suppliedActualRows || await readAndStoreActual(product.id, Number(product.chrt_id));
  const reductions = actualRows.filter((row) => (row.enabled ? row.target_quantity : 0) < row.actual);
  const increases = actualRows.filter((row) => (row.enabled ? row.target_quantity : 0) > row.actual);
  for (const row of reductions) await writeAndVerify(product.id, row, Number(product.chrt_id));
  for (const row of increases) await writeAndVerify(product.id, row, Number(product.chrt_id));
  const published = actualRows.reduce((sum, row) => sum + (row.enabled ? Number(row.target_quantity) : 0), 0);
  return { changed: reductions.length + increases.length, published };
}

async function claimProduct(productId: number, token: string): Promise<boolean> {
  const row = await pgGet<{ id: number }>(`
    UPDATE fbs_stock_products
    SET sync_lock_token = ?, sync_lock_until = CURRENT_TIMESTAMP + INTERVAL '10 minutes',
        last_sync_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND enabled = TRUE
      AND (sync_lock_until IS NULL OR sync_lock_until < CURRENT_TIMESTAMP OR sync_lock_token = ?)
    RETURNING id
  `, [token, productId, token]);
  return Boolean(row);
}

async function releaseProduct(productId: number, token: string, error?: unknown, recordSuccess = false): Promise<void> {
  const message = error ? errorMessage(error).slice(0, 2000) : null;
  await withPgTransaction(async (client) => {
    await client.query(`
      UPDATE fbs_stock_products
      SET sync_lock_token = NULL, sync_lock_until = NULL,
          last_success_at = CASE WHEN $3::text IS NULL THEN CURRENT_TIMESTAMP ELSE last_success_at END,
          last_error = $3, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND sync_lock_token = $2
    `, [productId, token, message]);
    if (error || recordSuccess) {
      await audit(client, {
        productId,
        action: "sync",
        status: error ? "error" : "ok",
        message: error ? message || "Ошибка синхронизации" : "Синхронизация завершена с изменениями",
      });
    }
  });
}

export async function syncFbsProduct(productId: number): Promise<Record<string, unknown>> {
  const token = crypto.randomUUID();
  if (!(await claimProduct(productId, token))) return { productId, skipped: true, reason: "locked_or_disabled" };
  try {
    let product = await loadProduct(productId);
    if (!product) throw new Error("FBS-товар не найден");
    const liveWarehouses = await getFbsWarehouses();
    await disableWarehousesMissingFromWb(liveWarehouses, [product.id]);
    const orders = await collectOrders(product);
    await normalizeTargets(productId);
    product = await loadProduct(productId);
    if (!product) throw new Error("FBS-товар не найден после расчёта");
    const stock = await applyTargets(product);
    await releaseProduct(productId, token, undefined, orders.inserted > 0 || orders.released > 0 || stock.changed > 0);
    return { productId, ok: true, orders, stock };
  } catch (error) {
    await releaseProduct(productId, token, error).catch(() => undefined);
    throw error;
  }
}

export async function syncFbsOrganization(): Promise<Array<Record<string, unknown>>> {
  const products = await pgRows<ProductRow>(`
    SELECT * FROM fbs_stock_products WHERE enabled = TRUE ORDER BY id
  `);
  if (!products.length) return [];
  const now = new Date();
  const tokenByProduct = new Map<number, string>();
  const resultsByProduct = new Map<number, Record<string, unknown>>();
  for (const product of products) {
    const token = crypto.randomUUID();
    if (await claimProduct(product.id, token)) tokenByProduct.set(product.id, token);
    else resultsByProduct.set(product.id, { productId: product.id, skipped: true, reason: "locked_or_disabled" });
  }
  const claimed = products.filter((product) => tokenByProduct.has(product.id));
  if (!claimed.length) return products.map((product) => resultsByProduct.get(product.id)!);

  let newOrders: FbsWbOrder[] = [];
  let recoveryOrders: FbsWbOrder[] = [];
  const statusesByProduct = new Map<number, FbsWbOrderStatus[]>();
  try {
    const liveWarehouses = await getFbsWarehouses();
    await disableWarehousesMissingFromWb(liveWarehouses, claimed.map((product) => product.id));
    newOrders = await getNewFbsOrders();
    const due = claimed.filter((product) => needsHistoryRecovery(product, now));
    if (due.length) {
      const historyFrom = new Date(Math.min(...due.map((product) => historyRecoveryStart(product, now).getTime())));
      recoveryOrders = await getFbsOrdersSince(historyFrom, now);
    }
    const countedOrders = await pgRows<{ product_id: number; order_id: number }>(`
      SELECT product_id,order_id FROM fbs_stock_orders
      WHERE product_id=ANY(?::bigint[])
        AND accounting_state='counted'
        AND created_at_wb>=CURRENT_TIMESTAMP-INTERVAL '30 days'
    `, [claimed.map((product) => product.id)]);
    const statuses = countedOrders.length
      ? await getFbsOrderStatuses(countedOrders.map((row) => Number(row.order_id)))
      : [];
    const productIdByOrderId = new Map(countedOrders.map((row) => [Number(row.order_id), Number(row.product_id)]));
    for (const status of statuses) {
      const productId = productIdByOrderId.get(Number(status.id));
      if (!productId) continue;
      const productStatuses = statusesByProduct.get(productId) || [];
      productStatuses.push(status);
      statusesByProduct.set(productId, productStatuses);
    }
  } catch (error) {
    for (const product of claimed) {
      const token = tokenByProduct.get(product.id)!;
      await releaseProduct(product.id, token, error).catch(() => undefined);
      resultsByProduct.set(product.id, { productId: product.id, ok: false, error: errorMessage(error) });
    }
    return products.map((product) => resultsByProduct.get(product.id)!);
  }

  const prepared: Array<{ product: ProductRow; orders: { inserted: number; released: number; history: boolean } }> = [];
  for (const product of claimed) {
    try {
      const productKey = `${product.nm_id}:${product.chrt_id}`;
      const productNewOrders = newOrders.filter((order) => `${Number(order.nmId)}:${Number(order.chrtId)}` === productKey);
      const productRecoveryOrders = recoveryOrders.filter((order) => `${Number(order.nmId)}:${Number(order.chrtId)}` === productKey);
      const orders = await collectOrdersFromSharedFeed(
        product,
        productNewOrders,
        productRecoveryOrders,
        needsHistoryRecovery(product, now),
        statusesByProduct.get(product.id) || [],
      );
      await normalizeTargets(product.id);
      const refreshed = await loadProduct(product.id);
      if (!refreshed) throw new Error("FBS-товар не найден после расчёта");
      prepared.push({ product: refreshed, orders });
    } catch (error) {
      const token = tokenByProduct.get(product.id)!;
      await releaseProduct(product.id, token, error).catch(() => undefined);
      resultsByProduct.set(product.id, { productId: product.id, ok: false, error: errorMessage(error) });
    }
  }

  const actual = await readAndStoreOrganizationActual(prepared.map((item) => item.product));
  for (const item of prepared) {
    const productId = item.product.id;
    const token = tokenByProduct.get(productId)!;
    try {
      const readError = actual.errorsByProduct.get(productId);
      if (readError) throw readError;
      const productRows = actual.rowsByProduct.get(productId) || [];
      const stock = await applyTargets(item.product, productRows);
      await releaseProduct(productId, token, undefined, item.orders.inserted > 0 || item.orders.released > 0 || stock.changed > 0);
      resultsByProduct.set(productId, { productId, ok: true, orders: item.orders, stock });
    } catch (error) {
      await releaseProduct(productId, token, error).catch(() => undefined);
      resultsByProduct.set(productId, { productId, ok: false, error: errorMessage(error) });
    }
  }
  return products.map((product) => resultsByProduct.get(product.id) || { productId: product.id, ok: false, error: "Нет результата синхронизации" });
}

export async function configureFbsProduct(input: ConfigureFbsProductInput): Promise<ProductRow> {
  const nmId = Math.trunc(input.nmId);
  const chrtId = Math.trunc(input.chrtId);
  const physicalQuantity = Math.trunc(input.physicalQuantity);
  const warehouseIds = Array.from(new Set(input.warehouseIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0)));
  if (!Number.isSafeInteger(nmId) || nmId <= 0) throw new Error("Некорректный артикул WB");
  if (!Number.isSafeInteger(chrtId) || chrtId <= 0) throw new Error("Некорректный chrtId");
  if (!Number.isSafeInteger(physicalQuantity) || physicalQuantity < 0 || physicalQuantity > 100_000) {
    throw new Error("Общий остаток должен быть от 0 до 100 000");
  }
  if (warehouseIds.length === 0) throw new Error("Выберите хотя бы один склад");

  const [card, liveWarehouses] = await Promise.all([getFbsCardByNmId(nmId), getFbsWarehouses()]);
  const variant = card.variants.find((item) => item.chrtId === chrtId);
  if (!variant) throw new Error(`chrtId ${chrtId} не принадлежит карточке ${nmId}`);
  const liveById = new Map(liveWarehouses.map((warehouse) => [warehouse.id, warehouse]));
  for (const warehouseId of warehouseIds) {
    if (!liveById.has(warehouseId)) throw new Error(`Склад ${warehouseId} не найден в кабинете WB`);
  }
  const baselineAt = new Date();
  const productId = await withPgTransaction(async (client) => {
    const existing = await client.query<{ id: number; enabled: boolean; sync_lock_until: string | null }>(`
      SELECT id, enabled, sync_lock_until
      FROM fbs_stock_products
      WHERE nm_id = $1 AND chrt_id = $2
      FOR UPDATE
    `, [nmId, chrtId]);
    const previous = existing.rows[0];
    if (previous?.sync_lock_until && asDate(previous.sync_lock_until).getTime() > Date.now()) {
      throw new Error("Сейчас выполняется синхронизация. Повторите изменение через минуту");
    }
    const saved = await client.query<{ id: number }>(`
      INSERT INTO fbs_stock_products (
        nm_id, chrt_id, vendor_code, title, photo_url, size_name, physical_quantity,
        enabled, baseline_at, last_error, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE, $8, NULL, CURRENT_TIMESTAMP)
      ON CONFLICT (nm_id, chrt_id) DO UPDATE SET
        vendor_code = EXCLUDED.vendor_code,
        title = EXCLUDED.title,
        photo_url = EXCLUDED.photo_url,
        size_name = EXCLUDED.size_name,
        physical_quantity = EXCLUDED.physical_quantity,
        enabled = FALSE,
        baseline_at = CASE WHEN fbs_stock_products.enabled THEN fbs_stock_products.baseline_at ELSE EXCLUDED.baseline_at END,
        last_error = NULL,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id
    `, [nmId, chrtId, card.vendorCode, card.title, card.photoUrl, variant.sizeName, physicalQuantity, baselineAt]);
    const id = Number(saved.rows[0].id);
    await client.query(`
      UPDATE fbs_stock_warehouses
      SET enabled = FALSE, target_quantity = 0, updated_at = CURRENT_TIMESTAMP
      WHERE product_id = $1 AND NOT (warehouse_id = ANY($2::bigint[]))
    `, [id, warehouseIds]);
    for (const warehouseId of warehouseIds) {
      const warehouse = liveById.get(warehouseId)!;
      await client.query(`
        INSERT INTO fbs_stock_warehouses (product_id, warehouse_id, warehouse_name, enabled)
        VALUES ($1, $2, $3, TRUE)
        ON CONFLICT (product_id, warehouse_id) DO UPDATE SET
          warehouse_name = EXCLUDED.warehouse_name,
          enabled = TRUE,
          updated_at = CURRENT_TIMESTAMP
      `, [id, warehouseId, warehouse.name]);
    }
    await audit(client, {
      productId: id,
      action: previous ? "configuration_updated" : "configuration_created",
      quantity: physicalQuantity,
      message: `Управление включено для ${warehouseIds.length} складов, общий остаток ${physicalQuantity}`,
      details: { nmId, chrtId, warehouseIds, baselineAt: baselineAt.toISOString() },
    });
    return id;
  });
  await normalizeTargets(productId);
  await withPgTransaction(async (client) => {
    await client.query(`
      UPDATE fbs_stock_products
      SET enabled = TRUE, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [productId]);
  });
  await syncFbsProduct(productId);
  const product = await loadProduct(productId);
  if (!product) throw new Error("Не удалось прочитать сохранённую конфигурацию");
  return product;
}

export async function pauseFbsProduct(productId: number): Promise<void> {
  await withPgTransaction(async (client) => {
    const result = await client.query(`
      UPDATE fbs_stock_products
      SET enabled = FALSE, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
        AND (sync_lock_until IS NULL OR sync_lock_until < CURRENT_TIMESTAMP)
    `, [productId]);
    if (result.rowCount === 0) {
      const exists = await client.query(`SELECT 1 FROM fbs_stock_products WHERE id = $1`, [productId]);
      if (exists.rowCount === 0) throw new Error("FBS-товар не найден");
      throw new Error("Сейчас выполняется синхронизация. Остановку можно повторить через минуту");
    }
    await audit(client, {
      productId,
      action: "paused",
      message: "Автоматическое управление остановлено; опубликованные остатки не изменялись",
    });
  });
}

export async function zeroFbsProductStocks(
  productId: number,
  confirmationNmId: number,
): Promise<{ productId: number; warehouseCount: number }> {
  const token = crypto.randomUUID();
  const product = await withPgTransaction(async (client) => {
    const claimed = await client.query<ProductRow>(`
      UPDATE fbs_stock_products
      SET enabled = FALSE,
          physical_quantity = 0,
          sync_lock_token = $2,
          sync_lock_until = CURRENT_TIMESTAMP + INTERVAL '10 minutes',
          last_error = NULL,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
        AND (sync_lock_until IS NULL OR sync_lock_until < CURRENT_TIMESTAMP)
      RETURNING *
    `, [productId, token]);
    if (claimed.rowCount === 0) {
      const exists = await client.query(`SELECT 1 FROM fbs_stock_products WHERE id = $1`, [productId]);
      if (exists.rowCount === 0) throw new Error("FBS-товар не найден");
      throw new Error("Сейчас выполняется синхронизация. Повторите обнуление через минуту");
    }
    const row = claimed.rows[0];
    if (Number(row.nm_id) !== confirmationNmId) {
      throw new Error("Подтверждение обнуления не совпадает с артикулом WB");
    }
    await client.query(`
      UPDATE fbs_stock_warehouses
      SET target_quantity = 0, updated_at = CURRENT_TIMESTAMP
      WHERE product_id = $1
    `, [productId]);
    await audit(client, {
      productId,
      action: "stock_zero_started",
      status: "pending",
      message: `Запущено обнуление артикула WB ${row.nm_id} на всех FBS-складах`,
    });
    return row;
  });

  try {
    const liveWarehouses = await getFbsWarehouses();
    await disableWarehousesMissingFromWb(liveWarehouses, [productId]);
    const warehouses = liveWarehouses
      .map((warehouse) => ({ id: Number(warehouse.id), name: warehouse.name }))
      .filter((warehouse) => Number.isSafeInteger(warehouse.id) && warehouse.id > 0)
      .sort((a, b) => a.id - b.id);

    const writeErrors = new Map<number, string>();
    for (const warehouse of warehouses) {
      try {
        await putFbsStock(warehouse.id, Number(product.chrt_id), 0);
      } catch (error) {
        writeErrors.set(warehouse.id, errorMessage(error));
      }
      await waitForFbsRateLimit();
    }

    const results: Array<{ id: number; name: string; actual: number | null; error: string | null }> = [];
    for (const warehouse of warehouses) {
      let actual: number | null = null;
      let readError = "";
      for (let attempt = 0; attempt < 5; attempt += 1) {
        try {
          actual = await getFbsStock(warehouse.id, Number(product.chrt_id));
          readError = "";
          if (actual === 0) break;
        } catch (error) {
          readError = errorMessage(error);
        }
        await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
      }
      const error = actual === 0
        ? null
        : readError || writeErrors.get(warehouse.id) || `WB вернул остаток ${actual ?? "неизвестно"}, ожидался 0`;
      results.push({ ...warehouse, actual, error });
      await waitForFbsRateLimit();
    }

    const failed = results.filter((result) => result.actual !== 0);
    await withPgTransaction(async (client) => {
      for (const result of results) {
        await client.query(`
          INSERT INTO fbs_stock_warehouses (
            product_id, warehouse_id, warehouse_name, enabled,
            target_quantity, confirmed_quantity, last_checked_at, last_error
          ) VALUES ($1, $2, $3, FALSE, 0, $4, CURRENT_TIMESTAMP, $5)
          ON CONFLICT (product_id, warehouse_id) DO UPDATE SET
            warehouse_name = EXCLUDED.warehouse_name,
            target_quantity = 0,
            confirmed_quantity = EXCLUDED.confirmed_quantity,
            last_checked_at = CURRENT_TIMESTAMP,
            last_error = EXCLUDED.last_error,
            updated_at = CURRENT_TIMESTAMP
        `, [productId, result.id, result.name, result.actual, result.error]);
      }
      const error = failed.length > 0
        ? `Не подтверждён ноль: ${failed.map((item) => item.name).join(", ")}`
        : null;
      await client.query(`
        UPDATE fbs_stock_products
        SET enabled = FALSE,
            physical_quantity = 0,
            sync_lock_token = NULL,
            sync_lock_until = NULL,
            last_success_at = CASE WHEN $3::text IS NULL THEN CURRENT_TIMESTAMP ELSE last_success_at END,
            last_error = $3,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND sync_lock_token = $2
      `, [productId, token, error]);
      await audit(client, {
        productId,
        action: "stock_zeroed",
        status: failed.length > 0 ? "error" : "ok",
        quantity: warehouses.length,
        message: failed.length > 0
          ? `Обнуление подтверждено не на всех складах: ${failed.map((item) => item.name).join(", ")}`
          : `WB подтвердил нулевой остаток на ${warehouses.length} складах; автоуправление остановлено`,
        details: { warehouses: results },
      });
    });
    if (failed.length > 0) {
      throw new Error(`WB не подтвердил обнуление на складах: ${failed.map((item) => item.name).join(", ")}. Автоуправление остановлено; повторите обнуление.`);
    }
    return { productId, warehouseCount: warehouses.length };
  } catch (error) {
    const message = errorMessage(error).slice(0, 2000);
    await withPgTransaction(async (client) => {
      const released = await client.query(`
        UPDATE fbs_stock_products
        SET enabled = FALSE,
            physical_quantity = 0,
            sync_lock_token = NULL,
            sync_lock_until = NULL,
            last_error = $3,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND sync_lock_token = $2
      `, [productId, token, message]);
      if ((released.rowCount || 0) > 0) {
        await audit(client, {
          productId,
          action: "stock_zeroed",
          status: "error",
          message,
        });
      }
    }).catch(() => undefined);
    throw error;
  }
}

export async function deleteFbsProduct(
  productId: number,
  confirmationNmId: number,
): Promise<{ productId: number; nmId: number; warehouseCount: number }> {
  const zeroed = await zeroFbsProductStocks(productId, confirmationNmId);
  return withPgTransaction(async (client) => {
    const product = await client.query<{ nm_id: number; title: string }>(`
      SELECT nm_id,title FROM fbs_stock_products WHERE id=$1 FOR UPDATE
    `, [productId]);
    const row = product.rows[0];
    if (!row) throw new Error("FBS-товар не найден");
    if (Number(row.nm_id) !== confirmationNmId) throw new Error("Подтверждение удаления не совпадает с артикулом WB");
    await audit(client, {
      productId,
      action: "configuration_deleted",
      message: `Товар WB ${row.nm_id} удалён из управляемых после подтверждённого обнуления действующих складов`,
      details: { nmId: Number(row.nm_id), title: row.title, warehouseCount: zeroed.warehouseCount },
    });
    await client.query(`DELETE FROM fbs_stock_orders WHERE product_id=$1`, [productId]);
    await client.query(`DELETE FROM fbs_stock_warehouses WHERE product_id=$1`, [productId]);
    await client.query(`DELETE FROM fbs_stock_products WHERE id=$1`, [productId]);
    return { productId, nmId: Number(row.nm_id), warehouseCount: zeroed.warehouseCount };
  });
}

export async function getFbsStockSnapshot(): Promise<Record<string, unknown>> {
  const products = await pgRows<ProductRow & { published_quantity: number; warehouse_count: number; mismatch_count: number }>(`
    SELECT p.*,
      COALESCE(SUM(CASE WHEN w.enabled THEN w.target_quantity ELSE 0 END), 0)::int AS published_quantity,
      COUNT(*) FILTER (WHERE w.enabled)::int AS warehouse_count,
      COUNT(*) FILTER (WHERE w.enabled AND w.confirmed_quantity IS DISTINCT FROM w.target_quantity)::int AS mismatch_count
    FROM fbs_stock_products p
    LEFT JOIN fbs_stock_warehouses w ON w.product_id = p.id
    GROUP BY p.id
    ORDER BY p.enabled DESC, p.updated_at DESC
  `);
  const warehouses = await pgRows<WarehouseRow & { orders_30d: number }>(`
    SELECT w.*,
      (SELECT COUNT(*)::int FROM fbs_stock_orders o
       WHERE o.product_id = w.product_id AND o.warehouse_id = w.warehouse_id
         AND o.accounting_state = 'counted'
         AND o.created_at_wb >= CURRENT_TIMESTAMP - INTERVAL '30 days') AS orders_30d
    FROM fbs_stock_warehouses w
    ORDER BY w.product_id, w.enabled DESC, w.warehouse_name
  `);
  const auditRows = await pgRows(`
    SELECT id, product_id, order_id, action, status, warehouse_from_id,
      warehouse_to_id, quantity, message, created_at
    FROM fbs_stock_audit
    ORDER BY created_at DESC
    LIMIT 100
  `);
  return { products, warehouses, audit: auditRows };
}
