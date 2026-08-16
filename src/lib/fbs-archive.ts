import { getActiveOrganizationId } from "@/lib/organization-context";
import { pgGet, pgRows, withPgClient, withPgTransaction } from "@/lib/postgres";
import { getWbApiKey } from "@/lib/wb-api-key";
import {
  getFbsArchivedOrders,
  getFbsCardsByNmIds,
  getFbsOrderStatuses,
  getFbsOrdersSince,
  getFbsSupplies,
  getFbsSupplyOrderIds,
  waitForFbsRateLimit,
  type FbsWbArchivedOrder,
  type FbsWbCard,
  type FbsWbOrder,
  type FbsWbSupply,
} from "@/lib/fbs-wb-api";
import { getWbImageUrl } from "@/lib/wb-image";

const STATISTICS_API = "https://statistics-api.wildberries.ru";
const SALES_LIMIT = 80_000;
const ARCHIVE_LOCK_KEY = 2_026_081_6;

export type FbsArchiveBucket =
  | "assembly"
  | "transit"
  | "pickup"
  | "sold"
  | "early_cancel"
  | "refused"
  | "returned"
  | "issue"
  | "unknown";

export type FbsArchiveSupplySummary = {
  supply_id: string;
  name: string;
  done: boolean;
  delivery_mode: string;
  destination_name: string;
  destination_office_id: number | null;
  created_at_wb: string | null;
  closed_at_wb: string | null;
  scan_at_wb: string | null;
  order_count: number;
  verified_order_count: number | null;
  actual_order_count: number;
  composition_checked_at: string | null;
  archive_synced_at: string | null;
  assembly: number;
  transit: number;
  pickup: number;
  sold: number;
  early_cancel: number;
  refused: number;
  returned: number;
  issue: number;
  unknown: number;
  mismatch: boolean;
};

export type FbsArchiveDay = Record<FbsArchiveBucket, number> & { date: string; total: number };

export type FbsArchiveOverview = {
  supplies: FbsArchiveSupplySummary[];
  days: FbsArchiveDay[];
  totals: Record<FbsArchiveBucket, number> & { orders: number; supplies: number };
  unknownStatuses: Array<{ supplier_status: string; wb_status: string; count: number }>;
  sync: Array<{
    source: string;
    last_success_at: string | null;
    last_error: string;
    last_error_at: string | null;
    updated_at: string;
  }>;
};

export type FbsArchiveOrderDetail = {
  order_id: number;
  order_uid: string;
  rid: string;
  sticker_id: number | null;
  sticker_barcode: string;
  supply_id: string;
  warehouse_id: number | null;
  warehouse_name: string;
  nm_id: number;
  chrt_id: number;
  vendor_code: string;
  product_name: string;
  size_name: string;
  photo_url: string;
  skus: string[];
  supplier_status: string;
  wb_status: string;
  bucket: FbsArchiveBucket;
  created_at_wb: string | null;
  status_synced_at: string | null;
  return_at: string | null;
  status_history: Array<{
    supplier_status: string;
    wb_status: string;
    source: string;
    first_observed_at: string;
    last_observed_at: string;
  }>;
};

type SyncResult = {
  skipped?: boolean;
  full: boolean;
  supplies: number;
  orders: number;
  archivedOrders: number;
  membershipsChecked: number;
  membershipErrors: number;
  salesMatched: number;
  warnings: string[];
};

type IncomingOrder = {
  orderId: number;
  orderUid: string;
  supplyId: string;
  warehouseId: number | null;
  nmId: number;
  chrtId: number;
  vendorCode: string;
  skus: string[];
  rid: string;
  stickerId: number | null;
  createdAt: string;
  supplierStatus: string;
  wbStatus: string;
  source: "live" | "archive";
  raw: Record<string, unknown>;
};

type SalesRow = {
  saleID?: string;
  srid?: string;
  date?: string;
  lastChangeDate?: string;
  [key: string]: unknown;
};

const BUCKET_SQL = `CASE
  WHEN ret.rid IS NOT NULL THEN 'returned'
  WHEN o.wb_status='sold' THEN 'sold'
  WHEN o.wb_status='declined_by_client' THEN 'early_cancel'
  WHEN o.wb_status='canceled_by_client' THEN 'refused'
  WHEN o.wb_status='ready_for_pickup' THEN 'pickup'
  WHEN o.wb_status IN ('defect','canceled') OR o.supplier_status='cancel' THEN 'issue'
  WHEN o.supplier_status IN ('new','confirm') THEN 'assembly'
  WHEN o.supplier_status='complete' AND o.wb_status IN (
    'waiting','sorted','postponed_delivery','accepted_by_carrier','sent_to_carrier'
  ) THEN 'transit'
  ELSE 'unknown'
END`;

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function safeInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function validDate(value: unknown): string {
  const date = new Date(String(value || ""));
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function startOfMonth(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1));
}

