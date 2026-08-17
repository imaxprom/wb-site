import crypto from "node:crypto";
import type { PoolClient } from "pg";
import {
  normalizeFbsDataMatrix,
  parseFbsDataMatrix,
  sameFbsDataMatrixIdentity,
} from "@/lib/fbs-datamatrix";
import {
  getFbsEffectiveRequiredMeta,
  getFbsLiveAvailableMeta,
  getFbsLiveMetaState,
  getFbsReviewOptionalMeta,
  getFbsSafeMetaDecisions,
  hasFbsOperatorMetadata,
  isFbsLiveMetaFilled,
} from "@/lib/fbs-metadata";
import { getFbsMarkingPolicy } from "@/lib/fbs-marking-policy";
import type { FbsMarkingPolicy } from "@/lib/fbs-metadata";
import { getActiveOrganizationId } from "@/lib/organization-context";
import { pgRows, withPgTransaction } from "@/lib/postgres";
import { getWbImageUrl } from "@/lib/wb-image";
import {
  fbsLabelText,
  fbsStickerNumber,
  fbsStickerScanVariants,
  fbsStoredStickerVariants,
} from "@/lib/fbs-label";
import {
  addFbsOrdersToSupply,
  addFbsSupplyBoxes,
  cancelFbsOrder,
  createFbsPass,
  createFbsSupply,
  deleteFbsSupplyBoxes,
  deleteFbsOrderMeta,
  deliverFbsSupply,
  getFbsCardsByNmIds,
  getFbsOrderMeta,
  getFbsOrderStatuses,
  getFbsOrderStickers,
  getFbsOrdersSince,
  getFbsPassOffices,
  getFbsPasses,
  getFbsReshipmentOrders,
  getFbsSupplies,
  getFbsSupplyBoxes,
  getFbsSupplyOrderIds,
  getFbsWarehouses,
  getNewFbsOrders,
  putFbsOrderMeta,
  FbsWbApiError,
  type FbsMetaType,
  type FbsPass,
  type FbsWbMetaDetail,
  type FbsWbOrderMeta,
  type FbsWbOrder,
} from "@/lib/fbs-wb-api";

const META_TYPES = new Set<FbsMetaType>([
  "sgtin", "uin", "imei", "gtin", "expiration", "customsDeclaration",
]);
type OrderRow = {
  order_id: number;
  supply_id: string | null;
  warehouse_id: number | null;
  nm_id: number;
  chrt_id: number;
  vendor_code: string;
  product_name: string;
  size_name: string;
  photo_url: string;
  skus: string[];
  required_meta: string[];
  optional_meta: string[];
  supplier_status: string;
  wb_status: string;
  picked_at: string | null;
  sticker_printed_at: string | null;
  sticker_barcode: string;
  packed_at: string | null;
  metadata_decisions: FbsWbMetaDetail[];
  metadata_checked_at: string | null;
  optional_meta_reviewed_at: string | null;
  reshipment_required: boolean;
  created_at_wb: string | null;
  raw_json: Record<string, unknown>;
};

type MarkingQueueRow = {
  queue_id: number;
  scan_id: number;
  order_id: number;
  supply_id: string | null;
  value_hash: string;
  value_payload: string;
  status: "queued" | "sending" | "sent" | "retry" | "verified" | "error";
  attempts: number;
  available_at: string;
  last_error: string;
  updated_at: string;
};

export type FbsMarkingQueueStatus = {
  order_id: number;
  metadata_decisions: FbsWbMetaDetail[];
  queue_status: MarkingQueueRow["status"] | null;
  message: string;
  updated_at: string | null;
};

