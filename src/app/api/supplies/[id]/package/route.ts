import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import {
  getAcceptedSupplyContentPg,
  saveAcceptedSupplyContentPg,
  type AcceptedSupplyContentInput,
} from "@/lib/shipment-db";
import { isPostgresReadonlyConnection, pgGet, pgRows } from "@/lib/postgres";
import { getWbApiKey } from "@/lib/wb-api-key";

const SUPPLIES_API = "https://supplies-api.wildberries.ru/api/v1";
const PACKAGE_CACHE_TTL_MS = 15 * 60 * 1000;

interface WbPackageBarcode {
  barcode: string;
  quantity: number;
}

interface WbPackage {
  packageCode: string;
  quantity: number;
  barcodes: WbPackageBarcode[];
}

interface WbSupplyDetail {
  statusID?: number;
  virtualTypeID?: number;
}

interface WbSupplyGood {
  barcode: string;
  vendorCode?: string;
  nmID?: number;
  techSize?: string;
  quantity?: number;
  readyForSaleQuantity?: number;
  acceptedQuantity?: number;
}

interface ProductSize {
  size?: string;
  barcode?: string;
  perBox?: number;
}

interface BarcodeMeta {
  articleWB: string;
  name: string;
  size: string;
}

interface ArticleSummary {
  articleWB: string;
  name: string;
  quantity: number;
  acceptedQuantity?: number;
  barcodes: {
    barcode: string;
    size: string;
    quantity: number;
    acceptedQuantity?: number;
    boxes: string[];
  }[];
}

type BarcodeSummary = ArticleSummary["barcodes"][number];

interface StoredSupplyContentPayload {
  source?: "package" | "goods";
  packages?: WbPackage[];
  goods?: WbSupplyGood[];
  articles?: ArticleSummary[];
  meta?: {
    source?: "package" | "goods";
    packageCount?: number;
    totalQuantity?: number;
    totalAcceptedQuantity?: number;
    articleCount?: number;
    barcodeCount?: number;
  };
}

const packageCache = new Map<string, { ts: number; data: WbPackage[] }>();
const goodsCache = new Map<string, { ts: number; data: WbSupplyGood[] }>();
const detailCache = new Map<string, { ts: number; data: WbSupplyDetail }>();

async function persistAcceptedSupplyContent(input: AcceptedSupplyContentInput): Promise<void> {
  await saveAcceptedSupplyContentPg(input);
}

function safeJson<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

async function readStoredSupplyContentPg(supplyID: number): Promise<StoredSupplyContentPayload | null> {
  try {
    const row = await pgGet<{ payload_json: string }>(`
      SELECT payload_json
      FROM wb_supply_contents
      WHERE supply_id = ?
    `, [supplyID]);
    return safeJson<StoredSupplyContentPayload>(row?.payload_json);
  } catch (error) {
    if (error instanceof Error && /relation .* does not exist/i.test(error.message)) return null;
    throw error;
  }
}

async function persistSupplyContentPg(
  supplyID: number,
  source: "package" | "goods",
  payload: StoredSupplyContentPayload,
): Promise<void> {
  if (isPostgresReadonlyConnection()) return;
  const now = new Date().toISOString();
  await pgGet(`
    INSERT INTO wb_supply_contents (supply_id, source, payload_json, saved_at, refreshed_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(supply_id) DO UPDATE SET
      source = EXCLUDED.source,
      payload_json = EXCLUDED.payload_json,
      refreshed_at = EXCLUDED.refreshed_at
    RETURNING supply_id
  `, [supplyID, source, JSON.stringify(payload), now, now]);
}

class WbApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function getApiKey() {
  const apiKey = getWbApiKey();
  if (!apiKey) {
    throw new Error("WB API key is not configured");
  }
  return apiKey;
}