function addMonths(value: Date, months: number): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + months, 1));
}

function archiveMonths(from: Date, through: Date): Array<{ year: number; month: number }> {
  const result: Array<{ year: number; month: number }> = [];
  for (let cursor = startOfMonth(from); cursor <= startOfMonth(through); cursor = addMonths(cursor, 1)) {
    result.push({ year: cursor.getUTCFullYear(), month: cursor.getUTCMonth() + 1 });
    if (result.length > 120) break;
  }
  return result;
}

function normalizeRecentOrder(order: FbsWbOrder, status?: { supplierStatus?: string; wbStatus?: string }): IncomingOrder | null {
  const raw = order as Record<string, unknown>;
  const orderId = safeInteger(order.id);
  const nmId = safeInteger(order.nmId);
  const chrtId = safeInteger(order.chrtId);
  if (!orderId || !nmId || !chrtId) return null;
  return {
    orderId,
    orderUid: cleanText(order.orderUid),
    supplyId: cleanText(order.supplyId || raw.supplyID),
    warehouseId: safeInteger(order.warehouseId),
    nmId,
    chrtId,
    vendorCode: cleanText(order.article || raw.vendorCode),
    skus: stringArray(raw.skus),
    rid: cleanText(raw.rid),
    stickerId: safeInteger(raw.stickerId || raw.wbStickerId),
    createdAt: validDate(order.createdAt),
    supplierStatus: cleanText(status?.supplierStatus),
    wbStatus: cleanText(status?.wbStatus),
    source: "live",
    raw,
  };
}

function normalizeArchivedOrder(order: FbsWbArchivedOrder): IncomingOrder | null {
  const orderId = safeInteger(order.id);
  const nmId = safeInteger(order.product?.nmId);
  const chrtId = safeInteger(order.product?.chrtId);
  if (!orderId || !nmId || !chrtId) return null;
  return {
    orderId,
    orderUid: cleanText(order.orderUid),
    supplyId: cleanText(order.supplyId),
    warehouseId: safeInteger(order.warehouseId),
    nmId,
    chrtId,
    vendorCode: cleanText(order.product?.article),
    skus: stringArray(order.product?.skus),
    rid: cleanText(order.rid),
    stickerId: safeInteger(order.stickerId),
    createdAt: validDate(order.createdAt),
    supplierStatus: cleanText(order.status?.supplierStatus),
    wbStatus: cleanText(order.status?.wbStatus),
    source: "archive",
    raw: order,
  };
}

async function saveSyncState(source: string, input: { cursor?: unknown; error?: string; success?: boolean }) {
  await pgGet(`
    INSERT INTO fbs_archive_sync_state (
      source,cursor_json,last_success_at,last_error,last_error_at,updated_at
    ) VALUES (?,?::jsonb,CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE NULL END,?,CASE WHEN ?<>'' THEN CURRENT_TIMESTAMP ELSE NULL END,CURRENT_TIMESTAMP)
    ON CONFLICT (source) DO UPDATE SET
      cursor_json=EXCLUDED.cursor_json,
      last_success_at=CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE fbs_archive_sync_state.last_success_at END,
      last_error=EXCLUDED.last_error,
      last_error_at=CASE WHEN EXCLUDED.last_error<>'' THEN CURRENT_TIMESTAMP ELSE fbs_archive_sync_state.last_error_at END,
      updated_at=CURRENT_TIMESTAMP
    RETURNING source
  `, [source, JSON.stringify(input.cursor || {}), Boolean(input.success), input.error || "", input.error || "", Boolean(input.success)]);
}

async function upsertSupplies(supplies: FbsWbSupply[]) {
  await withPgTransaction(async (client) => {
    for (const supply of supplies) {
      await client.query(`
        INSERT INTO fbs_fulfillment_supplies (
          supply_id,name,done,is_b2b,cargo_type,destination_office_id,
          created_at_wb,closed_at_wb,scan_at_wb,raw_json,updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,CURRENT_TIMESTAMP)
        ON CONFLICT (supply_id) DO UPDATE SET
          name=EXCLUDED.name,done=EXCLUDED.done,is_b2b=EXCLUDED.is_b2b,
          cargo_type=EXCLUDED.cargo_type,destination_office_id=EXCLUDED.destination_office_id,
          created_at_wb=EXCLUDED.created_at_wb,closed_at_wb=EXCLUDED.closed_at_wb,
          scan_at_wb=EXCLUDED.scan_at_wb,raw_json=fbs_fulfillment_supplies.raw_json || EXCLUDED.raw_json,
          updated_at=CURRENT_TIMESTAMP
      `, [
        supply.id,
        supply.name || supply.id,
        Boolean(supply.done),
        supply.isB2b ?? null,
        supply.cargoType ?? null,
        supply.destinationOfficeId ?? null,
        validDate(supply.createdAt) || null,
        validDate(supply.closedAt) || null,
        validDate(supply.scanDt) || null,
        JSON.stringify(supply),
      ]);
    }
  });
}