const markingQueueRuns = new Map<number, Promise<void>>();
const MAX_FBS_SGTIN_VERIFICATION_ATTEMPTS = 3;
const FBS_SGTIN_REUPLOAD_DELAY_SECONDS = 2;
const FBS_SGTIN_RESET_RETRY_SECONDS = 15;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function integer(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function jsonArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function fbsOrderIsB2b(order: OrderRow): boolean {
  const options = order.raw_json?.options as { isB2B?: boolean; isB2b?: boolean } | undefined;
  return Boolean(options?.isB2B ?? options?.isB2b);
}

function fbsOrderAllowsPickupPoint(order: OrderRow): boolean {
  return order.raw_json?.isPickupPointShipmentAllowed === true;
}

function orderSupplyId(order: FbsWbOrder): string {
  return text(order.supplyId || order.supplyID);
}

async function event(
  client: PoolClient,
  action: string,
  input: { orderId?: number; supplyId?: string; status?: string; message?: string; details?: unknown } = {},
) {
  await client.query(`
    INSERT INTO fbs_fulfillment_events (order_id, supply_id, action, status, message, details_json)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb)
  `, [
    input.orderId || null,
    input.supplyId || null,
    action,
    input.status || "ok",
    input.message || "",
    JSON.stringify(input.details || {}),
  ]);
}

export async function syncFbsFulfillment(): Promise<{ orders: number; newOrders: number; supplies: number; reshipments: number }> {
  const now = new Date();
  const syncState = (await pgRows<{ last_sync_at: string | null; last_full_at: string | null }>(`
    SELECT
      MAX(created_at) FILTER (WHERE action='sync') AS last_sync_at,
      MAX(created_at) FILTER (
        WHERE action='sync' AND COALESCE(details_json->>'fullHistory','false')='true'
      ) AS last_full_at
    FROM fbs_fulfillment_events
  `))[0];
  const lastSyncAt = syncState?.last_sync_at ? new Date(syncState.last_sync_at) : null;
  const lastFullAt = syncState?.last_full_at ? new Date(syncState.last_full_at) : null;
  const fullHistory = !lastSyncAt || !lastFullAt || now.getTime() - lastFullAt.getTime() >= 24 * 60 * 60_000;
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60_000);
  const since = fullHistory
    ? thirtyDaysAgo
    : new Date(Math.max(thirtyDaysAgo.getTime(), lastSyncAt.getTime() - 15 * 60_000));
  const [newOrders, historyOrders, supplies, reshipments, sellerWarehouses] = await Promise.all([
    getNewFbsOrders(),
    getFbsOrdersSince(since, now),
    getFbsSupplies(),
    getFbsReshipmentOrders(),
    getFbsWarehouses().catch(() => []),
  ]);
  const openSupplyMemberships = new Map<string, number[]>();
  const openSupplyMembershipErrors: Array<{ supplyId: string; error: string }> = [];
  for (const supply of supplies.filter((row) => !row.done)) {
    try {
      openSupplyMemberships.set(supply.id, await getFbsSupplyOrderIds(supply.id));
    } catch (error) {
      openSupplyMembershipErrors.push({
        supplyId: supply.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const openSupplyOrderIds = Array.from(new Set(Array.from(openSupplyMemberships.values()).flat()));
  const unique = new Map<number, FbsWbOrder>();
  for (const order of [...historyOrders, ...newOrders]) {
    const id = integer(order.id);
    if (id) unique.set(id, order);
  }
  const [activeLocalOrderIds, knownOpenSupplyOrderIds] = await Promise.all([
    pgRows<{ order_id: number }>(`
      SELECT order_id FROM fbs_fulfillment_orders
      WHERE supplier_status IN ('new','confirm') OR reshipment_required=TRUE
    `),
    openSupplyOrderIds.length
      ? pgRows<{ order_id: number }>(`SELECT order_id FROM fbs_fulfillment_orders WHERE order_id=ANY(?::bigint[])`, [openSupplyOrderIds])
      : Promise.resolve([]),
  ]);
  const knownOpenIds = new Set(knownOpenSupplyOrderIds.map((row) => Number(row.order_id)));
  const missingOpenIds = new Set(openSupplyOrderIds.filter((orderId) => !knownOpenIds.has(orderId) && !unique.has(orderId)));
  if (missingOpenIds.size && !fullHistory) {
    const recoveryOrders = await getFbsOrdersSince(thirtyDaysAgo, now);
    for (const order of recoveryOrders) {
      const id = integer(order.id);
      if (id && missingOpenIds.has(id)) unique.set(id, order);
    }
  }
  const statusOrderIds = Array.from(new Set([
    ...Array.from(unique.keys()),
    ...activeLocalOrderIds.map((row) => Number(row.order_id)),
    ...openSupplyOrderIds,
    ...reshipments.map((row) => Number(row.orderID)).filter(Number.isSafeInteger),
  ]));
  const statuses = statusOrderIds.length ? await getFbsOrderStatuses(statusOrderIds) : [];
  const incomingPairs = Array.from(unique.values()).map((order) => ({
    nmId: Number(order.nmId),
    chrtId: Number(order.chrtId),
  })).filter((row) => Number.isSafeInteger(row.nmId) && row.nmId > 0 && Number.isSafeInteger(row.chrtId) && row.chrtId > 0);
  const catalogRows = incomingPairs.length ? await pgRows<{
    nm_id: number; chrt_id: number; vendor_code: string; product_name: string;
    size_name: string; photo_url: string; skus: string[];
  }>(`
    SELECT DISTINCT ON (nm_id,chrt_id)
      nm_id,chrt_id,vendor_code,product_name,size_name,photo_url,skus
    FROM fbs_fulfillment_orders
    WHERE nm_id=ANY(?::bigint[])
    ORDER BY nm_id,chrt_id,updated_at DESC
  `, [Array.from(new Set(incomingPairs.map((row) => row.nmId)))]) : [];
  const existingPairs = new Set(catalogRows.map((row) => `${row.nm_id}:${row.chrt_id}`));
  const cardNmIds = Array.from(new Set(incomingPairs
    .filter((row) => fullHistory || !existingPairs.has(`${row.nmId}:${row.chrtId}`))
    .map((row) => row.nmId)));
  const cards = await getFbsCardsByNmIds(cardNmIds);
  const catalogByPair = new Map(catalogRows.map((row) => [`${row.nm_id}:${row.chrt_id}`, row]));
  const statusMap = new Map(statuses.map((row) => [Number(row.id), row]));
  const reshipmentIds = new Set(reshipments.map((row) => Number(row.orderID)).filter(Number.isSafeInteger));
  const warehouseNameById = new Map(sellerWarehouses.map((warehouse) => [Number(warehouse.id), String(warehouse.name || `Склад ${warehouse.id}`)]));
  let newOrdersCount = 0;

  await withPgTransaction(async (client) => {
    await client.query(`
      UPDATE fbs_fulfillment_orders
      SET reshipment_required=(order_id=ANY($1::bigint[])),
          updated_at=CASE WHEN reshipment_required IS DISTINCT FROM (order_id=ANY($1::bigint[])) THEN CURRENT_TIMESTAMP ELSE updated_at END
      WHERE reshipment_required IS DISTINCT FROM (order_id=ANY($1::bigint[]))
    `, [Array.from(reshipmentIds)]);
    for (const supply of supplies) {
      await client.query(`
        INSERT INTO fbs_fulfillment_supplies (
          supply_id, name, done, is_b2b, cargo_type, destination_office_id,
          created_at_wb, closed_at_wb, scan_at_wb, raw_json, updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,CURRENT_TIMESTAMP)
        ON CONFLICT (supply_id) DO UPDATE SET
          name=EXCLUDED.name, done=EXCLUDED.done, is_b2b=EXCLUDED.is_b2b,
          cargo_type=EXCLUDED.cargo_type, destination_office_id=EXCLUDED.destination_office_id,
          created_at_wb=EXCLUDED.created_at_wb, closed_at_wb=EXCLUDED.closed_at_wb,
          scan_at_wb=EXCLUDED.scan_at_wb, raw_json=EXCLUDED.raw_json, updated_at=CURRENT_TIMESTAMP
      `, [
        supply.id, supply.name || supply.id, Boolean(supply.done), supply.isB2b ?? null,
        supply.cargoType ?? null, supply.destinationOfficeId ?? null,
        supply.createdAt || null, supply.closedAt || null, supply.scanDt || null,
        JSON.stringify(supply),
      ]);
    }

    for (const [orderId, order] of unique) {
      const raw = order as Record<string, unknown>;
      const status = statusMap.get(orderId);
      const warehouseId = integer(order.warehouseId);
      const warehouseName = warehouseId ? warehouseNameById.get(warehouseId) || "" : "";
      const nmId = integer(order.nmId) || 0;
      const chrtId = integer(order.chrtId) || 0;
      if (!nmId || !chrtId) continue;
      const article = text(order.article || raw.vendorCode);
      const card = cards.get(nmId);
      const variant = card?.variants.find((item) => item.chrtId === chrtId);
      const catalog = catalogByPair.get(`${nmId}:${chrtId}`);
      const productName = card?.title || catalog?.product_name || text(raw.productName || raw.name || raw.subject || article || nmId);
      const sizeName = variant?.sizeName || catalog?.size_name || text(raw.size || raw.techSize);
      const skus = jsonArray(raw.skus).length ? jsonArray(raw.skus) : jsonArray(catalog?.skus);
      const hasRequiredMeta = Object.prototype.hasOwnProperty.call(raw, "requiredMeta");
      const hasOptionalMeta = Object.prototype.hasOwnProperty.call(raw, "optionalMeta");
      const requiredMeta = jsonArray(raw.requiredMeta);
      const optionalMeta = jsonArray(raw.optionalMeta);
      const createdAt = text(order.createdAt);
      const upsertResult = await client.query<{ is_new: boolean }>(`
        INSERT INTO fbs_fulfillment_orders (
          order_id, order_uid, supply_id, warehouse_id, nm_id, chrt_id,
          vendor_code, product_name, size_name, photo_url, skus, required_meta,
          optional_meta, supplier_status, wb_status, reshipment_required,
          created_at_wb, raw_json, updated_at
        ) VALUES ($1,$2,NULLIF($3,''),$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,
          $13::jsonb,$14,$15,$16,$17,$18::jsonb,CURRENT_TIMESTAMP)
        ON CONFLICT (order_id) DO UPDATE SET
          order_uid=EXCLUDED.order_uid,
          supply_id=COALESCE(EXCLUDED.supply_id, fbs_fulfillment_orders.supply_id),
          warehouse_id=EXCLUDED.warehouse_id, nm_id=EXCLUDED.nm_id, chrt_id=EXCLUDED.chrt_id,
          vendor_code=EXCLUDED.vendor_code, product_name=EXCLUDED.product_name,
          size_name=EXCLUDED.size_name,
          photo_url=CASE WHEN EXCLUDED.photo_url <> '' THEN EXCLUDED.photo_url ELSE fbs_fulfillment_orders.photo_url END,
          skus=EXCLUDED.skus,
          required_meta=CASE WHEN $19::boolean THEN EXCLUDED.required_meta ELSE fbs_fulfillment_orders.required_meta END,
          optional_meta=CASE WHEN $20::boolean THEN EXCLUDED.optional_meta ELSE fbs_fulfillment_orders.optional_meta END,
          supplier_status=EXCLUDED.supplier_status, wb_status=EXCLUDED.wb_status,
          reshipment_required=EXCLUDED.reshipment_required,
          created_at_wb=EXCLUDED.created_at_wb,
          raw_json=fbs_fulfillment_orders.raw_json || EXCLUDED.raw_json,
          updated_at=CURRENT_TIMESTAMP
        RETURNING first_seen_at = updated_at AS is_new
      `, [
        orderId, text(order.orderUid), orderSupplyId(order), warehouseId, nmId, chrtId,
        card?.vendorCode || catalog?.vendor_code || article, productName, sizeName, card?.photoUrl || catalog?.photo_url || getWbImageUrl(nmId, "small"), JSON.stringify(skus),
        JSON.stringify(requiredMeta), JSON.stringify(optionalMeta), status?.supplierStatus || "new",
        status?.wbStatus || "waiting", reshipmentIds.has(orderId), createdAt || null,
        JSON.stringify(warehouseName ? { ...order, _mphubWarehouseName: warehouseName } : order),
        hasRequiredMeta, hasOptionalMeta,
      ]);
      if (upsertResult.rows[0]?.is_new) newOrdersCount += 1;
    }

    if (statuses.length) {
      await client.query(`
        UPDATE fbs_fulfillment_orders o SET
          supplier_status=s.supplier_status,
          wb_status=s.wb_status,
          updated_at=CURRENT_TIMESTAMP
        FROM unnest($1::bigint[], $2::text[], $3::text[]) AS s(order_id,supplier_status,wb_status)
        WHERE o.order_id=s.order_id
      `, [
        statuses.map((row) => Number(row.id)),
        statuses.map((row) => String(row.supplierStatus || "")),
        statuses.map((row) => String(row.wbStatus || "")),
      ]);
    }

    for (const [supplyId, actualOrderIds] of openSupplyMemberships) {
      let attachedCount = 0;
      if (actualOrderIds.length) {
        const attached = await client.query(`
          UPDATE fbs_fulfillment_orders
          SET supply_id=$1,reshipment_required=FALSE,updated_at=CURRENT_TIMESTAMP
          WHERE order_id=ANY($2::bigint[]) AND supply_id IS DISTINCT FROM $1
        `, [supplyId, actualOrderIds]);
        attachedCount = attached.rowCount || 0;
      }
      const detached = actualOrderIds.length
        ? await client.query(`
            UPDATE fbs_fulfillment_orders
            SET supply_id=NULL,updated_at=CURRENT_TIMESTAMP
            WHERE supply_id=$1 AND NOT (order_id=ANY($2::bigint[]))
          `, [supplyId, actualOrderIds])
        : await client.query(`
            UPDATE fbs_fulfillment_orders
            SET supply_id=NULL,updated_at=CURRENT_TIMESTAMP
            WHERE supply_id=$1
          `, [supplyId]);
      await client.query(`
        UPDATE fbs_fulfillment_supplies
        SET order_count=$2,updated_at=CURRENT_TIMESTAMP
        WHERE supply_id=$1
      `, [supplyId, actualOrderIds.length]);
      if (attachedCount || detached.rowCount) {
        await event(client, "supply_membership_reconciled", {
          supplyId,
          message: `Состав поставки восстановлен по WB: ${actualOrderIds.length} заказов`,
          details: { actualOrderIds, attachedCount, detachedCount: detached.rowCount || 0 },
        });
      }
    }

    await client.query(`
      UPDATE fbs_fulfillment_supplies s SET
        order_count=(SELECT COUNT(*)::int FROM fbs_fulfillment_orders o WHERE o.supply_id=s.supply_id),
        updated_at=CURRENT_TIMESTAMP
    `);
    await event(client, "sync", {
      message: newOrdersCount > 0 ? `Получено новых заказов: ${newOrdersCount}` : "Новых заказов нет",
      details: {
        newOrders: newOrdersCount,
        updatedOrders: unique.size,
        updatedSupplies: supplies.length,
        reconciledOpenSupplies: openSupplyMemberships.size,
        openSupplyMembershipErrors,
        fullHistory,
        historyFrom: since.toISOString(),
      },
    });
  });
  const activeOrderIds = statusOrderIds.filter((orderId) => statusMap.get(orderId)?.supplierStatus === "confirm");
  if (activeOrderIds.length) {
    try {
      await verifyFbsMetadata(activeOrderIds);
    } catch (error) {
      await withPgTransaction(async (client) => event(client, "metadata_sync_warning", {
        status: "warning",
        message: `WB временно не подтвердил поля маркировки: ${error instanceof Error ? error.message : String(error)}`,
      }));
    }
  }
  return { orders: unique.size, newOrders: newOrdersCount, supplies: supplies.length, reshipments: reshipmentIds.size };
}

export async function getFbsFulfillmentSnapshot() {
  const [orders, supplies, warehouses, markingPolicy] = await Promise.all([
    pgRows<OrderRow>(`
      SELECT * FROM fbs_fulfillment_orders
      WHERE supplier_status IN ('new','confirm') OR reshipment_required=TRUE
      ORDER BY created_at_wb ASC NULLS LAST, order_id
    `),
    pgRows(`
      SELECT s.*,
        EXISTS (
          SELECT 1 FROM fbs_fulfillment_events e
          WHERE e.supply_id=s.supply_id AND e.action='supply_delivered'
        ) AS locally_delivered
      FROM fbs_fulfillment_supplies s
      ORDER BY s.done,s.created_at_wb DESC NULLS LAST LIMIT 100
    `),
    pgRows<{ warehouse_id: number; warehouse_name: string }>(`
      SELECT warehouse_id,
        COALESCE(
          MAX(warehouse_name) FILTER (WHERE source_priority=1 AND warehouse_name <> ''),
          MAX(warehouse_name) FILTER (WHERE source_priority=2 AND warehouse_name <> ''),
          'Склад №' || warehouse_id::text
        ) AS warehouse_name
      FROM (
        SELECT warehouse_id, COALESCE(NULLIF(raw_json->>'_mphubWarehouseName',''), '') AS warehouse_name, 1 AS source_priority
        FROM fbs_fulfillment_orders WHERE warehouse_id IS NOT NULL
        UNION ALL
        SELECT warehouse_id, COALESCE(warehouse_name, ''), 2 FROM fbs_stock_warehouses
      ) warehouse_catalog
      GROUP BY warehouse_id
      ORDER BY COALESCE(
        MAX(warehouse_name) FILTER (WHERE source_priority=1 AND warehouse_name <> ''),
        MAX(warehouse_name) FILTER (WHERE source_priority=2 AND warehouse_name <> ''),
        'Склад №' || warehouse_id::text
      )
    `),
    getFbsMarkingPolicy(),
  ]);
  return { orders, supplies, scans: [], events: [], warehouses, markingPolicy };
}

export async function getFbsFulfillmentLiveSnapshot(supplyId: string) {
  const normalizedSupplyId = supplyId.trim();
  if (!normalizedSupplyId) throw new Error("Поставка не выбрана");
  const [orders, supplies] = await Promise.all([
    pgRows<Pick<OrderRow, "order_id" | "picked_at" | "sticker_printed_at">>(`
      SELECT order_id,picked_at,sticker_printed_at
      FROM fbs_fulfillment_orders
      WHERE supply_id=?
      ORDER BY order_id
    `, [normalizedSupplyId]),
    pgRows(`
      SELECT s.*,
        EXISTS (
          SELECT 1 FROM fbs_fulfillment_events e
          WHERE e.supply_id=s.supply_id AND e.action='supply_delivered'
        ) AS locally_delivered
      FROM fbs_fulfillment_supplies s
      WHERE s.supply_id=?
      LIMIT 1
    `, [normalizedSupplyId]),
  ]);
  return { orders, supply: supplies[0] || null };
}

function assertOrderIds(orderIds: number[]): number[] {
  const clean = Array.from(new Set(orderIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0)));
  if (!clean.length) throw new Error("Выберите хотя бы один новый заказ");
  return clean;
}

async function getAssignableFbsOrders(orderIds: number[]): Promise<OrderRow[]> {
  const placeholders = orderIds.map((_, index) => `$${index + 1}`).join(",");
  const rows = await pgRows<OrderRow>(`SELECT * FROM fbs_fulfillment_orders WHERE order_id IN (${placeholders})`, orderIds);
  if (rows.length !== orderIds.length) throw new Error("Часть заказов не найдена — сначала обновите список");
  if (rows.some((row) => row.supplier_status !== "new" && !row.reshipment_required)) {
    throw new Error("В поставку можно добавить только новые заказы или заказы повторной отгрузки");
  }
  if (rows.some((row) => row.supplier_status === "new" && row.wb_status !== "waiting" && !row.reshipment_required)) {
    throw new Error("Часть заказов уже отменена или недоступна на WB. Обновите список и выберите действующие заказы");
  }
  return rows;
}

function assertFbsOrdersCompatible(rows: OrderRow[]) {
  const cargoTypes = new Set(rows.map((row) => Number(row.raw_json?.cargoType ?? -1)));
  if (cargoTypes.size > 1) throw new Error("WB запрещает смешивать в одной поставке разные габаритные типы");
  const warehouseIds = new Set(rows.map((row) => Number(row.warehouse_id || 0)));
  if (warehouseIds.size > 1) throw new Error("WB запрещает добавлять в одну поставку заказы с разных складов продавца");
  const crossBorderTypes = new Set(rows.map((row) => Number(row.raw_json?.crossBorderType ?? -1)));
  if (crossBorderTypes.size > 1) throw new Error("WB запрещает смешивать в одной поставке кроссбордер и обычные заказы");
  const b2bTypes = new Set(rows.map(fbsOrderIsB2b));
  if (b2bTypes.size > 1) throw new Error("WB запрещает смешивать в одной поставке B2B- и B2C-заказы");
}

function assertFbsOrdersAllowedForPickupPoint(rows: OrderRow[]) {
  const blocked = rows.filter((row) => !fbsOrderAllowsPickupPoint(row));
  if (blocked.length) {
    throw new Error(`WB не разрешает отгрузку в ПВЗ для ${blocked.length} ${blocked.length === 1 ? "заказа" : "заказов"}. Выберите «Склад / СЦ»`);
  }
}

async function persistVerifiedSupplyMembership(
  supplyId: string,
  actualOrderIds: number[],
  action: string,
  message: string,
  details: Record<string, unknown> = {},
) {
  await withPgTransaction(async (client) => {
    if (actualOrderIds.length) {
      await client.query(`
        UPDATE fbs_fulfillment_orders
        SET supply_id=$1,supplier_status='confirm',reshipment_required=FALSE,updated_at=CURRENT_TIMESTAMP
        WHERE order_id=ANY($2::bigint[])
      `, [supplyId, actualOrderIds]);
      await client.query(`
        UPDATE fbs_fulfillment_orders
        SET supply_id=NULL,updated_at=CURRENT_TIMESTAMP
        WHERE supply_id=$1 AND NOT (order_id=ANY($2::bigint[]))
      `, [supplyId, actualOrderIds]);
    } else {
      await client.query(`
        UPDATE fbs_fulfillment_orders SET supply_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE supply_id=$1
      `, [supplyId]);
    }
    await client.query(`
      UPDATE fbs_fulfillment_supplies SET order_count=$2,updated_at=CURRENT_TIMESTAMP WHERE supply_id=$1
    `, [supplyId, actualOrderIds.length]);
    await event(client, action, { supplyId, message, details: { ...details, actualOrderIds } });
  });
}

async function refreshAttachedOrdersMetadata(supplyId: string, orderIds: number[]) {
  if (!orderIds.length) return;
  try {
    await verifyFbsMetadata(orderIds);
  } catch (error) {
    await withPgTransaction(async (client) => event(client, "metadata_refresh_warning", {
      supplyId,
      status: "warning",
      message: `Поля маркировки будут перепроверены перед отгрузкой: ${error instanceof Error ? error.message : String(error)}`,
      details: { orderIds },
    }));
  }
}

type FbsSupplyAttachmentResult = {
  actualOrderIds: number[];
  addError: unknown;
  addAttempts: number;
  membershipChecks: number;
};

const FBS_SUPPLY_MEMBERSHIP_DELAYS_MS = [500, 1_000, 2_000, 4_000] as const;
const FBS_SUPPLY_ADD_ATTEMPTS = 3;

function isRetryableSupplyAddError(error: unknown): boolean {
  return !(error instanceof FbsWbApiError) || error.status === 429 || error.status >= 500;
}

/**
 * WB can return an empty membership immediately after accepting PATCH /orders.
 * Re-read the live supply and safely re-send only orders that WB still has not
 * attached. Adding the same order to the same open supply is idempotent in the
 * live FBS workflow and prevents an empty first supply from reaching the UI.
 */
async function attachFbsOrdersAndConfirm(
  supplyId: string,
  requestedOrderIds: number[],
): Promise<FbsSupplyAttachmentResult> {
  let actualOrderIds: number[] = [];
  let addError: unknown = null;
  let lastMembershipError: unknown = null;
  let addAttempts = 0;
  let membershipChecks = 0;
  let membershipWasRead = false;

  for (let attempt = 0; attempt < FBS_SUPPLY_ADD_ATTEMPTS; attempt += 1) {
    const attached = new Set(actualOrderIds);
    const missingOrderIds = requestedOrderIds.filter((orderId) => !attached.has(orderId));
    if (!missingOrderIds.length) break;

    addAttempts += 1;
    let canRepeatAdd = true;
    try {
      await addFbsOrdersToSupply(supplyId, missingOrderIds);
      addError = null;
    } catch (error) {
      addError = error;
      canRepeatAdd = isRetryableSupplyAddError(error);
    }

    for (const delayMs of FBS_SUPPLY_MEMBERSHIP_DELAYS_MS) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      membershipChecks += 1;
      try {
        actualOrderIds = await getFbsSupplyOrderIds(supplyId);
        membershipWasRead = true;
        lastMembershipError = null;
      } catch (error) {
        lastMembershipError = error;
        continue;
      }
      const confirmed = new Set(actualOrderIds);
      if (requestedOrderIds.every((orderId) => confirmed.has(orderId))) {
        return { actualOrderIds, addError, addAttempts, membershipChecks };
      }
    }

    if (!canRepeatAdd) break;
  }

  if (!membershipWasRead) {
    throw new Error(`WB не дал проверить фактический состав поставки: ${lastMembershipError instanceof Error ? lastMembershipError.message : String(lastMembershipError || "нет ответа")}`);
  }
  return { actualOrderIds, addError, addAttempts, membershipChecks };
}

export async function createFbsFulfillmentSupply(input: {
  name: string;
  deliveryMode: "warehouse" | "pvz";
  orderIds: number[];
}) {
  const orderIds = assertOrderIds(input.orderIds);
  const name = input.name.trim().slice(0, 128);
  if (!name) throw new Error("Укажите название поставки");
  const rows = await getAssignableFbsOrders(orderIds);
  assertFbsOrdersCompatible(rows);
  if (input.deliveryMode === "pvz") {
    assertFbsOrdersAllowedForPickupPoint(rows);
    if (rows.length < 2) throw new Error("Для поставки в ПВЗ нужно минимум два заказа. Один заказ отвезите на склад / СЦ");
  }

  const supply = await createFbsSupply(name);
  await withPgTransaction(async (client) => {
    await client.query(`
      INSERT INTO fbs_fulfillment_supplies (supply_id,name,delivery_mode,done,order_count,created_at_wb)
      VALUES ($1,$2,$3,FALSE,0,CURRENT_TIMESTAMP)
      ON CONFLICT (supply_id) DO UPDATE SET name=EXCLUDED.name,delivery_mode=EXCLUDED.delivery_mode,
        done=FALSE,updated_at=CURRENT_TIMESTAMP
    `, [supply.id, name, input.deliveryMode]);
  });

  let attachment: FbsSupplyAttachmentResult;
  try {
    attachment = await attachFbsOrdersAndConfirm(supply.id, orderIds);
  } catch (membershipError) {
    await withPgTransaction(async (client) => event(client, "supply_membership_check_failed", {
      supplyId: supply.id,
      status: "error",
      message: membershipError instanceof Error ? membershipError.message : String(membershipError),
      details: { requestedOrderIds: orderIds },
    }));
    throw new Error(`Поставка ${supply.id} создана, но WB не дал проверить её состав. Нажмите «Получить новые заказы» перед повторным действием`);
  }

  const actualIds = attachment.actualOrderIds;
  const attached = orderIds.filter((orderId) => actualIds.includes(orderId));
  const failed = orderIds.filter((orderId) => !actualIds.includes(orderId));
  const partial = attached.length !== orderIds.length;
  const wbMessage = attachment.addError instanceof Error
    ? attachment.addError.message
    : attachment.addError ? String(attachment.addError) : "";
  await persistVerifiedSupplyMembership(
    supply.id,
    actualIds,
    partial ? "supply_created_partial" : "supply_created",
    partial
      ? `WB добавил ${attached.length} из ${orderIds.length} заказов`
      : `${attached.length} заказов добавлено`,
    {
      requestedOrderIds: orderIds,
      attachedOrderIds: attached,
      failedOrderIds: failed,
      deliveryMode: input.deliveryMode,
      wbMessage,
      addAttempts: attachment.addAttempts,
      membershipChecks: attachment.membershipChecks,
    },
  );
  await refreshAttachedOrdersMetadata(supply.id, attached);

  if (!attached.length) {
    throw new Error(`Поставка ${supply.id} создана, но WB не добавил в неё заказы${wbMessage ? `: ${wbMessage}` : ""}`);
  }
  return {
    supplyId: supply.id,
    added: attached.length,
    requested: orderIds.length,
    failed: failed.length,
    partial,
    warning: partial ? wbMessage || "WB подтвердил только часть выбранных заказов" : "",
  };
}

export async function addFbsFulfillmentOrdersToSupply(input: { supplyId: string; orderIds: number[] }) {
  const supplyId = input.supplyId.trim();
  if (!supplyId) throw new Error("Выберите существующую поставку");
  const orderIds = assertOrderIds(input.orderIds);
  const supplyRows = await pgRows<{ supply_id: string; done: boolean; delivery_mode: string }>(`SELECT supply_id,done,delivery_mode FROM fbs_fulfillment_supplies WHERE supply_id=?`, [supplyId]);
  if (!supplyRows[0]) throw new Error("Поставка не найдена — сначала обновите данные WB");
  if (supplyRows[0].done) throw new Error("Поставка уже передана в доставку, добавлять заказы нельзя");

  const selectedRows = await getAssignableFbsOrders(orderIds);
  const wbExistingIds = await getFbsSupplyOrderIds(supplyId);
  const existingRows = wbExistingIds.length
    ? await pgRows<OrderRow>(`SELECT * FROM fbs_fulfillment_orders WHERE order_id = ANY(?::bigint[])`, [wbExistingIds])
    : [];
  if (existingRows.length !== wbExistingIds.length) {
    throw new Error("Не все заказы существующей поставки загружены в MpHub. Нажмите «Получить новые заказы» и повторите");
  }
  assertFbsOrdersCompatible([...existingRows, ...selectedRows]);
  if (supplyRows[0].delivery_mode === "pvz") {
    // WB may reset isPickupPointShipmentAllowed after an order has already been
    // attached to a supply. Re-check only the new orders here: the existing
    // orders were validated before they were added and WB is their live source
    // of truth from this point on.
    assertFbsOrdersAllowedForPickupPoint(selectedRows);
    if (wbExistingIds.length > 0) {
      const liveBoxes = await getFbsSupplyBoxes(supplyId);
      if (liveBoxes.length) throw new Error("Сначала удалите грузоместа ПВЗ, затем добавьте новые заказы и создайте грузоместа заново");
    }
  }

  let attachment: FbsSupplyAttachmentResult;
  try {
    attachment = await attachFbsOrdersAndConfirm(supplyId, orderIds);
  } catch (membershipError) {
    throw new Error(`WB не дал проверить фактический состав поставки. Состояние не изменено локально: ${membershipError instanceof Error ? membershipError.message : membershipError}`);
  }
  const actualIds = attachment.actualOrderIds;
  const attached = orderIds.filter((id) => actualIds.includes(id));
  const failed = orderIds.filter((id) => !actualIds.includes(id));
  const partial = attached.length !== orderIds.length;
  const wbMessage = attachment.addError instanceof Error
    ? attachment.addError.message
    : attachment.addError ? String(attachment.addError) : "";
  await persistVerifiedSupplyMembership(
    supplyId,
    actualIds,
    partial ? "supply_extended_partial" : "supply_extended",
    partial
      ? `WB добавил ${attached.length} из ${orderIds.length} заказов`
      : `${attached.length} заказов добавлено в существующую поставку`,
    {
      requestedOrderIds: orderIds,
      attachedOrderIds: attached,
      failedOrderIds: failed,
      wbMessage,
      addAttempts: attachment.addAttempts,
      membershipChecks: attachment.membershipChecks,
    },
  );
  await refreshAttachedOrdersMetadata(supplyId, attached);
  if (!attached.length) {
    throw new Error(`WB не добавил заказы в поставку${wbMessage ? `: ${wbMessage}` : ""}`);
  }
  return {
    supplyId,
    added: attached.length,
    requested: orderIds.length,
    failed: failed.length,
    partial,
    warning: partial ? wbMessage || "WB подтвердил только часть выбранных заказов" : "",
  };
}

function scannerValue(raw: string): string {
  // Remove only keyboard-scanner terminators. Never trim or normalize the
  // payload: ASCII 29 (GS) inside Honest Mark DataMatrix must survive exactly.
  return raw.replace(/[\r\n]+$/g, "");
}

function masked(value: string): string {
  if (value.length <= 8) return `${value.slice(0, 2)}…${value.slice(-2)}`;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

export async function scanFbsProduct(supplyId: string, rawValue: string) {
  const value = scannerValue(rawValue);
  if (!value) throw new Error("Сканер не передал значение");
  return withPgTransaction(async (client) => {
    const result = await client.query<OrderRow>(`
      SELECT * FROM fbs_fulfillment_orders
      WHERE supply_id=$1 AND supplier_status='confirm' AND picked_at IS NULL
      ORDER BY created_at_wb, order_id FOR UPDATE
    `, [supplyId]);
    const order = result.rows.find((row) => jsonArray(row.skus).includes(value));
    const valueHash = crypto.createHash("sha256").update(value).digest("hex");
    if (!order) {
      await client.query(`INSERT INTO fbs_fulfillment_scans (supply_id,scan_type,value_hash,value_masked,result,message) VALUES ($1,'product',$2,$3,'error','Товар не найден или уже собран')`, [supplyId, valueHash, masked(value)]);
      throw new Error("Этот товар не найден в поставке или уже отмечен собранным");
    }
    await client.query(`UPDATE fbs_fulfillment_orders SET picked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE order_id=$1`, [order.order_id]);
    await client.query(`INSERT INTO fbs_fulfillment_scans (order_id,supply_id,scan_type,value_hash,value_masked,result,message) VALUES ($1,$2,'product',$3,$4,'ok','Товар найден')`, [order.order_id, supplyId, valueHash, masked(value)]);
    await event(client, "product_picked", { orderId: order.order_id, supplyId, message: "Товар подтверждён сканером" });
    return { orderId: order.order_id, productName: order.product_name, vendorCode: order.vendor_code };
  });
}

export async function scanFbsOrderSticker(rawValue: string, supplyIdInput = "") {
  const value = scannerValue(rawValue);
  if (!value) throw new Error("Сканер не передал значение");
  const supplyId = supplyIdInput.trim();
  const rows = supplyId
    ? await pgRows<OrderRow>(`SELECT * FROM fbs_fulfillment_orders WHERE supply_id=? AND supplier_status='confirm' AND picked_at IS NOT NULL AND sticker_printed_at IS NOT NULL ORDER BY order_id`, [supplyId])
    : await pgRows<OrderRow>(`SELECT * FROM fbs_fulfillment_orders WHERE supplier_status='confirm' AND sticker_printed_at IS NOT NULL ORDER BY updated_at DESC LIMIT 2000`);
  const scanned = new Set(fbsStickerScanVariants(value));
  const matches = rows.filter((row) => [
    ...fbsStoredStickerVariants(row.sticker_barcode),
    ...fbsStoredStickerVariants(fbsStickerNumber(row)),
  ].some((candidate) => scanned.has(candidate)));
  if (!matches.length) throw new Error("Этикетка WB не найдена в текущей поставке или ещё не напечатана");
  if (matches.length > 1) throw new Error("Сканирование неоднозначно. Повторно отсканируйте этикетку WB");
  const order = matches[0];
  const markingPolicy = await getFbsMarkingPolicy();
  if (!getFbsEffectiveRequiredMeta(order.required_meta, order.optional_meta, order.product_name, order.vendor_code, [], markingPolicy).includes("sgtin")) {
    throw new Error("Для этого товара DataMatrix не требуется — его можно сразу положить в коробку");
  }
  return order;
}

function safeMetadataError(error: unknown, secret: string): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.split(secret).join(masked(secret)).slice(0, 900);
}

function wbMetadataDecisionMessage(decision: string): string {
  const messages: Record<string, string> = {
    deadlineexceeded: `Не проверено WB после ${MAX_FBS_SGTIN_VERIFICATION_ATTEMPTS} попыток`,
    sgtinnotfound: "WB не нашёл этот код маркировки в системе «Честный знак»",
    sgtininvalidformat: "WB отклонил формат кода маркировки",
    sgtinnogs: "в коде маркировки отсутствует обязательный GS-разделитель",
    sgtinhasinvalidsymbols: "код маркировки содержит недопустимые символы",
    sgtinhasnonlatinsymbols: "код маркировки содержит не латинские символы — проверьте раскладку сканера",
    sgtininvalidpattern: "структура кода маркировки не соответствует формату «Честного знака»",
    sgtinalreadyused: "WB сообщил, что код маркировки уже использован",
    sgtinalreadysold: "WB сообщил, что товар с этим кодом уже продан",
    sgtinbadstatus: "код маркировки имеет недопустимый статус в «Честном знаке»",
    sgtinnotbelongproduct: "код маркировки не относится к этому товару",
    sgtinemitted: "код маркировки выпущен, но ещё не введён в оборот",
    sgtinapplied: "код маркировки не прошёл процедуру ввода в оборот",
    sgtinwrittenoff: "код маркировки уже списан",
    sgtinretired: "код маркировки уже выбыл из оборота",
    sgtinwithdrawn: "код маркировки уже выбыл из оборота",
    sgtindisaggregation: "код маркировки относится к расформированной упаковке",
    sgtindisaggregated: "код маркировки относится к расформированной упаковке",
    sgtinappliednotpaid: "код маркировки не оплачен в системе «Честный знак»",
  };
  return messages[decision] || (decision ? `WB отклонил код маркировки: ${decision}` : "WB не подтвердил код маркировки");
}

function liveMetadataOrder(metadata: FbsWbOrderMeta[], orderId: number): FbsWbOrderMeta | undefined {
  return metadata.find((item) => Number(item.orderId || item.id) === orderId);
}

async function waitForAcceptedFbsDataMatrix(
  orderId: number,
  submittedValue: string,
): Promise<{ metadata: FbsWbOrderMeta; verification: "filled" | "pending" }> {
  const delays = [250, 500, 1_000, 2_000, 3_000, 5_000];
  let lastState = "";
  let lastMetadata: FbsWbOrderMeta | undefined;
  for (const delayMs of delays) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const metadata = await getFbsOrderMeta([orderId]);
    const live = liveMetadataOrder(metadata, orderId);
    if (!live) {
      lastState = "missing-order";
      continue;
    }
    lastMetadata = live;
    await reconcileFbsLiveMetadata(metadata);
    const state = getFbsLiveMetaState(live, "sgtin");
    lastState = state.decision || state.state;
    if (state.state === "rejected") throw new Error(wbMetadataDecisionMessage(state.decision));
    if (state.state !== "filled") continue;
    if (state.values.length > 0 && !state.values.some((value) => sameFbsDataMatrixIdentity(submittedValue, value))) {
      throw new Error("WB вернул другой код маркировки для этой этикетки");
    }
    return { metadata: live, verification: "filled" };
  }
  if (lastState === "pending" && lastMetadata) {
    return { metadata: lastMetadata, verification: "pending" };
  }
  throw new Error("WB не подтвердил код маркировки после отправки");
}

async function recordFbsMetadataScan(
  order: OrderRow,
  type: FbsMetaType,
  hash: string,
  value: string,
  result: "ok" | "pending" | "error",
  message: string,
  scanId: number | null = null,
) {
  await withPgTransaction(async (client) => {
    if (scanId) {
      await client.query(`UPDATE fbs_fulfillment_scans SET result=$2,message=$3 WHERE id=$1`, [scanId, result, message]);
    } else {
      await client.query(
        `INSERT INTO fbs_fulfillment_scans (order_id,supply_id,scan_type,value_hash,value_masked,result,message) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [order.order_id, order.supply_id, type, hash, masked(value), result, message],
      );
    }
    await event(client, result === "ok" ? "metadata_attached" : result === "pending" ? "metadata_pending" : "metadata_rejected", {
      orderId: order.order_id,
      supplyId: order.supply_id || undefined,
      status: result === "pending" ? "warning" : result,
      message,
      details: { type, valueHash: hash },
    });
  });
}

async function reserveFbsSgtinScan(order: OrderRow, hash: string, value: string): Promise<{ scanId: number; existing: boolean }> {
  return withPgTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [hash]);
    await client.query(`
      UPDATE fbs_fulfillment_scans s
      SET result='error',message='Незавершённая передача истекла — разрешено повторное сканирование'
      WHERE s.scan_type='sgtin' AND s.value_hash=$1 AND s.result='pending'
        AND s.created_at<CURRENT_TIMESTAMP-INTERVAL '2 minutes'
        AND NOT EXISTS (
          SELECT 1 FROM fbs_marking_queue q
          WHERE q.scan_id=s.id AND q.status IN ('queued','sending','sent','retry')
        )
    `, [hash]);
    const duplicate = await client.query<{ id: number; order_id: number; result: string }>(`
      SELECT id,order_id,result FROM fbs_fulfillment_scans
      WHERE scan_type='sgtin' AND value_hash=$1 AND result IN ('ok','pending')
      ORDER BY created_at DESC LIMIT 1
    `, [hash]);
    if (duplicate.rows[0]) {
      if (Number(duplicate.rows[0].order_id) === Number(order.order_id) && duplicate.rows[0].result === "pending") {
        return { scanId: Number(duplicate.rows[0].id), existing: true };
      }
      throw new Error("Этот код маркировки уже закреплён за другой этикеткой");
    }
    const inserted = await client.query<{ id: number }>(`
      INSERT INTO fbs_fulfillment_scans (order_id,supply_id,scan_type,value_hash,value_masked,result,message)
      VALUES ($1,$2,'sgtin',$3,$4,'pending','DataMatrix принят в очередь передачи WB') RETURNING id
    `, [order.order_id, order.supply_id, hash, masked(value)]);
    return { scanId: Number(inserted.rows[0].id), existing: false };
  });
}

function pendingSgtinDecisions(order: OrderRow): FbsWbMetaDetail[] {
  const decisions = (Array.isArray(order.metadata_decisions) ? order.metadata_decisions : [])
    .filter((detail) => ![detail.key, detail.type, detail.name, detail.metaType]
      .some((item) => String(item || "").toLowerCase() === "sgtin"));
  decisions.push({ type: "sgtin", decision: "pending" });
  return decisions;
}

/**
 * Performs only deterministic local checks and durably stores the pair. WB
 * delivery is intentionally handled by processFbsMarkingQueue so the scanner
 * can accept the next physical item immediately.
 */
export async function enqueueFbsAssemblySgtin(orderId: number, rawValue: string) {
  let value = normalizeFbsDataMatrix(rawValue);
  if (!value) throw new Error("Пустое значение маркировки");
  const parsed = parseFbsDataMatrix(value);
  value = parsed.value;
  const hash = crypto.createHash("sha256").update(value).digest("hex");
  const rows = await pgRows<OrderRow>(`SELECT * FROM fbs_fulfillment_orders WHERE order_id=?`, [orderId]);
  const order = rows[0];
  if (!order) throw new Error("Этикетка не найдена в рабочей поставке");
  if (order.supplier_status !== "confirm") throw new Error("Маркировку можно закрепить только за этикеткой в статусе «На сборке»");

  const markingPolicy = await getFbsMarkingPolicy();
  const allowed = new Set([
    ...jsonArray(order.required_meta),
    ...jsonArray(order.optional_meta),
    ...getFbsEffectiveRequiredMeta(
      order.required_meta,
      order.optional_meta,
      order.product_name,
      order.vendor_code,
      [],
      markingPolicy,
    ),
  ]);
  if (!allowed.has("sgtin")) throw new Error("WB не требует «Честный знак» для этой этикетки");

  const stickerNumber = text(order.raw_json?._mphubStickerNumber);
  const forbiddenLabels = new Set([
    ...jsonArray(order.skus),
    text(order.sticker_barcode),
    stickerNumber,
    String(order.order_id),
  ].filter(Boolean));
  if (forbiddenLabels.has(value)) {
    throw new Error("Отсканирован штрихкод товара или стикер WB, а не DataMatrix «Честного знака»");
  }

  const alreadyFilled = (order.metadata_decisions || []).some((detail) =>
    [detail.key, detail.type, detail.name, detail.metaType].some((item) => String(item || "").toLowerCase() === "sgtin")
    && String(detail.decision || detail.status || "").toLowerCase() === "filled"
  );
  if (alreadyFilled) throw new Error(`${fbsLabelText(order)}: «Честный знак» уже принят WB`);

  return withPgTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`fbs-sgtin-order:${orderId}`]);
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`fbs-sgtin-value:${hash}`]);

    const duplicate = await client.query<{ id: number; order_id: number; result: string }>(`
      SELECT id,order_id,result FROM fbs_fulfillment_scans
      WHERE scan_type='sgtin' AND value_hash=$1 AND result IN ('ok','pending')
      ORDER BY created_at DESC LIMIT 1
    `, [hash]);
    if (duplicate.rows[0]) {
      if (Number(duplicate.rows[0].order_id) === orderId && duplicate.rows[0].result === "pending") {
        return { verification: "queued" as const, orderId, existing: true };
      }
      throw new Error("Этот код маркировки уже закреплён за другой этикеткой");
    }

    const activeForOrder = await client.query<{ id: number }>(`
      SELECT id FROM fbs_fulfillment_scans
      WHERE order_id=$1 AND scan_type='sgtin' AND result='pending'
      ORDER BY created_at DESC LIMIT 1
    `, [orderId]);
    if (activeForOrder.rows[0]) {
      throw new Error(`${fbsLabelText(order)}: другой код «Честного знака» уже находится в очереди WB`);
    }

    const inserted = await client.query<{ id: number }>(`
      INSERT INTO fbs_fulfillment_scans (order_id,supply_id,scan_type,value_hash,value_masked,result,message)
      VALUES ($1,$2,'sgtin',$3,$4,'pending','DataMatrix принят в очередь передачи WB') RETURNING id
    `, [orderId, order.supply_id, hash, masked(value)]);
    const scanId = Number(inserted.rows[0].id);
    await client.query(`
      INSERT INTO fbs_marking_queue (scan_id,order_id,supply_id,value_hash,value_payload,status)
      VALUES ($1,$2,$3,$4,$5,'queued')
    `, [scanId, orderId, order.supply_id, hash, value]);
    await client.query(`
      UPDATE fbs_fulfillment_orders
      SET metadata_decisions=$2::jsonb,metadata_checked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
      WHERE order_id=$1
    `, [orderId, JSON.stringify(pendingSgtinDecisions(order))]);
    await event(client, "metadata_queued", {
      orderId,
      supplyId: order.supply_id || undefined,
      status: "warning",
      message: "DataMatrix поставлен в фоновую очередь WB",
      details: { type: "sgtin", valueHash: hash, scanId },
    });
    return { verification: "queued" as const, orderId, existing: false };
  });
}

async function claimFbsMarkingQueue(limit = 50): Promise<MarkingQueueRow[]> {
  return withPgTransaction(async (client) => {
    await client.query(`
      UPDATE fbs_marking_queue
      SET status='retry',available_at=CURRENT_TIMESTAMP,lease_until=NULL,
          last_error=CASE WHEN last_error='' THEN 'Передача была прервана и автоматически возобновлена' ELSE last_error END,
          updated_at=CURRENT_TIMESTAMP
      WHERE status='sending' AND lease_until<CURRENT_TIMESTAMP
    `);
    const claimed = await client.query<MarkingQueueRow>(`
      WITH next_rows AS (
        SELECT queue_id FROM fbs_marking_queue
        WHERE status IN ('queued','retry') AND available_at<=CURRENT_TIMESTAMP
        ORDER BY queue_id
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE fbs_marking_queue q
      SET status='sending',attempts=q.attempts+1,lease_until=CURRENT_TIMESTAMP+INTERVAL '2 minutes',updated_at=CURRENT_TIMESTAMP
      FROM next_rows
      WHERE q.queue_id=next_rows.queue_id
      RETURNING q.*
    `, [limit]);
    return claimed.rows;
  });
}

function queueRetryDelay(attempts: number): number {
  return Math.min(300, Math.max(2, 2 ** Math.min(8, Math.max(1, attempts))));
}

async function markQueueSent(row: MarkingQueueRow) {
  await withPgTransaction(async (client) => {
    const updated = await client.query(`
      UPDATE fbs_marking_queue SET status='sent',value_payload='',lease_until=NULL,last_error='',
        sent_at=COALESCE(sent_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP
      WHERE queue_id=$1 AND status IN ('queued','sending','retry','sent')
      RETURNING queue_id
    `, [row.queue_id]);
    if (!updated.rowCount) return;
    await client.query(`
      UPDATE fbs_fulfillment_scans SET result='pending',message='DataMatrix передан WB, проверка продолжается'
      WHERE id=$1 AND result='pending'
    `, [row.scan_id]);
    await event(client, "metadata_sent", {
      orderId: row.order_id,
      supplyId: row.supply_id || undefined,
      status: "warning",
      message: "DataMatrix передан WB, проверка продолжается",
      details: { scanId: row.scan_id, attempt: row.attempts },
    });
  });
}

async function markQueueRetry(row: MarkingQueueRow, message: string) {
  const retrySeconds = queueRetryDelay(row.attempts);
  await withPgTransaction(async (client) => {
    const updated = await client.query(`
      UPDATE fbs_marking_queue SET status='retry',lease_until=NULL,last_error=$2,
        available_at=CURRENT_TIMESTAMP+($3::text || ' seconds')::interval,updated_at=CURRENT_TIMESTAMP
      WHERE queue_id=$1 AND status='sending'
      RETURNING queue_id
    `, [row.queue_id, message, retrySeconds]);
    if (!updated.rowCount) return;
    await client.query(`UPDATE fbs_fulfillment_scans SET message=$2 WHERE id=$1`, [row.scan_id, `Временная задержка WB. Повторим автоматически: ${message}`]);
  });
}

async function markQueueError(row: MarkingQueueRow, message: string) {
  const orders = await pgRows<OrderRow>(`SELECT * FROM fbs_fulfillment_orders WHERE order_id=?`, [row.order_id]);
  const decisions = orders[0] ? pendingSgtinDecisions(orders[0]) : [];
  const sgtin = decisions.find((detail) => detail.type === "sgtin");
  if (sgtin) Object.assign(sgtin, { decision: "sgtinQueueError", message });
  await withPgTransaction(async (client) => {
    const updated = await client.query(`
      UPDATE fbs_marking_queue SET status='error',value_payload='',lease_until=NULL,last_error=$2,updated_at=CURRENT_TIMESTAMP
      WHERE queue_id=$1 AND status='sending'
      RETURNING queue_id
    `, [row.queue_id, message]);
    if (!updated.rowCount) return;
    await client.query(`UPDATE fbs_fulfillment_scans SET result='error',message=$2 WHERE id=$1`, [row.scan_id, message]);
    if (decisions.length) {
      await client.query(`UPDATE fbs_fulfillment_orders SET metadata_decisions=$2::jsonb,metadata_checked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE order_id=$1`, [row.order_id, JSON.stringify(decisions)]);
    }
    await event(client, "metadata_rejected", {
      orderId: row.order_id,
      supplyId: row.supply_id || undefined,
      status: "error",
      message,
      details: { scanId: row.scan_id, attempt: row.attempts },
    });
  });
}

async function recoverQueueSendFromLive(row: MarkingQueueRow): Promise<boolean> {
  try {
    const metadata = await getFbsOrderMeta([row.order_id]);
    const live = liveMetadataOrder(metadata, row.order_id);
    if (!live) return false;
    const state = getFbsLiveMetaState(live, "sgtin");
    const sameValue = state.values.length === 0 || state.values.some((value) => sameFbsDataMatrixIdentity(row.value_payload, value));
    if (!sameValue || !["pending", "filled"].includes(state.state)) return false;
    await persistLiveMetadata(metadata);
    if (state.state === "pending") await markQueueSent(row);
    return true;
  } catch {
    return false;
  }
}

async function sendFbsMarkingQueueRow(row: MarkingQueueRow) {
  try {
    await putFbsOrderMeta(row.order_id, "sgtin", row.value_payload);
    await markQueueSent(row);
  } catch (error) {
    if (await recoverQueueSendFromLive(row)) return;
    const message = safeMetadataError(error, row.value_payload);
    const permanent = error instanceof FbsWbApiError && [400, 404, 409].includes(error.status);
    if (permanent) await markQueueError(row, message);
    else await markQueueRetry(row, message);
  }
}

function matchingDeadlineExceededValue(row: MarkingQueueRow, values: string[]): string {
  for (const candidate of values) {
    try {
      const normalized = normalizeFbsDataMatrix(candidate);
      const hash = crypto.createHash("sha256").update(normalized).digest("hex");
      if (hash === row.value_hash) return normalized;
    } catch {
      // A value that cannot be parsed or does not match the original scan must
      // never be silently attached to the order again.
    }
  }
  return "";
}

async function markDeadlineRetryError(row: MarkingQueueRow, message: string) {
  await withPgTransaction(async (client) => {
    const updated = await client.query(`
      UPDATE fbs_marking_queue
      SET status='error',value_payload='',lease_until=NULL,last_error=$2,updated_at=CURRENT_TIMESTAMP
      WHERE queue_id=$1 AND status='sent'
      RETURNING queue_id
    `, [row.queue_id, message]);
    if (!updated.rowCount) return;
    await client.query(`
      UPDATE fbs_fulfillment_scans SET result='error',message=$2
      WHERE id=$1 AND result='pending'
    `, [row.scan_id, message]);
    await event(client, "metadata_retry_failed", {
      orderId: row.order_id,
      supplyId: row.supply_id || undefined,
      status: "error",
      message,
      details: { scanId: row.scan_id, attempts: row.attempts },
    });
  });
}

async function prepareDeadlineExceededRetries(
  metadata: Awaited<ReturnType<typeof getFbsOrderMeta>>,
): Promise<Set<number>> {
  const preservePending = new Set<number>();
  const candidates = metadata.map((item) => ({
    orderId: metadataOrderId(item),
    liveState: getFbsLiveMetaState(item, "sgtin"),
  })).filter(({ orderId, liveState }) =>
    Number.isSafeInteger(orderId)
    && (liveState.decision === "deadlineexceeded" || liveState.state === "missing")
  );
  if (!candidates.length) return preservePending;
  const queueRows = await pgRows<MarkingQueueRow>(`
    SELECT DISTINCT ON (order_id) * FROM fbs_marking_queue
    WHERE order_id=ANY(?::bigint[]) AND status='sent'
    ORDER BY order_id,queue_id DESC
  `, [candidates.map(({ orderId }) => orderId)]);
  const queueByOrderId = new Map(queueRows.map((row) => [Number(row.order_id), row]));

  for (const { orderId, liveState } of candidates) {
    const row = queueByOrderId.get(orderId);
    if (!row) continue;

    // If WB already forgot the value after DELETE but the process stopped
    // before the row was re-queued, the durable payload completes recovery.
    if (liveState.state === "missing" && row.value_payload) {
      preservePending.add(orderId);
      const availableAt = new Date(row.available_at).getTime();
      if (Number.isFinite(availableAt) && availableAt > Date.now()) continue;
      await withPgTransaction(async (client) => {
        await client.query(`
          UPDATE fbs_marking_queue
          SET status='retry',available_at=CURRENT_TIMESTAMP+($2::text || ' seconds')::interval,
            lease_until=NULL,last_error='WB-код удалён, повторная загрузка возобновлена',updated_at=CURRENT_TIMESTAMP
          WHERE queue_id=$1 AND status='sent' AND value_payload<>''
        `, [row.queue_id, FBS_SGTIN_REUPLOAD_DELAY_SECONDS]);
      });
      continue;
    }

    if (liveState.decision !== "deadlineexceeded") continue;
    if (row.attempts >= MAX_FBS_SGTIN_VERIFICATION_ATTEMPTS) continue;

    preservePending.add(orderId);
    const availableAt = new Date(row.available_at).getTime();
    if (Number.isFinite(availableAt) && availableAt > Date.now()) continue;

    const value = row.value_payload || matchingDeadlineExceededValue(row, liveState.values);
    if (!value) {
      preservePending.delete(orderId);
      await markDeadlineRetryError(row, "Не проверено WB: не удалось безопасно восстановить исходный код для повторной отправки");
      continue;
    }

    const nextAttempt = row.attempts + 1;
    const retryMessage = `WB не завершил проверку. Автоматическая попытка ${nextAttempt} из ${MAX_FBS_SGTIN_VERIFICATION_ATTEMPTS}`;
    const claimed = await withPgTransaction(async (client) => {
      const updated = await client.query<MarkingQueueRow>(`
        UPDATE fbs_marking_queue
        SET value_payload=$2,available_at=CURRENT_TIMESTAMP+INTERVAL '2 minutes',last_error=$3,updated_at=CURRENT_TIMESTAMP
        WHERE queue_id=$1 AND status='sent' AND attempts=$4 AND available_at<=CURRENT_TIMESTAMP
        RETURNING *
      `, [row.queue_id, value, retryMessage, row.attempts]);
      if (!updated.rows[0]) return false;
      await client.query(`
        UPDATE fbs_fulfillment_scans SET message=$2
        WHERE id=$1 AND result='pending'
      `, [row.scan_id, retryMessage]);
      return true;
    });
    if (!claimed) continue;

    try {
      await deleteFbsOrderMeta(orderId, "sgtin");
      await withPgTransaction(async (client) => {
        const updated = await client.query(`
          UPDATE fbs_marking_queue
          SET status='retry',available_at=CURRENT_TIMESTAMP+($2::text || ' seconds')::interval,
            lease_until=NULL,last_error=$3,updated_at=CURRENT_TIMESTAMP
          WHERE queue_id=$1 AND status='sent' AND attempts<$4
          RETURNING queue_id
        `, [row.queue_id, FBS_SGTIN_REUPLOAD_DELAY_SECONDS, retryMessage, MAX_FBS_SGTIN_VERIFICATION_ATTEMPTS]);
        if (!updated.rowCount) return;
        await event(client, "metadata_retry_scheduled", {
          orderId,
          supplyId: row.supply_id || undefined,
          status: "warning",
          message: retryMessage,
          details: { scanId: row.scan_id, nextAttempt, maxAttempts: MAX_FBS_SGTIN_VERIFICATION_ATTEMPTS },
        });
      });
    } catch (error) {
      const message = `Не удалось автоматически перезапустить проверку WB: ${safeMetadataError(error, value)}`;
      const permanent = error instanceof FbsWbApiError && [400, 404, 409].includes(error.status);
      if (permanent) {
        preservePending.delete(orderId);
        await markDeadlineRetryError(row, message);
      } else {
        await withPgTransaction(async (client) => {
          await client.query(`
            UPDATE fbs_marking_queue
            SET available_at=CURRENT_TIMESTAMP+($2::text || ' seconds')::interval,last_error=$3,updated_at=CURRENT_TIMESTAMP
            WHERE queue_id=$1 AND status='sent'
          `, [row.queue_id, FBS_SGTIN_RESET_RETRY_SECONDS, message]);
          await client.query(`
            UPDATE fbs_fulfillment_scans SET message=$2
            WHERE id=$1 AND result='pending'
          `, [row.scan_id, `${message}. Повторим автоматически`]);
        });
      }
    }
  }

  return preservePending;
}

async function verifySentFbsMarkingQueue() {
  const pending = await pgRows<{ order_id: number }>(`
    SELECT DISTINCT s.order_id
    FROM fbs_fulfillment_scans s
    LEFT JOIN fbs_marking_queue q ON q.scan_id=s.id
    WHERE s.scan_type='sgtin' AND s.result='pending'
      AND (q.queue_id IS NULL OR q.status='sent')
    ORDER BY s.order_id
    LIMIT 2000
  `);
  if (!pending.length) return;
  await verifyFbsMetadata(pending.map((row) => Number(row.order_id)));
}

async function drainFbsMarkingQueue() {
  const rows = await claimFbsMarkingQueue(50);
  await Promise.all(rows.map(async (row, index) => {
    if (index) await new Promise((resolve) => setTimeout(resolve, index * 70));
    await sendFbsMarkingQueueRow(row);
  }));
  try {
    await verifySentFbsMarkingQueue();
  } catch {
    // Submitted values remain durable and the next poll repeats the batch check.
  }
}

export async function getFbsMarkingQueueStatus(orderIds: number[]): Promise<FbsMarkingQueueStatus[]> {
  const ids = Array.from(new Set(orderIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0)));
  if (!ids.length) return [];
  return pgRows<FbsMarkingQueueStatus>(`
    SELECT o.order_id,o.metadata_decisions,
      q.status AS queue_status,q.last_error AS message,q.updated_at
    FROM fbs_fulfillment_orders o
    LEFT JOIN LATERAL (
      SELECT status,last_error,updated_at FROM fbs_marking_queue
      WHERE order_id=o.order_id ORDER BY queue_id DESC LIMIT 1
    ) q ON TRUE
    WHERE o.order_id=ANY(?::bigint[])
    ORDER BY o.order_id
  `, [ids]);
}

export async function processFbsMarkingQueue(orderIds: number[]) {
  const organizationId = getActiveOrganizationId();
  if (!organizationId) throw new Error("Organization context is required for FBS marking queue");
  let running = markingQueueRuns.get(organizationId);
  if (!running) {
    running = drainFbsMarkingQueue().finally(() => markingQueueRuns.delete(organizationId));
    markingQueueRuns.set(organizationId, running);
  }
  await running;
  return { statuses: await getFbsMarkingQueueStatus(orderIds) };
}

export async function attachFbsMetadata(
  orderId: number,
  type: FbsMetaType,
  rawValue: string,
  options: { waitForVerification?: boolean } = {},
) {
  if (!META_TYPES.has(type)) throw new Error("Неподдерживаемый тип метаданных");
  let value = type === "sgtin" ? normalizeFbsDataMatrix(rawValue) : scannerValue(rawValue);
  if (!value) throw new Error("Пустое значение маркировки");
  const rows = await pgRows<OrderRow>(`SELECT * FROM fbs_fulfillment_orders WHERE order_id=?`, [orderId]);
  const order = rows[0];
  if (!order) throw new Error("Этикетка не найдена в рабочей поставке");
  if (order.supplier_status !== "confirm") throw new Error("Маркировку можно закрепить только за этикеткой в статусе «На сборке»");
  const liveMetadata = await getFbsOrderMeta([orderId]);
  const live = liveMetadata.find((item) => Number(item.orderId || item.id) === orderId);
  if (!live) throw new Error(`${fbsLabelText(order)}: WB не вернул состояние маркировки. Повторите проверку позже`);
  await reconcileFbsLiveMetadata(liveMetadata);
  const liveAvailable = getFbsLiveAvailableMeta(live);
  const allowed = new Set([
    ...jsonArray(order.required_meta),
    ...jsonArray(order.optional_meta),
    ...liveAvailable,
    ...getFbsEffectiveRequiredMeta(order.required_meta, order.optional_meta, order.product_name, order.vendor_code, liveAvailable),
  ]);
  if (!allowed.has(type)) {
    throw new Error(`WB не разрешил метаданные ${type} для этой этикетки`);
  }

  let hash = crypto.createHash("sha256").update(value).digest("hex");
  let parsedDataMatrix: ReturnType<typeof parseFbsDataMatrix> | null = null;
  let reservedScanId: number | null = null;
  if (type === "sgtin") {
    try {
      parsedDataMatrix = parseFbsDataMatrix(value);
      value = parsedDataMatrix.value;
      hash = crypto.createHash("sha256").update(value).digest("hex");
      const stickerNumber = text(order.raw_json?._mphubStickerNumber);
      const forbiddenLabels = new Set([
        ...jsonArray(order.skus),
        text(order.sticker_barcode),
        stickerNumber,
        String(order.order_id),
      ].filter(Boolean));
      if (forbiddenLabels.has(value)) {
        throw new Error("Отсканирован штрихкод товара или стикер WB, а не DataMatrix «Честного знака»");
      }
      const existingState = getFbsLiveMetaState(live, "sgtin");
      if (existingState.state === "filled") {
        if (existingState.values.some((current) => sameFbsDataMatrixIdentity(value, current))) {
          return { verification: "filled", metadata: liveMetadata };
        }
        throw new Error("У этой этикетки уже есть принятый WB код маркировки. Сначала удалите ошибочный код");
      }
      if (existingState.state === "pending" && existingState.values.some((current) => sameFbsDataMatrixIdentity(value, current))) {
        return { verification: "pending", metadata: liveMetadata };
      }
      const reservation = await reserveFbsSgtinScan(order, hash, value);
      reservedScanId = reservation.scanId;
      if (reservation.existing) return { verification: "pending" as const };
    } catch (error) {
      const message = safeMetadataError(error, value);
      await recordFbsMetadataScan(order, type, hash, value, "error", message, reservedScanId);
      throw new Error(message);
    }
  }

  let sentToWb = false;
  try {
    await putFbsOrderMeta(orderId, type, value);
    sentToWb = true;
    if (type === "sgtin") {
      if (options.waitForVerification === false) {
        const safeDecisions = (Array.isArray(order.metadata_decisions) ? order.metadata_decisions : [])
          .filter((detail) => ![detail.key, detail.type, detail.name, detail.metaType].some((item) => String(item || "").toLowerCase() === "sgtin"));
        safeDecisions.push({ type: "sgtin", decision: "pending" });
        await withPgTransaction(async (client) => {
          await client.query(`UPDATE fbs_fulfillment_orders SET metadata_decisions=$2::jsonb,metadata_checked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE order_id=$1`, [orderId, JSON.stringify(safeDecisions)]);
        });
        await recordFbsMetadataScan(order, type, hash, value, "pending", "DataMatrix передан WB, проверка продолжается", reservedScanId);
        return { verification: "pending" as const };
      }
      const checked = await waitForAcceptedFbsDataMatrix(orderId, value);
      if (checked.verification === "pending") {
        await recordFbsMetadataScan(order, type, hash, value, "pending", "DataMatrix передан WB, проверка продолжается", reservedScanId);
        return { verification: "pending", metadata: [checked.metadata] };
      }
      await recordFbsMetadataScan(order, type, hash, value, "ok", "DataMatrix проверен и принят WB", reservedScanId);
      return { verification: "filled", metadata: [checked.metadata] };
    }
    await recordFbsMetadataScan(order, type, hash, value, "ok", "Принято WB");
  } catch (error) {
    let cleanupMessage = "";
    if (type === "sgtin" && sentToWb) {
      try {
        await deleteFbsOrderMeta(orderId, "sgtin");
        const cleared = await getFbsOrderMeta([orderId]);
        if (cleared.length) await reconcileFbsLiveMetadata(cleared);
        cleanupMessage = " Код удалён из этикетки WB.";
      } catch (cleanupError) {
        cleanupMessage = ` Автоудаление не подтверждено: ${safeMetadataError(cleanupError, value)}. Удалите код кнопкой вручную.`;
      }
    }
    const message = `${safeMetadataError(error, value)}${cleanupMessage}`;
    await recordFbsMetadataScan(order, type, hash, value, "error", message, reservedScanId);
    throw new Error(message);
  }
  return verifyFbsMetadata([orderId]);
}

export async function removeFbsMetadata(orderId: number, type: Exclude<FbsMetaType, "expiration">) {
  if (!META_TYPES.has(type)) throw new Error("Эти метаданные нельзя удалить");
  await deleteFbsOrderMeta(orderId, type);
  await withPgTransaction(async (client) => {
    await client.query(`UPDATE fbs_fulfillment_orders SET metadata_decisions='[]'::jsonb,metadata_checked_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE order_id=$1`, [orderId]);
    await event(client, "metadata_removed", { orderId, message: `${type}: удалено на WB` });
  });
  try {
    await verifyFbsMetadata([orderId]);
  } catch (error) {
    await withPgTransaction(async (client) => event(client, "metadata_verify_warning", {
      orderId,
      status: "warning",
      message: `Код удалён, но повторная проверка WB недоступна: ${error instanceof Error ? error.message : String(error)}`,
    }));
  }
}

export async function cancelFbsFulfillmentOrder(orderId: number) {
  const rows = await pgRows<OrderRow>(`SELECT * FROM fbs_fulfillment_orders WHERE order_id=?`, [orderId]);
  if (!rows[0]) throw new Error("Заказ не найден");
  if (!["new", "confirm"].includes(rows[0].supplier_status)) throw new Error("Отменить можно только новый заказ или заказ на сборке");
  await cancelFbsOrder(orderId);
  await withPgTransaction(async (client) => {
    await client.query(`UPDATE fbs_fulfillment_orders SET supplier_status='cancel',supply_id=NULL,updated_at=CURRENT_TIMESTAMP WHERE order_id=$1`, [orderId]);
    await event(client, "order_cancelled", { orderId, supplyId: rows[0].supply_id || undefined, status: "warning", message: "Заказ отменён продавцом на WB" });
  });
}

function metadataOrderId(item: { orderId?: number; id?: number }): number {
  return Number(item.orderId || item.id);
}

async function persistLiveMetadata(
  metadata: Awaited<ReturnType<typeof getFbsOrderMeta>>,
  preservePendingOrderIds: ReadonlySet<number> = new Set<number>(),
) {
  const ids = metadata.map(metadataOrderId).filter(Number.isSafeInteger);
  if (!ids.length) return;
  const orders = await pgRows<OrderRow>(`SELECT * FROM fbs_fulfillment_orders WHERE order_id = ANY(?::bigint[])`, [ids]);
  const orderMap = new Map(orders.map((order) => [Number(order.order_id), order]));
  const pendingScans = await pgRows<{ order_id: number }>(`
    SELECT DISTINCT order_id
    FROM fbs_fulfillment_scans
    WHERE order_id=ANY(?::bigint[]) AND scan_type='sgtin' AND result='pending'
  `, [ids]);
  const pendingScanIds = new Set(pendingScans.map((row) => Number(row.order_id)));
  await withPgTransaction(async (client) => {
    for (const item of metadata) {
      const id = metadataOrderId(item);
      const order = orderMap.get(id);
      if (!order) continue;
      const liveAvailable = getFbsLiveAvailableMeta(item);
      const optionalMeta = Array.from(new Set([
        ...jsonArray(order.optional_meta),
        ...liveAvailable.filter((type) => type === "sgtin"),
      ]));
      const liveSgtin = getFbsLiveMetaState(item, "sgtin");
      const decisions = getFbsSafeMetaDecisions(item);
      if (preservePendingOrderIds.has(id)) {
        const withoutSgtin = decisions.filter((decision) => decision.type !== "sgtin");
        withoutSgtin.push({ type: "sgtin", decision: "pending" });
        decisions.splice(0, decisions.length, ...withoutSgtin);
      }
      // WB can temporarily answer `missing` for a DataMatrix it has already
      // accepted for asynchronous processing. Keep the durable scan ledger as
      // `pending` across reloads so the UI continues polling instead of asking
      // the operator to scan the same physical code again.
      if (pendingScanIds.has(id) && liveSgtin.state === "missing") {
        const withoutSgtin = decisions.filter((decision) => decision.type !== "sgtin");
        withoutSgtin.push({ type: "sgtin", decision: "pending" });
        decisions.splice(0, decisions.length, ...withoutSgtin);
      }
      await client.query(`
        UPDATE fbs_fulfillment_orders SET
          optional_meta=$2::jsonb,
          metadata_decisions=$3::jsonb,
          metadata_checked_at=CURRENT_TIMESTAMP,
          updated_at=CURRENT_TIMESTAMP
        WHERE order_id=$1
      `, [id, JSON.stringify(optionalMeta), JSON.stringify(decisions)]);
      if (liveSgtin.state === "filled") {
        await client.query(`UPDATE fbs_fulfillment_scans SET result='ok',message='DataMatrix проверен и принят WB' WHERE order_id=$1 AND scan_type='sgtin' AND result='pending'`, [id]);
        await client.query(`
          UPDATE fbs_marking_queue SET status='verified',value_payload='',lease_until=NULL,last_error='',
            verified_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
          WHERE order_id=$1 AND status IN ('queued','sending','sent','retry')
        `, [id]);
      } else if (liveSgtin.state === "rejected" && !preservePendingOrderIds.has(id)) {
        const message = wbMetadataDecisionMessage(liveSgtin.decision);
        await client.query(`UPDATE fbs_fulfillment_scans SET result='error',message=$2 WHERE order_id=$1 AND scan_type='sgtin' AND result='pending'`, [id, message]);
        await client.query(`
          UPDATE fbs_marking_queue SET status='error',value_payload='',lease_until=NULL,last_error=$2,updated_at=CURRENT_TIMESTAMP
          WHERE order_id=$1 AND status IN ('queued','sending','sent','retry')
        `, [id, message]);
      }
    }
  });
}

async function reconcileFbsLiveMetadata(metadata: Awaited<ReturnType<typeof getFbsOrderMeta>>) {
  const preservePendingOrderIds = await prepareDeadlineExceededRetries(metadata);
  await persistLiveMetadata(metadata, preservePendingOrderIds);
}

function liveMarkingErrors(
  order: OrderRow,
  live: Awaited<ReturnType<typeof getFbsOrderMeta>>[number] | undefined,
  markingPolicy: FbsMarkingPolicy,
): string[] {
  const available = live ? getFbsLiveAvailableMeta(live) : [];
  const required = getFbsEffectiveRequiredMeta(
    order.required_meta,
    order.optional_meta,
    order.product_name,
    order.vendor_code,
    available,
    markingPolicy,
  );
  if (!required.length) return [];
  if (!live) return ["WB не вернул состояние маркировки — операция заблокирована"];
  const errors: string[] = [];
  for (const type of required) {
    if (type === "sgtin" && !available.includes("sgtin")) {
      errors.push("WB не вернул поле DataMatrix — операция заблокирована");
      continue;
    }
    if (!isFbsLiveMetaFilled(live, type)) {
      errors.push(type === "sgtin" ? "DataMatrix не введён или не принят WB" : `${type}: значение не принято WB`);
    }
  }
  return errors;
}

export async function verifyFbsMetadata(orderIds: number[]) {
  const ids = assertOrderIds(orderIds);
  const metadata = await getFbsOrderMeta(ids);
  const returned = new Set(metadata.map(metadataOrderId).filter(Number.isSafeInteger));
  const missing = ids.filter((id) => !returned.has(id));
  if (missing.length) throw new Error(`WB не вернул состояние маркировки для ${missing.length} этикеток`);
  await reconcileFbsLiveMetadata(metadata);
  return metadata;
}

export async function printFbsOrderStickers(orderIds: number[], width: 58 | 40 = 58) {
  const ids = assertOrderIds(orderIds);
  const stickers = await getFbsOrderStickers(ids, "png", width);
  await withPgTransaction(async (client) => {
    for (let index = 0; index < stickers.length; index += 1) {
      const sticker = stickers[index];
      const orderId = Number(sticker.orderId || ids[index]);
      if (!Number.isSafeInteger(orderId)) continue;
      const stickerNumber = `${String(sticker.partA ?? "").trim()}${String(sticker.partB ?? "").trim()}`;
      await client.query(`UPDATE fbs_fulfillment_orders SET sticker_printed_at=CURRENT_TIMESTAMP,sticker_barcode=$2,raw_json=jsonb_set(COALESCE(raw_json,'{}'::jsonb),'{_mphubStickerNumber}',to_jsonb($3::text),TRUE),updated_at=CURRENT_TIMESTAMP WHERE order_id=$1`, [orderId, sticker.barcode || "", stickerNumber]);
      await event(client, "sticker_printed", { orderId, message: `${width}×${width === 58 ? 40 : 30} мм` });
    }
  });
  return stickers;
}

export async function markFbsPacked(orderIds: number[]) {
  const ids = assertOrderIds(orderIds);
  const orders = await pgRows<OrderRow>(`SELECT * FROM fbs_fulfillment_orders WHERE order_id = ANY(?::bigint[]) ORDER BY order_id`, [ids]);
  if (orders.length !== ids.length) throw new Error("Не все этикетки найдены в текущем кабинете");
  const incomplete = orders.find((order) => !order.picked_at || !order.sticker_printed_at);
  if (incomplete) throw new Error(`${fbsLabelText(incomplete)}: сначала завершите сборку и печать`);

  const markingPolicy = await getFbsMarkingPolicy();
  const metadataOrderIds = orders
    .filter((order) => hasFbsOperatorMetadata(
      order.required_meta,
      order.optional_meta,
      order.product_name,
      order.vendor_code,
      markingPolicy,
    ))
    .map((order) => Number(order.order_id));
  const metadata = metadataOrderIds.length ? await getFbsOrderMeta(metadataOrderIds) : [];
  const metaMap = new Map(metadata.map((row) => [metadataOrderId(row), row]));
  if (metadataOrderIds.some((id) => !metaMap.has(id))) {
    throw new Error("WB не вернул состояние маркировки части этикеток. Переход к отгрузке заблокирован");
  }
  for (const order of orders) {
    const markingErrors = liveMarkingErrors(order, metaMap.get(Number(order.order_id)), markingPolicy);
    if (markingErrors.length) throw new Error(`${fbsLabelText(order)} (${order.vendor_code}): ${markingErrors.join(", ")}`);
    if (getFbsReviewOptionalMeta(order.optional_meta).length > 0 && !order.optional_meta_reviewed_at) {
      throw new Error(`${fbsLabelText(order)}: подтвердите проверку необязательных данных WB`);
    }
  }

  await reconcileFbsLiveMetadata(metadata);
  await withPgTransaction(async (client) => {
    await client.query(`UPDATE fbs_fulfillment_orders SET packed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE order_id = ANY($1::bigint[])`, [ids]);
    await event(client, "orders_ready_for_shipping", { message: `${ids.length} этикеток готовы к отгрузке`, details: { orderIds: ids } });
  });
}

export async function reviewFbsOptionalMeta(orderId: number) {
  await withPgTransaction(async (client) => {
    const row = await client.query<OrderRow>(`SELECT * FROM fbs_fulfillment_orders WHERE order_id=$1 FOR UPDATE`, [orderId]);
    if (!row.rows[0]) throw new Error("Этикетка не найдена");
    await client.query(`UPDATE fbs_fulfillment_orders SET optional_meta_reviewed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE order_id=$1`, [orderId]);
    await event(client, "optional_meta_reviewed", { orderId, supplyId: row.rows[0].supply_id || undefined, message: "Оператор подтвердил проверку необязательной маркировки" });
  });
}

export async function preflightFbsSupply(supplyId: string) {
  const [orders, supplies] = await Promise.all([
    pgRows<OrderRow>(`SELECT * FROM fbs_fulfillment_orders WHERE supply_id=? ORDER BY order_id`, [supplyId]),
    pgRows<{
      delivery_mode: string;
      box_stickers_printed_ids: string[];
      pvz_rules_confirmed_at: string | null;
    }>(`SELECT delivery_mode,box_stickers_printed_ids,pvz_rules_confirmed_at FROM fbs_fulfillment_supplies WHERE supply_id=?`, [supplyId]),
  ]);
  if (!orders.length) return { ready: false, errors: ["В поставке нет заказов"], orders: [] };
  const statuses = await getFbsOrderStatuses(orders.map((row) => Number(row.order_id)));
  const statusMap = new Map(statuses.map((row) => [Number(row.id), row]));
  const markingPolicy = await getFbsMarkingPolicy();
  const metadataOrderIds = orders
    .filter((order) => hasFbsOperatorMetadata(
      order.required_meta,
      order.optional_meta,
      order.product_name,
      order.vendor_code,
      markingPolicy,
    ))
    .map((row) => Number(row.order_id));
  const metadata = metadataOrderIds.length ? await getFbsOrderMeta(metadataOrderIds) : [];
  const metaMap = new Map(metadata.map((row) => [metadataOrderId(row), row]));
  const errors: string[] = [];
  const checks = orders.map((order) => {
    const rowErrors: string[] = [];
    const status = statusMap.get(Number(order.order_id));
    if (status?.supplierStatus !== "confirm") rowErrors.push(`статус WB: ${status?.supplierStatus || "неизвестен"}`);
    if (!order.picked_at) rowErrors.push("товар не отсканирован");
    if (!order.sticker_printed_at) rowErrors.push("стикер не напечатан");
    if (!order.packed_at) rowErrors.push("не завершена подготовка к отгрузке");
    const live = metaMap.get(Number(order.order_id));
    rowErrors.push(...liveMarkingErrors(order, live, markingPolicy));
    if (getFbsReviewOptionalMeta(order.optional_meta).length > 0 && !order.optional_meta_reviewed_at) {
      rowErrors.push("не подтверждена проверка необязательной маркировки");
    }
    if (rowErrors.length) errors.push(`${fbsLabelText(order)}: ${rowErrors.join(", ")}`);
    return { orderId: order.order_id, ready: rowErrors.length === 0, errors: rowErrors };
  });
  const supply = supplies[0];
  if (!supply) {
    errors.push("Поставка не найдена в MpHub");
  } else if (supply.delivery_mode === "pvz") {
    // Do not reuse the order-selection flag here. WB may return it as false
    // after the order is already attached, which must not block a ready supply.
    // The final authority is WB's supply delivery endpoint below.
    try {
      const liveBoxIds = await getFbsSupplyBoxes(supplyId);
      const printedIds = new Set(jsonArray(supply.box_stickers_printed_ids));
      const missingPrintedIds = liveBoxIds.filter((id) => !printedIds.has(id));
      await withPgTransaction(async (client) => {
        await client.query(`UPDATE fbs_fulfillment_supplies SET boxes_count=$2,box_ids=$3::jsonb,updated_at=CURRENT_TIMESTAMP WHERE supply_id=$1`, [supplyId, liveBoxIds.length, JSON.stringify(liveBoxIds)]);
      });
      if (!liveBoxIds.length) errors.push("Не созданы грузоместа ПВЗ");
      else if (missingPrintedIds.length) errors.push(`Не напечатаны QR грузомест: ${missingPrintedIds.length}`);
    } catch (error) {
      errors.push(`WB не подтвердил грузоместа: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!supply.pvz_rules_confirmed_at) errors.push("Не подтверждены требования WB к коробам и зоне ПВЗ");
  }
  await reconcileFbsLiveMetadata(metadata);
  await withPgTransaction(async (client) => {
    await event(client, "preflight", { supplyId, status: errors.length ? "error" : "ok", message: errors.length ? `${errors.length} этикеток требуют внимания` : "Все проверки пройдены" });
  });
  return { ready: errors.length === 0, errors, orders: checks };
}

export async function deliverReadyFbsSupply(supplyId: string) {
  const check = await preflightFbsSupply(supplyId);
  if (!check.ready) throw new Error(`Поставка не готова: ${check.errors.slice(0, 5).join("; ")}`);
  const supplyRows = await pgRows<{
    delivery_mode: string;
    boxes_count: number;
    box_ids: string[];
    box_stickers_printed_ids: string[];
    pvz_rules_confirmed_at: string | null;
  }>(`SELECT delivery_mode,boxes_count,box_ids,box_stickers_printed_ids,pvz_rules_confirmed_at FROM fbs_fulfillment_supplies WHERE supply_id=?`, [supplyId]);
  const supply = supplyRows[0];
  if (!supply) throw new Error("Поставка не найдена");
  if (supply.delivery_mode === "pvz") {
    const activeBoxJobs = await pgRows<{ job_id: string }>(`
      SELECT job_id FROM fbs_print_jobs
      WHERE supply_id=? AND group_key LIKE 'box-qr:%' AND status IN ('queued','printing','paused')
      LIMIT 1
    `, [supplyId]);
    if (activeBoxJobs[0]) throw new Error("Дождитесь завершения печати QR грузомест");
    const liveBoxIds = await getFbsSupplyBoxes(supplyId);
    const printedIds = new Set(jsonArray(supply.box_stickers_printed_ids));
    const missingPrintedIds = liveBoxIds.filter((id) => !printedIds.has(id));
    await withPgTransaction(async (client) => {
      await client.query(`UPDATE fbs_fulfillment_supplies SET boxes_count=$2,box_ids=$3::jsonb,updated_at=CURRENT_TIMESTAMP WHERE supply_id=$1`, [supplyId, liveBoxIds.length, JSON.stringify(liveBoxIds)]);
    });
    if (!liveBoxIds.length) throw new Error("Для ПВЗ сначала создайте хотя бы одно грузоместо");
    if (missingPrintedIds.length) throw new Error(`Сначала напечатайте QR всех грузомест: не подтверждено ${missingPrintedIds.length}`);
    if (!supply.pvz_rules_confirmed_at) throw new Error("Подтвердите требования WB к коробам и зоне выбранного ПВЗ");
  }
  await deliverFbsSupply(supplyId);
  await withPgTransaction(async (client) => {
    await client.query(`UPDATE fbs_fulfillment_supplies SET done=TRUE,closed_at_wb=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE supply_id=$1`, [supplyId]);
    await client.query(`UPDATE fbs_fulfillment_orders SET supplier_status='complete',updated_at=CURRENT_TIMESTAMP WHERE supply_id=$1`, [supplyId]);
    await event(client, "supply_delivered", { supplyId, message: "Поставка необратимо передана в доставку" });
  });
}

export async function createFbsBoxes(supplyId: string, amount: number) {
  if (!Number.isInteger(amount) || amount < 1 || amount > 1000) throw new Error("Количество грузомест: от 1 до 1000");
  const supply = await pgRows<{ order_count: number; boxes_count: number; delivery_mode: string; done: boolean; box_stickers_printed_ids: string[] }>(`SELECT order_count,boxes_count,delivery_mode,done,box_stickers_printed_ids FROM fbs_fulfillment_supplies WHERE supply_id=?`, [supplyId]);
  if (!supply[0]) throw new Error("Поставка не найдена");
  if (supply[0].done) throw new Error("Поставка уже передана в доставку, менять грузоместа нельзя");
  if (supply[0].delivery_mode !== "pvz") throw new Error("Грузоместа создаются только для поставок в ПВЗ");
  const maximumPhysicalBoxes = Math.floor(Number(supply[0].order_count) / 2);
  if (maximumPhysicalBoxes < 1) throw new Error("WB требует не меньше двух заказов в каждом коробе ПВЗ. Эту поставку везите на склад / СЦ");
  if (Number(supply[0].boxes_count) + amount > maximumPhysicalBoxes) {
    throw new Error(`В каждом коробе ПВЗ должно быть минимум 2 заказа. Для этой поставки максимум ${maximumPhysicalBoxes} грузомест`);
  }
  const activeBoxJobs = await pgRows<{ job_id: string }>(`
    SELECT job_id FROM fbs_print_jobs
    WHERE supply_id=? AND group_key LIKE 'box-qr:%' AND status IN ('queued','printing','paused')
    LIMIT 1
  `, [supplyId]);
  if (activeBoxJobs[0]) throw new Error("Сначала завершите или восстановите текущую печать QR грузомест");
  const ids = await addFbsSupplyBoxes(supplyId, amount);
  const all = await getFbsSupplyBoxes(supplyId);
  const preservedPrintedIds = jsonArray(supply[0].box_stickers_printed_ids).filter((id) => all.includes(id));
  await withPgTransaction(async (client) => {
    await client.query(`
      UPDATE fbs_fulfillment_supplies SET
        boxes_count=$2,box_ids=$3::jsonb,
        box_stickers_printed_ids=$4::jsonb,box_stickers_printed_count=$5,
        box_stickers_printed_at=CASE WHEN $5=$2 AND $2>0 THEN box_stickers_printed_at ELSE NULL END,
        pvz_rules_confirmed_at=NULL,updated_at=CURRENT_TIMESTAMP
      WHERE supply_id=$1
    `, [supplyId, all.length, JSON.stringify(all), JSON.stringify(preservedPrintedIds), preservedPrintedIds.length]);
    await event(client, "boxes_created", { supplyId, message: `Создано грузомест: ${ids.length}` });
  });
  return all;
}

export async function deleteAllFbsBoxes(supplyId: string) {
  const supplies = await pgRows<{ delivery_mode: string; done: boolean }>(`SELECT delivery_mode,done FROM fbs_fulfillment_supplies WHERE supply_id=?`, [supplyId]);
  if (!supplies[0]) throw new Error("Поставка не найдена");
  if (supplies[0].done) throw new Error("Поставка уже передана в доставку, менять грузоместа нельзя");
  if (supplies[0].delivery_mode !== "pvz") throw new Error("У этой поставки нет грузомест ПВЗ");
  const activeBoxJobs = await pgRows<{ job_id: string }>(`
    SELECT job_id FROM fbs_print_jobs
    WHERE supply_id=? AND group_key LIKE 'box-qr:%' AND status IN ('queued','printing','paused')
    LIMIT 1
  `, [supplyId]);
  if (activeBoxJobs[0]) throw new Error("Сначала завершите или восстановите текущую печать QR грузомест");
  const ids = await getFbsSupplyBoxes(supplyId);
  if (ids.length) await deleteFbsSupplyBoxes(supplyId, ids);
  const liveIds = await getFbsSupplyBoxes(supplyId);
  if (liveIds.length) throw new Error(`WB не удалил ${liveIds.length} грузомест. Обновите данные и повторите`);
  await withPgTransaction(async (client) => {
    await client.query(`
      UPDATE fbs_fulfillment_supplies SET
        boxes_count=0,box_ids='[]'::jsonb,box_stickers_printed_ids='[]'::jsonb,
        box_stickers_printed_count=0,box_stickers_printed_at=NULL,pvz_rules_confirmed_at=NULL,
        updated_at=CURRENT_TIMESTAMP
      WHERE supply_id=$1
    `, [supplyId]);
    await client.query(`
      UPDATE fbs_print_jobs SET status='cancelled',last_error='Грузоместа удалены',updated_at=CURRENT_TIMESTAMP
      WHERE supply_id=$1 AND group_key LIKE 'box-qr:%' AND status IN ('queued','printing','paused')
    `, [supplyId]);
    await event(client, "boxes_deleted", { supplyId, message: `Удалено грузомест: ${ids.length}` });
  });
  return { deleted: ids.length };
}

export async function confirmFbsPickupPointRules(supplyId: string) {
  const supplies = await pgRows<{ delivery_mode: string; done: boolean; boxes_count: number }>(`SELECT delivery_mode,done,boxes_count FROM fbs_fulfillment_supplies WHERE supply_id=?`, [supplyId]);
  if (!supplies[0]) throw new Error("Поставка не найдена");
  if (supplies[0].done) throw new Error("Поставка уже передана в доставку");
  if (supplies[0].delivery_mode !== "pvz") throw new Error("Подтверждение требуется только для поставки в ПВЗ");
  if (Number(supplies[0].boxes_count) < 1) throw new Error("Сначала создайте грузоместа");
  await withPgTransaction(async (client) => {
    await client.query(`UPDATE fbs_fulfillment_supplies SET pvz_rules_confirmed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE supply_id=$1`, [supplyId]);
    await event(client, "pvz_rules_confirmed", { supplyId, message: "Подтверждены требования WB к ПВЗ" });
  });
  return { confirmed: true };
}

export async function getFbsPassData() {
  const [offices, passes] = await Promise.all([getFbsPassOffices(), getFbsPasses()]);
  return { offices, passes };
}

export async function createFbsDeliveryPass(input: Omit<FbsPass, "id">) {
  if (!input.firstName.trim() || !input.lastName.trim()) throw new Error("Укажите имя и фамилию водителя");
  if (!/^[A-Za-zА-Яа-яЁё0-9]{6,9}$/.test(input.carNumber)) throw new Error("Номер машины: 6–9 букв и цифр без пробелов");
  const result = await createFbsPass(input);
  await withPgTransaction(async (client) => event(client, "pass_created", { message: `Пропуск ${result.id} создан на 48 часов`, details: { officeId: input.officeId } }));
  return result;
}
