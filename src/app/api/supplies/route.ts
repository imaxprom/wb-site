import { NextRequest, NextResponse } from "next/server";
import { activateAuthenticatedRequestContext, requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import {
  getAcceptedSupplyContentPg,
  getAcceptedSupplyPg,
  getSupplySnapshotsPg,
  saveAcceptedSupplyPg,
  saveSupplySnapshotPg,
  type AcceptedSupplyInput,
  type SupplySnapshotInput,
} from "@/lib/shipment-db";
import { isPostgresReadonlyConnection, pgGet } from "@/lib/postgres";
import { getWbApiKey } from "@/lib/wb-api-key";
import { requireActiveOrganizationId } from "@/lib/organization-context";

const SUPPLIES_API = "https://supplies-api.wildberries.ru/api/v1";
const SUPPLIES_CACHE_TTL_MS = 15 * 60 * 1000;
const DETAIL_DELAY_MS = 2100;
const MAX_LIMIT = 20;

interface WbSupplyListRow {
  phone?: string;
  supplyID: number | null;
  preorderID?: number;
  createDate?: string;
  supplyDate?: string;
  factDate?: string;
  updatedDate?: string;
  statusID?: number;
  boxTypeID?: number;
  isBoxOnPallet?: boolean;
}

interface WbSupplyDetail {
  phone?: string;
  statusID?: number;
  virtualTypeID?: number;
  boxTypeID?: number;
  createDate?: string;
  supplyDate?: string;
  factDate?: string;
  updatedDate?: string;
  warehouseID?: number | null;
  warehouseName?: string;
  actualWarehouseID?: number | null;
  actualWarehouseName?: string;
  transitWarehouseID?: number | null;
  transitWarehouseName?: string;
  acceptanceCost?: number | null;
  paidAcceptanceCoefficient?: number | null;
  rejectReason?: string | null;
  supplierAssignName?: string;
  storageCoef?: string | null;
  deliveryCoef?: string | null;
  quantity?: number;
  packedQuantity?: number;
  packedQuantitySource?: "package" | "goods" | "detail";
  readyForSaleQuantity?: number;
  acceptedQuantity?: number;
  unloadingQuantity?: number;
  depersonalizedQuantity?: number;
  isBoxOnPallet?: boolean;
}

interface SupplyRow extends WbSupplyListRow {
  detail: WbSupplyDetail | null;
  detailError?: string;
}

interface WbPackageBarcode {
  barcode?: string;
  quantity?: number;
}

interface WbPackage {
  quantity?: number;
  barcodes?: WbPackageBarcode[];
}

interface WbSupplyGood {
  barcode?: string;
  quantity?: number;
}

interface SupplyContentPayload {
  source?: "package" | "goods";
  packages?: WbPackage[];
  goods?: WbSupplyGood[];
}

const listCache = new Map<string, { ts: number; data: SupplyRow[] }>();
const detailCache = new Map<string, { ts: number; data: WbSupplyDetail }>();

function isDraftSupply(row: WbSupplyListRow, detail?: WbSupplyDetail | null): boolean {
  return (detail?.statusID ?? row.statusID) === 1;
}

async function persistSupplySnapshot(input: SupplySnapshotInput): Promise<void> {
  await saveSupplySnapshotPg(input);
}

async function persistAcceptedSupply(input: AcceptedSupplyInput): Promise<void> {
  await saveAcceptedSupplyPg(input);
}

class WbApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function shiftDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function wbFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const apiKey = getWbApiKey();
  if (!apiKey) {
    throw new Error("WB API key is not configured");
  }

  const res = await fetch(`${SUPPLIES_API}${path}`, {
    ...init,
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });

  const text = await res.text();
  if (!res.ok) {
    throw new WbApiError(text || `WB API HTTP ${res.status}`, res.status);
  }
  return (text ? JSON.parse(text) : null) as T;
}

async function getSupplyDetail(supplyID: number): Promise<WbSupplyDetail> {
  const cacheKey = `${requireActiveOrganizationId()}:${supplyID}`;
  const cached = detailCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < SUPPLIES_CACHE_TTL_MS) {
    return cached.data;
  }

  const detail = await wbFetch<WbSupplyDetail>(`/supplies/${encodeURIComponent(String(supplyID))}`);
  detailCache.set(cacheKey, { ts: Date.now(), data: detail });
  return detail;
}

function safeJson<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function packagePackedQuantity(packages: WbPackage[]): number {
  return packages.reduce((sum, pack) => {
    const barcodeTotal = (pack.barcodes || []).reduce((itemSum, item) => itemSum + Number(item.quantity || 0), 0);
    return sum + (barcodeTotal || Number(pack.quantity || 0));
  }, 0);
}

function contentPackedQuantity(payload: SupplyContentPayload | null): { quantity: number; source: "package" | "goods" } | null {
  if (!payload) return null;
  if (payload.source === "package" || (payload.packages && payload.packages.length > 0)) {
    return { quantity: packagePackedQuantity(payload.packages || []), source: "package" };
  }
  if (payload.source === "goods" || (payload.goods && payload.goods.length > 0)) {
    return {
      quantity: (payload.goods || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0),
      source: "goods",
    };
  }
  return null;
}