async function upsertOrders(incoming: IncomingOrder[]): Promise<void> {
  if (!incoming.length) return;
  const nmIds = Array.from(new Set(incoming.map((order) => order.nmId)));
  const existing = await pgRows<{
    nm_id: number;
    chrt_id: number;
    vendor_code: string;
    product_name: string;
    size_name: string;
    photo_url: string;
    skus: string[];
  }>(`
    SELECT DISTINCT ON (nm_id,chrt_id)
      nm_id,chrt_id,vendor_code,product_name,size_name,photo_url,skus
    FROM fbs_fulfillment_orders
    WHERE nm_id=ANY(?::bigint[])
    ORDER BY nm_id,chrt_id,updated_at DESC
  `, [nmIds]);
  const existingByKey = new Map(existing.map((row) => [`${row.nm_id}:${row.chrt_id}`, row]));
  const cards = await getFbsCardsByNmIds(nmIds).catch(() => new Map<number, FbsWbCard>());

  await withPgTransaction(async (client) => {
    for (const order of incoming) {
      const card = cards.get(order.nmId);
      const variant = card?.variants.find((row) => row.chrtId === order.chrtId);
      const previous = existingByKey.get(`${order.nmId}:${order.chrtId}`);
      const vendorCode = card?.vendorCode || previous?.vendor_code || order.vendorCode;
      const productName = card?.title || previous?.product_name || vendorCode || String(order.nmId);
      const sizeName = variant?.sizeName || previous?.size_name || "";
      const photoUrl = card?.photoUrl || previous?.photo_url || getWbImageUrl(order.nmId, "small");
      const skus = order.skus.length ? order.skus : variant?.skus?.length ? variant.skus : previous?.skus || [];
      const hasStatus = Boolean(order.supplierStatus && order.wbStatus);
      await client.query(`
        INSERT INTO fbs_fulfillment_orders (
          order_id,order_uid,supply_id,warehouse_id,nm_id,chrt_id,
          vendor_code,product_name,size_name,photo_url,skus,
          supplier_status,wb_status,created_at_wb,raw_json,
          rid,sticker_id,status_synced_at,archive_source,updated_at
        ) VALUES (
          $1,$2,NULLIF($3,''),$4,$5,$6,$7,$8,$9,$10,$11::jsonb,
          COALESCE(NULLIF($12,''),'new'),COALESCE(NULLIF($13,''),'waiting'),$14,$15::jsonb,
          $16,$17,CASE WHEN $18 THEN CURRENT_TIMESTAMP ELSE NULL END,$19,CURRENT_TIMESTAMP
        )
        ON CONFLICT (order_id) DO UPDATE SET
          order_uid=COALESCE(NULLIF(EXCLUDED.order_uid,''),fbs_fulfillment_orders.order_uid),
          supply_id=COALESCE(EXCLUDED.supply_id,fbs_fulfillment_orders.supply_id),
          warehouse_id=COALESCE(EXCLUDED.warehouse_id,fbs_fulfillment_orders.warehouse_id),
          nm_id=EXCLUDED.nm_id,chrt_id=EXCLUDED.chrt_id,
          vendor_code=COALESCE(NULLIF(EXCLUDED.vendor_code,''),fbs_fulfillment_orders.vendor_code),
          product_name=COALESCE(NULLIF(EXCLUDED.product_name,''),fbs_fulfillment_orders.product_name),
          size_name=COALESCE(NULLIF(EXCLUDED.size_name,''),fbs_fulfillment_orders.size_name),
          photo_url=COALESCE(NULLIF(EXCLUDED.photo_url,''),fbs_fulfillment_orders.photo_url),
          skus=CASE WHEN EXCLUDED.skus<>'[]'::jsonb THEN EXCLUDED.skus ELSE fbs_fulfillment_orders.skus END,
          supplier_status=CASE WHEN $18 THEN EXCLUDED.supplier_status ELSE fbs_fulfillment_orders.supplier_status END,
          wb_status=CASE WHEN $18 THEN EXCLUDED.wb_status ELSE fbs_fulfillment_orders.wb_status END,
          created_at_wb=COALESCE(EXCLUDED.created_at_wb,fbs_fulfillment_orders.created_at_wb),
          raw_json=fbs_fulfillment_orders.raw_json || EXCLUDED.raw_json,
          rid=COALESCE(NULLIF(EXCLUDED.rid,''),fbs_fulfillment_orders.rid),
          sticker_id=COALESCE(EXCLUDED.sticker_id,fbs_fulfillment_orders.sticker_id),
          status_synced_at=CASE WHEN $18 THEN CURRENT_TIMESTAMP ELSE fbs_fulfillment_orders.status_synced_at END,
          archive_source=EXCLUDED.archive_source,
          updated_at=CURRENT_TIMESTAMP
      `, [
        order.orderId, order.orderUid, order.supplyId, order.warehouseId, order.nmId, order.chrtId,
        vendorCode, productName, sizeName, photoUrl, JSON.stringify(skus),
        order.supplierStatus, order.wbStatus, order.createdAt || null, JSON.stringify(order.raw),
        order.rid, order.stickerId, hasStatus, order.source,
      ]);
      if (hasStatus) {
        await client.query(`
          INSERT INTO fbs_order_status_events (
            order_id,supplier_status,wb_status,source,raw_json
          ) VALUES ($1,$2,$3,$4,$5::jsonb)
          ON CONFLICT (order_id,supplier_status,wb_status) DO UPDATE SET
            last_observed_at=CURRENT_TIMESTAMP,
            observations=fbs_order_status_events.observations+1,
            source=EXCLUDED.source,
            raw_json=fbs_order_status_events.raw_json || EXCLUDED.raw_json
        `, [order.orderId, order.supplierStatus, order.wbStatus, order.source, JSON.stringify(order.raw)]);
      }
    }

    const archivedSupplyIds = Array.from(new Set(incoming.filter((row) => row.source === "archive" && row.supplyId).map((row) => row.supplyId)));
    if (archivedSupplyIds.length) {
      await client.query(`
        UPDATE fbs_fulfillment_supplies
        SET archive_synced_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
        WHERE supply_id=ANY($1::text[])
      `, [archivedSupplyIds]);
    }
  });
}

