/**
 * Client-side functions to call our /api/wb/* proxy routes.
 * API key is stored server-side in data/wb-api-key.txt.
 * Server routes read it directly — no need to send from client.
 */

async function wbFetch<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`WB API ошибка ${res.status}: ${text || res.statusText}`);
  }

  return res.json();
}

/** Fetch all product cards (handles pagination automatically) */
export async function fetchCards(): Promise<WBCard[]> {
  const allCards: WBCard[] = [];
  let cursor = { limit: 100, updatedAt: "", nmID: 0 };

  while (true) {
    const result = await wbFetch<WBCardsResponse>("/api/wb/cards", {
      method: "POST",
      body: JSON.stringify({ cursor }),
    });

    allCards.push(...(result.cards || []));

    if (!result.cursor || (result.cursor.total ?? 0) < cursor.limit) break;
    cursor = {
      limit: 100,
      updatedAt: result.cursor.updatedAt || "",
      nmID: result.cursor.nmID || 0,
    };
  }

  return allCards;
}

/** Fetch current stock levels from all WB warehouses */
export async function fetchStocks(): Promise<WBStockItem[]> {
  return wbFetch<WBStockItem[]>("/api/wb/stocks");
}

/** Fetch orders for the last N days (default 30) */
export async function fetchOrders(days: number = 30): Promise<WBOrder[]> {
  return wbFetch<WBOrder[]>(`/api/wb/orders?days=${days}`);
}

/** Fetch Sales Funnel data for last 7 days (accurate order counts) */
export async function fetchFunnel(start: string, end: string): Promise<{ days: { date: string; orderCount: number }[]; total: number }> {
  return wbFetch<{ days: { date: string; orderCount: number }[]; total: number }>(
    `/api/wb/funnel?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`
  );
}

/** Fetch list of WB warehouses/offices */
export async function fetchWarehouses(): Promise<WBWarehouse[]> {
  return wbFetch<WBWarehouse[]>("/api/wb/warehouses");
}

export interface ScopeResult {
  name: string;
  ok: boolean;
}

export interface TestResult {
  ok: boolean;
  scopes: ScopeResult[];
}

/** Test API key — checks all WB API scopes in parallel */
export async function testApiKey(): Promise<TestResult> {
  try {
    return await wbFetch<TestResult>("/api/wb/test");
  } catch {
    return { ok: false, scopes: [] };
  }
}

// --- WB API response types ---

export interface WBCard {
  nmID: number;
  imtID: number;
  vendorCode: string;
  title: string;
  description: string;
  brand: string;
  dimensions: { length: number; width: number; height: number };
  sizes: WBCardSize[];
  createdAt: string;
  updatedAt: string;
  photos?: { big: string; c246x328: string }[];
  characteristics?: { id: number; name: string; value: unknown }[];
}

export interface WBCardSize {
  chrtID: number;
  techSize: string;
  skus: string[]; // barcodes
}

export interface WBCardsResponse {
  cards: WBCard[];
  cursor: {
    updatedAt: string;
    nmID: number;
    total?: number;
  };
}

export interface WBStockItem {
  lastChangeDate: string;
  warehouseName: string;
  supplierArticle: string;
  nmId: number;
  barcode: string;
  quantity: number;
  inWayToClient: number;
  inWayFromClient: number;
  quantityFull: number;
  category: string;
  subject: string;
  brand: string;
  techSize: string;
  Price: number;
  Discount: number;
  isSupply: boolean;
  isRealization: boolean;
  SCCode: string;
}

export interface WBOrder {
  date: string;
  lastChangeDate: string;
  warehouseName: string;
  supplierArticle: string;
  nmId: number;
  barcode: string;
  category: string;
  subject: string;
  brand: string;
  techSize: string;
  incomeID: number;
  isSupply: boolean;
  isRealization: boolean;
  totalPrice: number;
  discountPercent: number;
  spp: number;
  finishedPrice: number;
  priceWithDisc: number;
  isCancel: boolean;
  cancelDate: string;
  gNumber: string;
  sticker: string;
  srid: string;
  orderType: string;
  regionName: string;
  oblastOkrugName: string;
  countryName: string;
}

export interface WBWarehouse {
  id: number;
  name: string;
  address: string;
  city: string;
}