async function readStoredSupplyContentPg(supplyID: number): Promise<SupplyContentPayload | null> {
  const row = await pgGet<{ payload_json: string }>(`
    SELECT payload_json
    FROM wb_supply_contents
    WHERE supply_id = ?
  `, [supplyID]).catch(() => undefined);
  if (row?.payload_json) return safeJson<SupplyContentPayload>(row.payload_json);

  const accepted = await getAcceptedSupplyContentPg(supplyID).catch(() => null);
  return (accepted?.payload as SupplyContentPayload | undefined) || null;
}

async function enrichDetailWithPackedQuantity(supplyID: number, detail: WbSupplyDetail): Promise<WbSupplyDetail> {
  const payload = await readStoredSupplyContentPg(supplyID);
  const packed = contentPackedQuantity(payload);
  if (!packed) return { ...detail, packedQuantity: detail.quantity, packedQuantitySource: "detail" };
  return { ...detail, packedQuantity: packed.quantity, packedQuantitySource: packed.source };
}

async function readStoredSupplies(limit: number, offset: number): Promise<SupplyRow[]> {
  const stored = await getSupplySnapshotsPg(limit, offset);
  const supplies = await Promise.all(stored.map(async (item) => {
    const row = item.row as unknown as WbSupplyListRow;
    const detail = item.detail
      ? await enrichDetailWithPackedQuantity(item.supplyID, item.detail as WbSupplyDetail)
      : null;
    return {
      ...row,
      supplyID: item.supplyID,
      detail,
    };
  }));
  return supplies.filter((supply) => !isDraftSupply(supply, supply.detail));
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  activateAuthenticatedRequestContext(request);

  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(Number(searchParams.get("limit") || 20), 1), MAX_LIMIT);
  const offset = Math.max(Number(searchParams.get("offset") || 0), 0);
  const source = searchParams.get("source");
  const forceRefresh = searchParams.get("refresh") === "1" || source === "api";
  const dbOnly = source === "db";
  const cacheKey = `${requireActiveOrganizationId()}:${limit}:${offset}`;

  try {
    const cachedList = listCache.get(cacheKey);
    if (!forceRefresh && cachedList && Date.now() - cachedList.ts < SUPPLIES_CACHE_TTL_MS) {
      return NextResponse.json({ supplies: cachedList.data, meta: { limit, offset, source: "cache" } });
    }

    if (!forceRefresh || isPostgresReadonlyConnection() || dbOnly) {
      const supplies = await readStoredSupplies(limit, offset);
      if (supplies.length > 0 || isPostgresReadonlyConnection() || dbOnly) {
        listCache.set(cacheKey, { ts: Date.now(), data: supplies });
        return NextResponse.json({ supplies, meta: { limit, offset, source: "db" } });
      }
    }

    const rows = await wbFetch<WbSupplyListRow[]>(`/supplies?limit=${limit}&offset=${offset}`, {
      method: "POST",
      body: JSON.stringify({
        statusIDs: [1, 2, 3, 4, 5, 6],
      }),
    });

    const supplies: SupplyRow[] = [];
    let detailRequests = 0;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const supplyID = row.supplyID;
      if (!Number.isSafeInteger(supplyID)) {
        continue;
      }
      if (isDraftSupply(row)) continue;

      const acceptedFromList = row.statusID === 5;
      if (acceptedFromList) {
        const stored = await getAcceptedSupplyPg(supplyID as number);
        if (stored) {
          const detail = await enrichDetailWithPackedQuantity(supplyID as number, stored.detail as WbSupplyDetail);
          if (isDraftSupply(row, detail)) continue;
          await persistSupplySnapshot({ supplyID: supplyID as number, row, detail: detail as Record<string, unknown>, listPosition: offset + i });
          supplies.push({ ...row, detail });
          continue;
        }
      }

      try {
        if (detailRequests > 0) await sleep(DETAIL_DELAY_MS);
        detailRequests++;
        const detail = await enrichDetailWithPackedQuantity(supplyID as number, await getSupplyDetail(supplyID as number));
        if (isDraftSupply(row, detail)) continue;
        await persistSupplySnapshot({ supplyID: supplyID as number, row, detail: detail as Record<string, unknown>, listPosition: offset + i });
        if (detail.statusID === 5) {
          await persistAcceptedSupply({ supplyID: supplyID as number, row, detail: detail as Record<string, unknown> });
        }
        supplies.push({ ...row, detail });
      } catch (error) {
        await persistSupplySnapshot({ supplyID: supplyID as number, row, detail: null, listPosition: offset + i });
        supplies.push({
          ...row,
          detail: null,
          detailError: error instanceof Error ? error.message : "Не удалось загрузить детали поставки",
        });
      }
    }

    listCache.set(cacheKey, { ts: Date.now(), data: supplies });
    return NextResponse.json({ supplies, meta: { limit, offset, source: "api" } });
  } catch (error) {
    return apiError(error, error instanceof WbApiError ? error.status : 500);
  }
}