async function reconcileMemberships(supplies: FbsWbSupply[], full: boolean): Promise<{ checked: number; errors: number }> {
  const now = Date.now();
  const candidates = supplies.filter((supply) => {
    if (full || !supply.done) return true;
    const closedAt = new Date(String(supply.closedAt || "")).getTime();
    return Number.isFinite(closedAt) && now - closedAt <= 7 * 24 * 60 * 60_000;
  });
  let checked = 0;
  let errors = 0;
  for (const supply of candidates) {
    try {
      const orderIds = await getFbsSupplyOrderIds(supply.id);
      await withPgTransaction(async (client) => {
        if (orderIds.length) {
          await client.query(`
            UPDATE fbs_fulfillment_orders
            SET supply_id=$1,updated_at=CURRENT_TIMESTAMP
            WHERE order_id=ANY($2::bigint[]) AND supply_id IS DISTINCT FROM $1
          `, [supply.id, orderIds]);
          await client.query(`
            UPDATE fbs_fulfillment_orders
            SET supply_id=NULL,updated_at=CURRENT_TIMESTAMP
            WHERE supply_id=$1 AND NOT (order_id=ANY($2::bigint[]))
          `, [supply.id, orderIds]);
        } else {
          await client.query(`
            UPDATE fbs_fulfillment_orders
            SET supply_id=NULL,updated_at=CURRENT_TIMESTAMP
            WHERE supply_id=$1
          `, [supply.id]);
        }
        await client.query(`
          UPDATE fbs_fulfillment_supplies
          SET verified_order_count=$2,composition_checked_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP
          WHERE supply_id=$1
        `, [supply.id, orderIds.length]);
      });
      checked += 1;
    } catch {
      errors += 1;
    }
    await waitForFbsRateLimit();
  }
  await pgGet(`
    UPDATE fbs_fulfillment_supplies s
    SET order_count=(SELECT COUNT(*)::int FROM fbs_fulfillment_orders o WHERE o.supply_id=s.supply_id),
        updated_at=CURRENT_TIMESTAMP
    WHERE order_count IS DISTINCT FROM (SELECT COUNT(*)::int FROM fbs_fulfillment_orders o WHERE o.supply_id=s.supply_id)
    RETURNING supply_id
  `).catch(() => undefined);
  return { checked, errors };
}

