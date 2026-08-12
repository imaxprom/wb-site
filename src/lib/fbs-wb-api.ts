import { getWbFbsApiKey } from "@/lib/wb-fbs-api-key";

const MARKETPLACE_API = "https://marketplace-api.wildberries.ru";
const CONTENT_API = "https://content-api.wildberries.ru";

export interface FbsWbWarehouse {
  id: number;
  name: string;
  officeId?: number;
  deliveryType?: number;
  isDeleting?: boolean;
}

export interface FbsWbCardVariant {
  chrtId: number;
  sizeName: string;
  skus: string[];
}

export interface FbsWbCard {
  nmId: number;
  vendorCode: string;
  title: string;
  brand: string;
  photoUrl: string;
  variants: FbsWbCardVariant[];
}

export interface FbsWbOrder {
  id: number;
  warehouseId: number;
  nmId: number;
  chrtId: number;
  createdAt: string;
  article?: string;
  orderUid?: string;
  supplyId?: string;
  [key: string]: unknown;
}

export type FbsMetaType = "sgtin" | "uin" | "imei" | "gtin" | "expiration" | "customsDeclaration";

export interface FbsWbSupply {
  id: string;
  name: string;
  done: boolean;
  isB2b?: boolean | null;
  createdAt?: string;
  closedAt?: string | null;
  scanDt?: string | null;
  cargoType?: number;
  crossBorderType?: number;
  destinationOfficeId?: number;
}

export interface FbsWbMetaDetail {
  key?: FbsMetaType | string;
  type?: FbsMetaType | string;
  name?: FbsMetaType | string;
  metaType?: FbsMetaType | string;
  decision?: string;
  status?: string;
  value?: unknown;
  [key: string]: unknown;
}

export interface FbsWbOrderMeta {
  orderId?: number;
  id?: number;
  availableMeta?: Array<FbsMetaType | string>;
  filled?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  metaDetails?: FbsWbMetaDetail[];
  [key: string]: unknown;
}

export interface FbsWbSticker {
  orderId?: number;
  partA?: string | number;
  partB?: string | number;
  barcode?: string;
  file: string;
}

export interface FbsPassOffice { id: number; name: string; address: string }
export interface FbsPass {
  id: number;
  firstName: string;
  lastName: string;
  carModel: string;
  carNumber: string;
  officeId: number;
  officeName?: string;
  officeAddress?: string;
  dateEnd?: string;
}

export interface FbsWbOrderStatus {
  id: number;
  supplierStatus: string;
  wbStatus: string;
}

export class FbsWbApiError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(`WB API ${status}: ${body || "ошибка без описания"}`);
    this.status = status;
    this.body = body;
  }
}

function decodeTokenAccess(value: string): { marketplace: boolean; readOnly: boolean; expiresAt: number | null } {
  try {
    const payloadPart = value.trim().split(".")[1];
    if (!payloadPart) throw new Error("JWT payload missing");
    const payload = JSON.parse(Buffer.from(payloadPart, "base64url").toString("utf8")) as { s?: number; exp?: number };
    const mask = Number(payload.s || 0);
    return {
      marketplace: Boolean(mask & (1 << 4)),
      readOnly: Boolean(mask & (1 << 30)),
      expiresAt: Number.isFinite(Number(payload.exp)) ? Number(payload.exp) : null,
    };
  } catch {
    throw new Error("Не удалось проверить права JWT-токена WB");
  }
}

function apiKey(): string {
  const value = getWbFbsApiKey();
  if (!value) {
    throw new Error("Для этого юрлица не настроен отдельный FBS API-токен. Добавьте его в Настройки → FBS API-токен");
  }
  return value;
}