async function wbFetch<T>(path: string): Promise<T> {
  const apiKey = getApiKey();

  const res = await fetch(`${SUPPLIES_API}${path}`, {
    headers: {
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    throw new WbApiError(text || `WB API HTTP ${res.status}`, res.status);
  }

  return (text ? JSON.parse(text) : null) as T;
}

async function wbFetchDetail(supplyID: string): Promise<WbSupplyDetail> {
  const cached = detailCache.get(supplyID);
  if (cached && Date.now() - cached.ts < PACKAGE_CACHE_TTL_MS) {
    return cached.data;
  }

  const data = await wbFetch<WbSupplyDetail>(`/supplies/${encodeURIComponent(supplyID)}`);
  detailCache.set(supplyID, { ts: Date.now(), data });
  return data;
}

async function wbFetchPackage(supplyID: string): Promise<WbPackage[]> {
  const cached = packageCache.get(supplyID);
  if (cached && Date.now() - cached.ts < PACKAGE_CACHE_TTL_MS) {
    return cached.data;
  }

  const data = await wbFetch<WbPackage[]>(`/supplies/${encodeURIComponent(supplyID)}/package`);
  packageCache.set(supplyID, { ts: Date.now(), data });
  return data;
}

async function wbFetchGoods(supplyID: string): Promise<WbSupplyGood[]> {
  const cached = goodsCache.get(supplyID);
  if (cached && Date.now() - cached.ts < PACKAGE_CACHE_TTL_MS) {
    return cached.data;
  }

  const data = await wbFetch<WbSupplyGood[]>(`/supplies/${encodeURIComponent(supplyID)}/goods?limit=1000&offset=0`);
  goodsCache.set(supplyID, { ts: Date.now(), data });
  return data;
}

async function buildBarcodeMetaPg(): Promise<Map<string, BarcodeMeta>> {
  const rows = await pgRows<{ article_wb: string; name: string | null; sizes_json: string }>(`
    SELECT article_wb, name, sizes_json
    FROM shipment_products
    WHERE sizes_json IS NOT NULL AND sizes_json != ''
  `);

  const meta = new Map<string, BarcodeMeta>();
  for (const product of rows) {
    let sizes: ProductSize[] = [];
    try {
      const parsed = JSON.parse(product.sizes_json || "[]");
      if (Array.isArray(parsed)) sizes = parsed as ProductSize[];
    } catch {
      sizes = [];
    }

    for (const size of sizes) {
      const barcode = String(size.barcode || "").trim();
      if (!barcode) continue;
      meta.set(barcode, {
        articleWB: String(product.article_wb || ""),
        name: product.name || "",
        size: size.size || "",
      });
    }
  }
  return meta;
}

function summarizeArticles(packages: WbPackage[], meta: Map<string, BarcodeMeta>): ArticleSummary[] {
  const byArticle = new Map<string, ArticleSummary>();
  const barcodeRows = new Map<string, ArticleSummary["barcodes"][number]>();

  for (const pack of packages) {
    for (const item of pack.barcodes || []) {
      const barcode = String(item.barcode);
      const product = meta.get(barcode);
      const articleWB = product?.articleWB || "Не найден в базе";
      const articleName = product?.name || "";
      const articleKey = `${articleWB}:${articleName}`;

      let article = byArticle.get(articleKey);
      if (!article) {
        article = { articleWB, name: articleName, quantity: 0, barcodes: [] };
        byArticle.set(articleKey, article);
      }
      article.quantity += Number(item.quantity || 0);

      const barcodeKey = `${articleKey}:${barcode}`;
      let barcodeRow = barcodeRows.get(barcodeKey);
      if (!barcodeRow) {
        barcodeRow = {
          barcode,
          size: product?.size || "",
          quantity: 0,
          boxes: [],
        };
        barcodeRows.set(barcodeKey, barcodeRow);
        article.barcodes.push(barcodeRow);
      }
      barcodeRow.quantity += Number(item.quantity || 0);
      barcodeRow.boxes.push(`${pack.packageCode}: ${item.quantity}`);
    }
  }

  return Array.from(byArticle.values())
    .map((article) => ({
      ...article,
      barcodes: article.barcodes.sort(compareBarcodesBySize),
    }))
    .sort((a, b) => b.quantity - a.quantity || a.articleWB.localeCompare(b.articleWB));
}

function summarizeGoods(goods: WbSupplyGood[], meta: Map<string, BarcodeMeta>): ArticleSummary[] {
  const byArticle = new Map<string, ArticleSummary>();
  const barcodeRows = new Map<string, ArticleSummary["barcodes"][number]>();

  for (const item of goods) {
    const barcode = String(item.barcode || "").trim();
    if (!barcode) continue;

    const product = meta.get(barcode);
    const articleWB = item.nmID ? String(item.nmID) : product?.articleWB || "Не найден в базе";
    const articleName = item.vendorCode || product?.name || "";
    const articleKey = `${articleWB}:${articleName}`;
    const quantity = Number(item.quantity || 0);
    const acceptedQuantity = Number(item.acceptedQuantity || 0);

    let article = byArticle.get(articleKey);
    if (!article) {
      article = { articleWB, name: articleName, quantity: 0, acceptedQuantity: 0, barcodes: [] };
      byArticle.set(articleKey, article);
    }
    article.quantity += quantity;
    article.acceptedQuantity = Number(article.acceptedQuantity || 0) + acceptedQuantity;

    const barcodeKey = `${articleKey}:${barcode}`;
    let barcodeRow = barcodeRows.get(barcodeKey);
    if (!barcodeRow) {
      barcodeRow = {
        barcode,
        size: item.techSize || product?.size || "",
        quantity: 0,
        acceptedQuantity: 0,
        boxes: [],
      };
      barcodeRows.set(barcodeKey, barcodeRow);
      article.barcodes.push(barcodeRow);
    }
    barcodeRow.quantity += quantity;
    barcodeRow.acceptedQuantity = Number(barcodeRow.acceptedQuantity || 0) + acceptedQuantity;
  }

  return Array.from(byArticle.values())
    .map((article) => ({
      ...article,
      barcodes: article.barcodes.sort(compareBarcodesBySize),
    }))
    .sort((a, b) => b.quantity - a.quantity || a.articleWB.localeCompare(b.articleWB));
}

function sizeSortKey(size: string): [number, number, string] {
  const numbers = String(size || "")
    .match(/\d+/g)
    ?.map((value) => Number(value))
    .filter((value) => Number.isFinite(value)) || [];
  return [
    numbers[0] ?? Number.MAX_SAFE_INTEGER,
    numbers[1] ?? numbers[0] ?? Number.MAX_SAFE_INTEGER,
    String(size || ""),
  ];
}

function compareBarcodesBySize(a: BarcodeSummary, b: BarcodeSummary): number {
  const aKey = sizeSortKey(a.size);
  const bKey = sizeSortKey(b.size);
  return aKey[0] - bKey[0]
    || aKey[1] - bKey[1]
    || aKey[2].localeCompare(bKey[2], "ru")
    || a.barcode.localeCompare(b.barcode);
}

function withSortedBarcodeSizes<T extends { articles?: ArticleSummary[] }>(payload: T): T {
  if (!Array.isArray(payload.articles)) return payload;
  return {
    ...payload,
    articles: payload.articles.map((article) => ({
      ...article,
      barcodes: [...article.barcodes].sort(compareBarcodesBySize),
    })),
  };
}

function packagePackedQuantity(packages: WbPackage[]): number {
  return packages.reduce((sum, pack) => {
    const barcodeTotal = (pack.barcodes || []).reduce((itemSum, item) => itemSum + Number(item.quantity || 0), 0);
    return sum + (barcodeTotal || Number(pack.quantity || 0));
  }, 0);
}

function responseTotalQuantity(payload: { meta?: { totalQuantity?: number; totalAcceptedQuantity?: number }; articles?: ArticleSummary[] }): number {
  const metaTotal = Number(payload.meta?.totalQuantity || 0) + Number(payload.meta?.totalAcceptedQuantity || 0);
  if (metaTotal > 0) return metaTotal;
  return (payload.articles || []).reduce((sum, article) => {
    return sum + Number(article.quantity || 0) + Number(article.acceptedQuantity || 0);
  }, 0);
}

function hasBarcodeContent(payload: { meta?: { totalQuantity?: number; totalAcceptedQuantity?: number }; articles?: ArticleSummary[] }): boolean {
  return responseTotalQuantity(payload) > 0;
}

function buildGoodsPayload(supplyID: string, goods: WbSupplyGood[], meta: Map<string, BarcodeMeta>) {
  const articles = summarizeGoods(goods, meta);
  const totalQuantity = goods.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const totalAcceptedQuantity = goods.reduce((sum, item) => sum + Number(item.acceptedQuantity || 0), 0);

  return withSortedBarcodeSizes({
    supplyID,
    source: "goods" as const,
    goods,
    articles,
    meta: {
      source: "goods" as const,
      packageCount: 0,
      totalQuantity,
      totalAcceptedQuantity,
      articleCount: articles.length,
      barcodeCount: articles.reduce((sum, article) => sum + article.barcodes.length, 0),
    },
  });
}

function buildPackagePayload(supplyID: string, packages: WbPackage[], meta: Map<string, BarcodeMeta>) {
  const articles = summarizeArticles(packages, meta);
  const totalQuantity = packagePackedQuantity(packages);

  return withSortedBarcodeSizes({
    supplyID,
    source: "package" as const,
    packages,
    articles,
    meta: {
      source: "package" as const,
      packageCount: packages.length,
      totalQuantity,
      articleCount: articles.length,
      barcodeCount: articles.reduce((sum, article) => sum + article.barcodes.length, 0),
    },
  });
}

function buildStoredPayload(supplyID: string, stored: StoredSupplyContentPayload, meta: Map<string, BarcodeMeta>) {
  if (stored.goods && stored.goods.length > 0) {
    return buildGoodsPayload(supplyID, stored.goods || [], meta);
  }
  if (stored.packages && stored.packages.length > 0) {
    return buildPackagePayload(supplyID, stored.packages || [], meta);
  }
  if (Array.isArray(stored.articles) && stored.meta) {
    const payload = withSortedBarcodeSizes({
      supplyID,
      source: stored.source,
      articles: stored.articles,
      meta: stored.meta,
    });
    return hasBarcodeContent(payload) ? payload : null;
  }
  return null;
}

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { id } = await context.params;
    const supplyID = Number(id);
    let emptyStoredContent = false;
    if (Number.isSafeInteger(supplyID)) {
      const stored = await getAcceptedSupplyContentPg(supplyID);
      if (stored) {
        const payload = withSortedBarcodeSizes(stored.payload as { articles?: ArticleSummary[] });
        if (hasBarcodeContent(payload)) return NextResponse.json(payload);
        emptyStoredContent = true;
      }

      const storedContent = await readStoredSupplyContentPg(supplyID);
      if (storedContent) {
        const meta = await buildBarcodeMetaPg();
        const payload = buildStoredPayload(id, storedContent, meta);
        if (payload) return NextResponse.json(payload);
        emptyStoredContent = true;
      }
    }

    if (isPostgresReadonlyConnection()) {
      return NextResponse.json(
        {
          error: emptyStoredContent
            ? "Сохранённый состав поставки пустой: WB не отдал barcode-состав, вычесть её из плана по размерам невозможно."
            : "Состав поставки ещё не сохранён на production. Обновите поставки на production, затем повторите на локале.",
        },
        { status: 403 }
      );
    }

    const detail = await wbFetchDetail(id);
    const meta = await buildBarcodeMetaPg();

    if (detail.virtualTypeID === 5) {
      const goods = await wbFetchGoods(id);
      const payload = buildGoodsPayload(id, goods, meta);
      if (!hasBarcodeContent(payload)) {
        return NextResponse.json(
          { error: "WB не вернул barcode-состав поставки. Вычесть её из плана по размерам невозможно." },
          { status: 404 },
        );
      }

      if (Number.isSafeInteger(supplyID)) {
        await persistSupplyContentPg(supplyID, "goods", payload);
      }

      if (detail.statusID === 5 && Number.isSafeInteger(supplyID)) {
        await persistAcceptedSupplyContent({ supplyID, source: "goods", payload });
      }

      return NextResponse.json(payload);
    }

    const packages = await wbFetchPackage(id);
    const payload = buildPackagePayload(id, packages, meta);
    if (!hasBarcodeContent(payload)) {
      return NextResponse.json(
        { error: "WB не вернул barcode-состав поставки. Вычесть её из плана по размерам невозможно." },
        { status: 404 },
      );
    }

    if (Number.isSafeInteger(supplyID)) {
      await persistSupplyContentPg(supplyID, "package", payload);
    }

    if (detail.statusID === 5 && Number.isSafeInteger(supplyID)) {
      await persistAcceptedSupplyContent({ supplyID, source: "package", payload });
    }

    return NextResponse.json(payload);
  } catch (error) {
    return apiError(error, error instanceof WbApiError ? error.status : 500);
  }
}