async function fetchStatisticsSales(dateFrom: Date): Promise<SalesRow[]> {
  const token = getWbApiKey();
  if (!token) throw new Error("Не настроен основной WB API-токен для отчёта продаж и возвратов");
  const query = new URLSearchParams({ dateFrom: dateFrom.toISOString(), flag: "0" });
  const response = await fetch(`${STATISTICS_API}/api/v1/supplier/sales?${query.toString()}`, {
    headers: { Authorization: token },
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`WB Statistics ${response.status}: ${body.slice(0, 300)}`);
  const rows = body ? JSON.parse(body) : [];
  return Array.isArray(rows) ? rows : [];
}

async function syncSales(force = false): Promise<number> {
  const state = await pgGet<{ cursor_json: { nextDateFrom?: string } | null; last_success_at: string | null }>(`
    SELECT cursor_json,last_success_at FROM fbs_archive_sync_state WHERE source='sales'
  `);
  const lastSuccess = state?.last_success_at ? new Date(state.last_success_at).getTime() : 0;
  if (!force && lastSuccess && Date.now() - lastSuccess < 30 * 60_000) return 0;
  const ninetyDaysAgo = new Date(Date.now() - 89 * 24 * 60 * 60_000);
  const cursorDate = validDate(state?.cursor_json?.nextDateFrom);
  const overlapDate = lastSuccess ? new Date(lastSuccess - 48 * 60 * 60_000) : ninetyDaysAgo;
  const dateFrom = cursorDate ? new Date(cursorDate) : overlapDate < ninetyDaysAgo ? ninetyDaysAgo : overlapDate;

  try {
    const rows = await fetchStatisticsSales(dateFrom);
    const orderRows = await pgRows<{ order_id: number; rid: string }>(`
      SELECT order_id,rid FROM fbs_fulfillment_orders WHERE rid<>''
    `);
    const orderIdByRid = new Map(orderRows.map((row) => [row.rid, Number(row.order_id)]));
    const matched = rows.filter((row) => orderIdByRid.has(cleanText(row.srid)) && /^[SR]/.test(cleanText(row.saleID)));
    await withPgTransaction(async (client) => {
      for (const row of matched) {
        const eventId = cleanText(row.saleID);
        const rid = cleanText(row.srid);
        await client.query(`
          INSERT INTO fbs_sales_events (
            event_id,order_id,rid,event_type,event_at,last_change_at,source,raw_json,updated_at
          ) VALUES ($1,$2,$3,$4,$5,$6,'statistics',$7::jsonb,CURRENT_TIMESTAMP)
          ON CONFLICT (event_id) DO UPDATE SET
            order_id=EXCLUDED.order_id,rid=EXCLUDED.rid,event_type=EXCLUDED.event_type,
            event_at=EXCLUDED.event_at,last_change_at=EXCLUDED.last_change_at,
            raw_json=EXCLUDED.raw_json,updated_at=CURRENT_TIMESTAMP
        `, [
          eventId,
          orderIdByRid.get(rid) || null,
          rid,
          eventId.startsWith("R") ? "return" : "sale",
          validDate(row.date) || null,
          validDate(row.lastChangeDate) || null,
          JSON.stringify(row),
        ]);
      }
    });
    const lastRow = rows.at(-1);
    const nextDateFrom = rows.length >= SALES_LIMIT ? validDate(lastRow?.lastChangeDate) : "";
    await saveSyncState("sales", { success: true, cursor: nextDateFrom ? { nextDateFrom } : {} });
    return matched.length;
  } catch (error) {
    await saveSyncState("sales", { error: error instanceof Error ? error.message : String(error), cursor: state?.cursor_json || {} });
    throw error;
  }
}

async function importFinancialHistory(): Promise<void> {
  await pgGet(`
    INSERT INTO fbs_sales_events (
      event_id,order_id,rid,event_type,event_at,last_change_at,source,raw_json,updated_at
    )
    SELECT
      'weekly:' || w.report_id::text || ':' || w.row_num::text,
      o.order_id,
      w.srid,
      CASE WHEN w.supplier_oper_name='Возврат' OR w.doc_type='Возврат' THEN 'return' ELSE 'sale' END,
      NULLIF(w.sale_dt,'')::timestamptz,
      NULL,
      'financial_report',
      jsonb_build_object(
        'reportId',w.report_id,'rowNum',w.row_num,'operation',w.supplier_oper_name,
        'docType',w.doc_type,'saleDt',w.sale_dt
      ),
      CURRENT_TIMESTAMP
    FROM weekly_rows w
    JOIN fbs_fulfillment_orders o ON o.rid=w.srid AND o.rid<>''
    WHERE w.supplier_oper_name IN ('Продажа','Возврат') OR w.doc_type IN ('Продажа','Возврат')
    ON CONFLICT (event_id) DO UPDATE SET
      order_id=EXCLUDED.order_id,rid=EXCLUDED.rid,event_type=EXCLUDED.event_type,
      event_at=EXCLUDED.event_at,raw_json=EXCLUDED.raw_json,updated_at=CURRENT_TIMESTAMP
    RETURNING event_id
  `).catch(() => undefined);
}

async function performArchiveSync(forceFull = false): Promise<SyncResult> {
  const archiveState = await pgGet<{ last_success_at: string | null }>(`
    SELECT last_success_at FROM fbs_archive_sync_state WHERE source='archive'
  `);
  const lastFull = archiveState?.last_success_at ? new Date(archiveState.last_success_at).getTime() : 0;
  const full = forceFull || !lastFull || Date.now() - lastFull >= 24 * 60 * 60_000;
  const warnings: string[] = [];
  const supplies = await getFbsSupplies();
  await upsertSupplies(supplies);

  const now = new Date();
  const oldestLiveSupply = supplies.map((supply) => new Date(String(supply.createdAt || "")))
    .filter((date) => Number.isFinite(date.getTime()))
    .sort((left, right) => left.getTime() - right.getTime())[0];
  const localOldestRow = await pgGet<{ created_at_wb: string | null }>(`
    SELECT MIN(created_at_wb) AS created_at_wb FROM fbs_fulfillment_supplies
  `);
  const oldestLocalSupply = localOldestRow?.created_at_wb ? new Date(localOldestRow.created_at_wb) : null;
  const oldestSupply = oldestLocalSupply && Number.isFinite(oldestLocalSupply.getTime())
    && (!oldestLiveSupply || oldestLocalSupply < oldestLiveSupply)
    ? oldestLocalSupply
    : oldestLiveSupply;
  const recentFloor = new Date(now.getTime() - (full ? 93 : 30) * 24 * 60 * 60_000);
  const recentFrom = oldestSupply && oldestSupply > recentFloor ? oldestSupply : recentFloor;
  const recentOrders: FbsWbOrder[] = [];
  for (let cursor = new Date(recentFrom); cursor < now;) {
    const end = new Date(Math.min(now.getTime(), cursor.getTime() + 29 * 24 * 60 * 60_000));
    recentOrders.push(...await getFbsOrdersSince(cursor, end));
    cursor = new Date(end.getTime() + 1000);
  }
  const recentIds = Array.from(new Set(recentOrders.map((order) => Number(order.id)).filter(Number.isSafeInteger)));
  const statuses = await getFbsOrderStatuses(recentIds);
  const statusById = new Map(statuses.map((status) => [Number(status.id), status]));
  const incoming = new Map<number, IncomingOrder>();
  for (const order of recentOrders) {
    const normalized = normalizeRecentOrder(order, statusById.get(Number(order.id)));
    if (normalized) incoming.set(normalized.orderId, normalized);
  }

  let archivedOrders = 0;
  if (full && oldestSupply) {
    const archiveThrough = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 3, 1));
    for (const period of archiveMonths(oldestSupply, archiveThrough)) {
      try {
        const rows = await getFbsArchivedOrders(period.year, period.month);
        archivedOrders += rows.length;
        for (const order of rows) {
          const normalized = normalizeArchivedOrder(order);
          if (normalized && !incoming.has(normalized.orderId)) incoming.set(normalized.orderId, normalized);
        }
      } catch (error) {
        warnings.push(`Архив ${period.month}.${period.year}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  await upsertOrders(Array.from(incoming.values()));
  const memberships = await reconcileMemberships(supplies, full);
  await importFinancialHistory();
  let salesMatched = 0;
  try {
    salesMatched = await syncSales(forceFull);
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : String(error));
  }
  if (full) {
    await saveSyncState("archive", {
      success: true,
      error: warnings.filter((warning) => warning.startsWith("Архив ")).join(" | "),
      cursor: { oldestSupply: oldestSupply?.toISOString() || null, through: now.toISOString() },
    });
  }
  await saveSyncState("fulfillment", {
    success: true,
    cursor: { checkedAt: now.toISOString(), full, orders: incoming.size },
  });
  return {
    full,
    supplies: supplies.length,
    orders: incoming.size,
    archivedOrders,
    membershipsChecked: memberships.checked,
    membershipErrors: memberships.errors,
    salesMatched,
    warnings,
  };
}

export async function syncFbsArchive(input: { full?: boolean } = {}): Promise<SyncResult> {
  const organizationId = getActiveOrganizationId();
  if (!organizationId) throw new Error("Organization context is required for FBS archive sync");
  return withPgClient(async (client) => {
    const lock = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock($1,$2) AS locked",
      [ARCHIVE_LOCK_KEY, organizationId],
    );
    if (!lock.rows[0]?.locked) return {
      skipped: true,
      full: false,
      supplies: 0,
      orders: 0,
      archivedOrders: 0,
      membershipsChecked: 0,
      membershipErrors: 0,
      salesMatched: 0,
      warnings: ["Синхронизация этого юрлица уже выполняется"],
    };
    try {
      return await performArchiveSync(Boolean(input.full));
    } finally {
      await client.query("SELECT pg_advisory_unlock($1,$2)", [ARCHIVE_LOCK_KEY, organizationId]).catch(() => undefined);
    }
  });
}

function rangeFromDays(days: number): { from: string | null; to: string } {
  const to = new Date();
  if (!Number.isFinite(days) || days <= 0) return { from: null, to: to.toISOString() };
  return { from: new Date(to.getTime() - Math.min(days, 730) * 24 * 60 * 60_000).toISOString(), to: to.toISOString() };
}

export async function getFbsArchiveOverview(input: { days?: number; query?: string } = {}): Promise<FbsArchiveOverview> {
  const { from, to } = rangeFromDays(Number(input.days ?? 90));
  const query = cleanText(input.query).slice(0, 120);
  const params = [from, to, query, `%${query}%`];
  const classifiedCte = `
    WITH returned AS (
      SELECT DISTINCT rid FROM fbs_sales_events WHERE event_type='return' AND rid<>''
    ), classified AS (
      SELECT o.*, ${BUCKET_SQL} AS bucket
      FROM fbs_fulfillment_orders o
      LEFT JOIN returned ret ON ret.rid=o.rid
      WHERE o.created_at_wb >= COALESCE(?::timestamptz,'-infinity'::timestamptz)
        AND o.created_at_wb <= ?::timestamptz
    )
  `;
  const [supplies, days, totals, unknownStatuses, sync] = await Promise.all([
    pgRows<FbsArchiveSupplySummary>(`
      ${classifiedCte}, aggregate AS (
        SELECT supply_id,COUNT(*)::int actual_order_count,
          COUNT(*) FILTER (WHERE bucket='assembly')::int assembly,
          COUNT(*) FILTER (WHERE bucket='transit')::int transit,
          COUNT(*) FILTER (WHERE bucket='pickup')::int pickup,
          COUNT(*) FILTER (WHERE bucket='sold')::int sold,
          COUNT(*) FILTER (WHERE bucket='early_cancel')::int early_cancel,
          COUNT(*) FILTER (WHERE bucket='refused')::int refused,
          COUNT(*) FILTER (WHERE bucket='returned')::int returned,
          COUNT(*) FILTER (WHERE bucket='issue')::int issue,
          COUNT(*) FILTER (WHERE bucket='unknown')::int unknown
        FROM classified WHERE supply_id IS NOT NULL GROUP BY supply_id
      )
      SELECT s.supply_id,s.name,s.done,s.delivery_mode,s.destination_name,s.destination_office_id,
        s.created_at_wb,s.closed_at_wb,s.scan_at_wb,s.order_count,s.verified_order_count,
        COALESCE(a.actual_order_count,0)::int actual_order_count,s.composition_checked_at,s.archive_synced_at,
        COALESCE(a.assembly,0)::int assembly,COALESCE(a.transit,0)::int transit,
        COALESCE(a.pickup,0)::int pickup,COALESCE(a.sold,0)::int sold,
        COALESCE(a.early_cancel,0)::int early_cancel,COALESCE(a.refused,0)::int refused,
        COALESCE(a.returned,0)::int returned,COALESCE(a.issue,0)::int issue,
        COALESCE(a.unknown,0)::int unknown,
        (s.verified_order_count IS NOT NULL AND s.verified_order_count<>COALESCE(a.actual_order_count,0)) AS mismatch
      FROM fbs_fulfillment_supplies s
      LEFT JOIN aggregate a ON a.supply_id=s.supply_id
      WHERE COALESCE(a.actual_order_count,0)>0
        AND ($3='' OR s.supply_id ILIKE $4 OR s.name ILIKE $4 OR s.destination_name ILIKE $4 OR EXISTS (
          SELECT 1 FROM classified q WHERE q.supply_id=s.supply_id AND (
            q.order_id::text ILIKE $4 OR COALESCE(q.sticker_id::text,'') ILIKE $4 OR
            q.sticker_barcode ILIKE $4 OR q.vendor_code ILIKE $4 OR q.nm_id::text ILIKE $4
          )
        ))
      ORDER BY COALESCE(s.closed_at_wb,s.created_at_wb) DESC NULLS LAST,s.supply_id DESC
      LIMIT 500
    `, params),
    pgRows<FbsArchiveDay>(`
      ${classifiedCte}
      SELECT to_char(created_at_wb AT TIME ZONE 'Europe/Moscow','YYYY-MM-DD') AS date,
        COUNT(*)::int total,
        COUNT(*) FILTER (WHERE bucket='assembly')::int assembly,
        COUNT(*) FILTER (WHERE bucket='transit')::int transit,
        COUNT(*) FILTER (WHERE bucket='pickup')::int pickup,
        COUNT(*) FILTER (WHERE bucket='sold')::int sold,
        COUNT(*) FILTER (WHERE bucket='early_cancel')::int early_cancel,
        COUNT(*) FILTER (WHERE bucket='refused')::int refused,
        COUNT(*) FILTER (WHERE bucket='returned')::int returned,
        COUNT(*) FILTER (WHERE bucket='issue')::int issue,
        COUNT(*) FILTER (WHERE bucket='unknown')::int unknown
      FROM classified GROUP BY 1 ORDER BY 1
    `, [from, to]),
    pgGet<Record<FbsArchiveBucket, number> & { orders: number; supplies: number }>(`
      ${classifiedCte}
      SELECT COUNT(*)::int orders,COUNT(DISTINCT supply_id)::int supplies,
        COUNT(*) FILTER (WHERE bucket='assembly')::int assembly,
        COUNT(*) FILTER (WHERE bucket='transit')::int transit,
        COUNT(*) FILTER (WHERE bucket='pickup')::int pickup,
        COUNT(*) FILTER (WHERE bucket='sold')::int sold,
        COUNT(*) FILTER (WHERE bucket='early_cancel')::int early_cancel,
        COUNT(*) FILTER (WHERE bucket='refused')::int refused,
        COUNT(*) FILTER (WHERE bucket='returned')::int returned,
        COUNT(*) FILTER (WHERE bucket='issue')::int issue,
        COUNT(*) FILTER (WHERE bucket='unknown')::int unknown
      FROM classified
    `, [from, to]),
    pgRows<{ supplier_status: string; wb_status: string; count: number }>(`
      ${classifiedCte}
      SELECT supplier_status,wb_status,COUNT(*)::int count
      FROM classified WHERE bucket='unknown'
      GROUP BY supplier_status,wb_status ORDER BY count DESC
    `, [from, to]),
    pgRows(`
      SELECT source,last_success_at,last_error,last_error_at,updated_at
      FROM fbs_archive_sync_state ORDER BY source
    `),
  ]);
  return {
    supplies,
    days,
    totals: totals || {
      orders: 0, supplies: 0, assembly: 0, transit: 0, pickup: 0, sold: 0,
      early_cancel: 0, refused: 0, returned: 0, issue: 0, unknown: 0,
    },
    unknownStatuses,
    sync: sync as FbsArchiveOverview["sync"],
  };
}

export async function getFbsArchiveSupplyDetails(supplyId: string): Promise<{ supply: FbsArchiveSupplySummary | null; orders: FbsArchiveOrderDetail[] }> {
  const normalized = cleanText(supplyId);
  if (!normalized || normalized.length > 100) throw new Error("Некорректный номер поставки");
  const returnedCte = `WITH returned AS (
    SELECT rid,MAX(event_at) AS return_at FROM fbs_sales_events
    WHERE event_type='return' AND rid<>'' GROUP BY rid
  )`;
  const orders = await pgRows<Omit<FbsArchiveOrderDetail, "status_history">>(`
    ${returnedCte}
    SELECT o.order_id,o.order_uid,o.rid,o.sticker_id,o.sticker_barcode,o.supply_id,
      o.warehouse_id,COALESCE(NULLIF(o.raw_json->>'_mphubWarehouseName',''),'') AS warehouse_name,
      o.nm_id,o.chrt_id,o.vendor_code,o.product_name,o.size_name,o.photo_url,o.skus,
      o.supplier_status,o.wb_status,${BUCKET_SQL} AS bucket,o.created_at_wb,o.status_synced_at,ret.return_at
    FROM fbs_fulfillment_orders o
    LEFT JOIN returned ret ON ret.rid=o.rid
    WHERE o.supply_id=?
    ORDER BY o.created_at_wb,o.order_id
  `, [normalized]);
  const ids = orders.map((order) => Number(order.order_id));
  const history = ids.length ? await pgRows<{
    order_id: number;
    supplier_status: string;
    wb_status: string;
    source: string;
    first_observed_at: string;
    last_observed_at: string;
  }>(`
    SELECT order_id,supplier_status,wb_status,source,first_observed_at,last_observed_at
    FROM fbs_order_status_events WHERE order_id=ANY(?::bigint[])
    ORDER BY order_id,first_observed_at
  `, [ids]) : [];
  const historyById = new Map<number, FbsArchiveOrderDetail["status_history"]>();
  for (const event of history) {
    const list = historyById.get(Number(event.order_id)) || [];
    list.push(event);
    historyById.set(Number(event.order_id), list);
  }
  const supply = await pgGet<FbsArchiveSupplySummary>(`
    SELECT s.supply_id,s.name,s.done,s.delivery_mode,s.destination_name,s.destination_office_id,
      s.created_at_wb,s.closed_at_wb,s.scan_at_wb,s.order_count,s.verified_order_count,
      (SELECT COUNT(*)::int FROM fbs_fulfillment_orders o WHERE o.supply_id=s.supply_id) AS actual_order_count,
      s.composition_checked_at,s.archive_synced_at,
      0::int assembly,0::int transit,0::int pickup,0::int sold,0::int early_cancel,
      0::int refused,0::int returned,0::int issue,0::int unknown,
      (s.verified_order_count IS NOT NULL AND s.verified_order_count<>(SELECT COUNT(*) FROM fbs_fulfillment_orders o WHERE o.supply_id=s.supply_id)) AS mismatch
    FROM fbs_fulfillment_supplies s WHERE s.supply_id=? LIMIT 1
  `, [normalized]);
  return {
    supply: supply || null,
    orders: orders.map((order) => ({ ...order, status_history: historyById.get(Number(order.order_id)) || [] })),
  };
}