export async function validateFbsApiKey(value: string): Promise<{ warehouseCount: number; readOnly: boolean; expiresAt: number | null }> {
  const access = decodeTokenAccess(value);
  if (!access.marketplace) throw new Error("В токене не включена категория «Маркетплейс»");
  if (access.readOnly) throw new Error("Для FBS-сборки нужен токен «Чтение и запись», а этот токен только на чтение");
  if (access.expiresAt && access.expiresAt * 1000 <= Date.now()) throw new Error("Срок действия FBS API-токена истёк");
  const response = await fetch(`${MARKETPLACE_API}/api/v3/warehouses`, {
    headers: { Authorization: value.trim(), "Content-Type": "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  const text = await response.text();
  if (!response.ok) throw new FbsWbApiError(response.status, text.slice(0, 1000));
  const rows = text ? JSON.parse(text) : [];
  return { warehouseCount: Array.isArray(rows) ? rows.length : 0, readOnly: access.readOnly, expiresAt: access.expiresAt };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function wbFetch<T>(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
  attempts = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: apiKey(),
          "Content-Type": "application/json",
          ...init.headers,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      const text = await response.text();
      if (response.ok) {
        return (text ? JSON.parse(text) : undefined) as T;
      }
      const error = new FbsWbApiError(response.status, text.slice(0, 1000));
      if (response.status !== 429 && response.status < 500) throw error;
      lastError = error;
      const retryAfter = Number(response.headers.get("retry-after") || "0");
      await delay(retryAfter > 0 ? retryAfter * 1000 : 500 * (attempt + 1));
    } catch (error) {
      lastError = error;
      if (error instanceof FbsWbApiError && error.status < 500 && error.status !== 429) throw error;
      if (attempt + 1 < attempts) await delay(500 * (attempt + 1));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("WB API недоступен");
}

export async function createFbsSupply(name: string): Promise<{ id: string }> {
  return wbFetch(MARKETPLACE_API, "/api/v3/supplies", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function addFbsOrdersToSupply(supplyId: string, orderIds: number[]): Promise<void> {
  for (let offset = 0; offset < orderIds.length; offset += 100) {
    await wbFetch<void>(MARKETPLACE_API, `/api/marketplace/v3/supplies/${encodeURIComponent(supplyId)}/orders`, {
      method: "PATCH",
      body: JSON.stringify({ orders: orderIds.slice(offset, offset + 100) }),
    });
    if (offset + 100 < orderIds.length) await delay(220);
  }
}

export async function getFbsSupplies(): Promise<FbsWbSupply[]> {
  const result: FbsWbSupply[] = [];
  let next = 0;
  for (let page = 0; page < 20; page += 1) {
    const payload = await wbFetch<{ next?: number; supplies?: FbsWbSupply[] }>(
      MARKETPLACE_API,
      `/api/v3/supplies?limit=1000&next=${next}`,
    );
    const rows = Array.isArray(payload.supplies) ? payload.supplies : [];
    result.push(...rows);
    const nextValue = Number(payload.next || 0);
    if (rows.length < 1000 || !nextValue || nextValue === next) break;
    next = nextValue;
    await delay(220);
  }
  return result;
}

export async function getFbsSupplyOrderIds(supplyId: string): Promise<number[]> {
  const payload = await wbFetch<{ orderIds?: number[] }>(
    MARKETPLACE_API,
    `/api/marketplace/v3/supplies/${encodeURIComponent(supplyId)}/order-ids`,
  );
  return (payload.orderIds || []).map(Number).filter(Number.isSafeInteger);
}

export async function deliverFbsSupply(supplyId: string): Promise<void> {
  await wbFetch<void>(MARKETPLACE_API, `/api/v3/supplies/${encodeURIComponent(supplyId)}/deliver`, {
    method: "PATCH",
  });
}

export async function getFbsReshipmentOrders(): Promise<Array<{ supplyID?: string; orderID?: number }>> {
  const payload = await wbFetch<{ orders?: Array<{ supplyID?: string; orderID?: number }> }>(
    MARKETPLACE_API,
    "/api/v3/supplies/orders/reshipment",
  );
  return Array.isArray(payload.orders) ? payload.orders : [];
}

export async function getFbsOrderMeta(orderIds: number[]): Promise<FbsWbOrderMeta[]> {
  const result: FbsWbOrderMeta[] = [];
  for (let offset = 0; offset < orderIds.length; offset += 100) {
    const batch = orderIds.slice(offset, offset + 100);
    if (!batch.length) continue;
    const payload = await wbFetch<{ orders?: FbsWbOrderMeta[] }>(
      MARKETPLACE_API,
      "/api/marketplace/v3/orders/meta",
      { method: "POST", body: JSON.stringify({ orders: batch }) },
    );
    result.push(...(Array.isArray(payload.orders) ? payload.orders : []));
    if (offset + 100 < orderIds.length) await delay(220);
  }
  return result;
}

export async function putFbsOrderMeta(orderId: number, type: FbsMetaType, value: string): Promise<void> {
  const field = type;
  const body = type === "sgtin" ? { sgtins: [value] } : { [field]: value };
  const path = type === "customsDeclaration"
    ? `/api/marketplace/v3/orders/${orderId}/meta/customs-declaration`
    : `/api/v3/orders/${orderId}/meta/${encodeURIComponent(type)}`;
  await wbFetch<void>(
    MARKETPLACE_API,
    path,
    { method: "PUT", body: JSON.stringify(body) },
  );
}

export async function getFbsOrderStickers(
  orderIds: number[],
  type: "svg" | "zplv" | "zplh" | "png" = "png",
  width: 58 | 40 = 58,
): Promise<FbsWbSticker[]> {
  const height = width === 58 ? 40 : 30;
  const result: FbsWbSticker[] = [];
  for (let offset = 0; offset < orderIds.length; offset += 100) {
    const payload = await wbFetch<{ stickers?: FbsWbSticker[] }>(
      MARKETPLACE_API,
      `/api/v3/orders/stickers?type=${type}&width=${width}&height=${height}`,
      { method: "POST", body: JSON.stringify({ orders: orderIds.slice(offset, offset + 100) }) },
    );
    result.push(...(Array.isArray(payload.stickers) ? payload.stickers : []));
    if (offset + 100 < orderIds.length) await delay(220);
  }
  return result;
}

export async function getFbsSupplyBarcode(
  supplyId: string,
  type: "svg" | "zplv" | "zplh" | "png" = "png",
): Promise<{ barcode: string; file: string }> {
  return wbFetch(MARKETPLACE_API, `/api/v3/supplies/${encodeURIComponent(supplyId)}/barcode?type=${type}`);
}

export async function addFbsSupplyBoxes(supplyId: string, amount: number): Promise<string[]> {
  const payload = await wbFetch<{ trbxIds?: string[] }>(
    MARKETPLACE_API,
    `/api/v3/supplies/${encodeURIComponent(supplyId)}/trbx`,
    { method: "POST", body: JSON.stringify({ amount }) },
  );
  return Array.isArray(payload.trbxIds) ? payload.trbxIds : [];
}

export async function getFbsSupplyBoxes(supplyId: string): Promise<string[]> {
  const payload = await wbFetch<{ trbxes?: Array<{ id?: string }> }>(
    MARKETPLACE_API,
    `/api/v3/supplies/${encodeURIComponent(supplyId)}/trbx`,
  );
  return (payload.trbxes || []).map((row) => String(row.id || "")).filter(Boolean);
}

export async function deleteFbsSupplyBoxes(supplyId: string, trbxIds: string[]): Promise<void> {
  if (!trbxIds.length) throw new Error("Не выбраны грузоместа для удаления");
  await wbFetch(
    MARKETPLACE_API,
    `/api/v3/supplies/${encodeURIComponent(supplyId)}/trbx`,
    { method: "DELETE", body: JSON.stringify({ trbxIds }) },
  );
}

export async function getFbsBoxStickers(
  supplyId: string,
  trbxIds: string[],
  type: "svg" | "zplv" | "zplh" | "png" = "png",
): Promise<Array<{ barcode: string; file: string }>> {
  const payload = await wbFetch<{ stickers?: Array<{ barcode: string; file: string }> }>(
    MARKETPLACE_API,
    `/api/v3/supplies/${encodeURIComponent(supplyId)}/trbx/stickers?type=${type}`,
    { method: "POST", body: JSON.stringify({ trbxIds }) },
  );
  return Array.isArray(payload.stickers) ? payload.stickers : [];
}

export async function getFbsPassOffices(): Promise<FbsPassOffice[]> {
  const rows = await wbFetch<FbsPassOffice[]>(MARKETPLACE_API, "/api/v3/passes/offices");
  return Array.isArray(rows) ? rows : [];
}

export async function getFbsPasses(): Promise<FbsPass[]> {
  const rows = await wbFetch<FbsPass[]>(MARKETPLACE_API, "/api/v3/passes");
  return Array.isArray(rows) ? rows : [];
}

export async function createFbsPass(input: Omit<FbsPass, "id">): Promise<{ id: number }> {
  return wbFetch(MARKETPLACE_API, "/api/v3/passes", {
    method: "POST",
    body: JSON.stringify({
      firstName: input.firstName,
      lastName: input.lastName,
      carModel: input.carModel,
      carNumber: input.carNumber,
      officeId: input.officeId,
    }),
  });
}

export async function getFbsWarehouses(): Promise<FbsWbWarehouse[]> {
  const rows = await wbFetch<FbsWbWarehouse[]>(MARKETPLACE_API, "/api/v3/warehouses");
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => Number.isSafeInteger(Number(row.id)) && !row.isDeleting)
    .map((row) => ({ ...row, id: Number(row.id), name: String(row.name || `Склад ${row.id}`) }));
}

export async function getFbsCardByNmId(nmId: number): Promise<FbsWbCard> {
  const payload = await wbFetch<{
    cards?: Array<{
      nmID?: number;
      vendorCode?: string;
      title?: string;
      brand?: string;
      photos?: Array<{ big?: string; c516x688?: string; c246x328?: string }>;
      sizes?: Array<{ chrtID?: number; techSize?: string; wbSize?: string; skus?: string[] }>;
    }>;
  }>(CONTENT_API, "/content/v2/get/cards/list", {
    method: "POST",
    body: JSON.stringify({
      settings: {
        sort: { ascending: false },
        cursor: { limit: 100 },
        filter: { textSearch: String(nmId), withPhoto: -1 },
      },
    }),
  });
  const card = (payload.cards || []).find((item) => Number(item.nmID) === nmId);
  if (!card) throw new Error(`Карточка ${nmId} не найдена в кабинете WB этого юрлица`);
  const variants = (card.sizes || [])
    .filter((size) => Number.isSafeInteger(Number(size.chrtID)) && Number(size.chrtID) > 0)
    .map((size) => ({
      chrtId: Number(size.chrtID),
      sizeName: String(size.techSize || size.wbSize || "0"),
      skus: Array.isArray(size.skus) ? size.skus.map(String) : [],
    }));
  if (variants.length === 0) throw new Error(`У карточки ${nmId} не найден chrtId`);
  return {
    nmId,
    vendorCode: String(card.vendorCode || ""),
    title: String(card.title || card.vendorCode || nmId),
    brand: String(card.brand || ""),
    photoUrl: String(card.photos?.[0]?.big || card.photos?.[0]?.c516x688 || card.photos?.[0]?.c246x328 || ""),
    variants,
  };
}

function mapContentCard(card: {
  nmID?: number;
  vendorCode?: string;
  title?: string;
  brand?: string;
  photos?: Array<{ big?: string; c516x688?: string; c246x328?: string }>;
  sizes?: Array<{ chrtID?: number; techSize?: string; wbSize?: string; skus?: string[] }>;
}): FbsWbCard | null {
  const nmId = Number(card.nmID);
  if (!Number.isSafeInteger(nmId) || nmId <= 0) return null;
  return {
    nmId,
    vendorCode: String(card.vendorCode || ""),
    title: String(card.title || card.vendorCode || nmId),
    brand: String(card.brand || ""),
    photoUrl: String(card.photos?.[0]?.c246x328 || card.photos?.[0]?.c516x688 || card.photos?.[0]?.big || ""),
    variants: (card.sizes || []).filter((size) => Number(size.chrtID) > 0).map((size) => ({
      chrtId: Number(size.chrtID),
      sizeName: String(size.techSize || size.wbSize || "0"),
      skus: Array.isArray(size.skus) ? size.skus.map(String) : [],
    })),
  };
}

/**
 * Resolve card data from WB's authoritative Content API. Never infer the CDN
 * basket for persisted photos: WB changes basket allocation independently of
 * nmId ranges (for example, 1.349B cards moved from calculated 53 to 46).
 */
export async function getFbsCardsByNmIds(nmIds: number[]): Promise<Map<number, FbsWbCard>> {
  const wanted = new Set(nmIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0));
  const found = new Map<number, FbsWbCard>();
  let cursor: { limit: number; updatedAt?: string; nmID?: number } = { limit: 100 };
  for (let page = 0; page < 30 && found.size < wanted.size; page += 1) {
    const payload = await wbFetch<{
      cards?: Array<Parameters<typeof mapContentCard>[0]>;
      cursor?: { updatedAt?: string; nmID?: number; total?: number };
    }>(CONTENT_API, "/content/v2/get/cards/list", {
      method: "POST",
      body: JSON.stringify({
        settings: {
          sort: { ascending: false },
          cursor,
          filter: { withPhoto: -1 },
        },
      }),
    });
    const cards = Array.isArray(payload.cards) ? payload.cards : [];
    for (const raw of cards) {
      const card = mapContentCard(raw);
      if (card && wanted.has(card.nmId)) found.set(card.nmId, card);
    }
    const nextUpdatedAt = payload.cursor?.updatedAt;
    const nextNmId = Number(payload.cursor?.nmID || 0);
    if (cards.length < 100 || !nextUpdatedAt || !nextNmId) break;
    cursor = { limit: 100, updatedAt: nextUpdatedAt, nmID: nextNmId };
    await delay(650);
  }
  return found;
}

export async function getFbsStocks(warehouseId: number, chrtIds: number[]): Promise<Map<number, number>> {
  const ids = Array.from(new Set(chrtIds.map(Number).filter((id) => Number.isSafeInteger(id) && id > 0)));
  if (ids.length === 0) return new Map();
  const payload = await wbFetch<{ stocks?: Array<{ chrtId?: number; amount?: number }> }>(
    MARKETPLACE_API,
    `/api/v3/stocks/${warehouseId}`,
    { method: "POST", body: JSON.stringify({ chrtIds: ids }) },
  );
  const result = new Map(ids.map((id) => [id, 0]));
  for (const row of payload.stocks || []) {
    const chrtId = Number(row.chrtId);
    if (result.has(chrtId)) result.set(chrtId, Math.max(0, Math.trunc(Number(row.amount || 0))));
  }
  return result;
}

export async function getFbsStock(warehouseId: number, chrtId: number): Promise<number> {
  return (await getFbsStocks(warehouseId, [chrtId])).get(chrtId) || 0;
}

export async function putFbsStock(warehouseId: number, chrtId: number, amount: number): Promise<void> {
  await wbFetch<void>(MARKETPLACE_API, `/api/v3/stocks/${warehouseId}`, {
    method: "PUT",
    body: JSON.stringify({ stocks: [{ chrtId, amount: Math.max(0, Math.trunc(amount)) }] }),
  });
}

export async function getNewFbsOrders(): Promise<FbsWbOrder[]> {
  const payload = await wbFetch<{ orders?: FbsWbOrder[] }>(MARKETPLACE_API, "/api/v3/orders/new");
  return Array.isArray(payload.orders) ? payload.orders : [];
}

export async function getFbsOrdersSince(dateFrom: Date, dateTo = new Date()): Promise<FbsWbOrder[]> {
  const orders: FbsWbOrder[] = [];
  let next = 0;
  for (let page = 0; page < 20; page += 1) {
    const query = new URLSearchParams({
      limit: "1000",
      next: String(next),
      dateFrom: String(Math.floor(dateFrom.getTime() / 1000)),
      dateTo: String(Math.floor(dateTo.getTime() / 1000)),
    });
    const payload = await wbFetch<{ next?: number; orders?: FbsWbOrder[] }>(
      MARKETPLACE_API,
      `/api/v3/orders?${query.toString()}`,
    );
    const pageOrders = Array.isArray(payload.orders) ? payload.orders : [];
    orders.push(...pageOrders);
    const nextValue = Number(payload.next || 0);
    if (pageOrders.length < 1000 || !nextValue || nextValue === next) break;
    next = nextValue;
    await delay(220);
  }
  return orders;
}

export async function getFbsOrderStatuses(orderIds: number[]): Promise<FbsWbOrderStatus[]> {
  const result: FbsWbOrderStatus[] = [];
  for (let offset = 0; offset < orderIds.length; offset += 1000) {
    const batch = orderIds.slice(offset, offset + 1000);
    if (batch.length === 0) continue;
    const payload = await wbFetch<{ orders?: FbsWbOrderStatus[] }>(
      MARKETPLACE_API,
      "/api/v3/orders/status",
      { method: "POST", body: JSON.stringify({ orders: batch }) },
    );
    result.push(...(Array.isArray(payload.orders) ? payload.orders : []));
    if (offset + 1000 < orderIds.length) await delay(220);
  }
  return result;
}

export async function cancelFbsOrder(orderId: number): Promise<void> {
  await wbFetch<void>(MARKETPLACE_API, `/api/v3/orders/${orderId}/cancel`, { method: "PATCH" });
}

export async function deleteFbsOrderMeta(orderId: number, type: Exclude<FbsMetaType, "expiration">): Promise<void> {
  await wbFetch<void>(MARKETPLACE_API, `/api/v3/orders/${orderId}/meta?key=${encodeURIComponent(type)}`, { method: "DELETE" });
}

export async function waitForFbsRateLimit(): Promise<void> {
  await delay(220);
}
