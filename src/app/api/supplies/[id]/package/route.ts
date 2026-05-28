import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import {
  getAcceptedSupplyContent,
  getAcceptedSupplyContentPg,
  getDb,
  initShipmentTables,
  saveAcceptedSupplyContent,
  saveAcceptedSupplyContentPg,
  type AcceptedSupplyContentInput,
} from "@/lib/shipment-db";
import { isPostgresEnabled, isPostgresReadonlyConnection, pgRows } from "@/lib/postgres";
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

const packageCache = new Map<string, { ts: number; data: WbPackage[] }>();
const goodsCache = new Map<string, { ts: number; data: WbSupplyGood[] }>();
const detailCache = new Map<string, { ts: number; data: WbSupplyDetail }>();

function shouldMirrorSuppliesToPostgres(): boolean {
  return !isPostgresEnabled() && process.env.SUPPLIES_PG_MIRROR === "1" && Boolean(process.env.DATABASE_URL);
}

async function mirrorAcceptedSupplyContent(input: AcceptedSupplyContentInput): Promise<void> {
  if (!shouldMirrorSuppliesToPostgres()) return;
  try {
    await saveAcceptedSupplyContentPg(input);
  } catch (error) {
    console.error("Failed to mirror accepted WB supply content to PostgreSQL", error);
  }
}

async function persistAcceptedSupplyContent(input: AcceptedSupplyContentInput): Promise<void> {
  if (isPostgresEnabled()) {
    await saveAcceptedSupplyContentPg(input);
    return;
  }
  saveAcceptedSupplyContent(input);
  await mirrorAcceptedSupplyContent(input);
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

function buildBarcodeMeta(): Map<string, BarcodeMeta> {
  initShipmentTables();
  const db = getDb();
  const rows = db.prepare(`
    SELECT article_wb, name, sizes_json
    FROM shipment_products
    WHERE sizes_json IS NOT NULL AND sizes_json != ''
  `).all() as { article_wb: string; name: string | null; sizes_json: string }[];

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

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const { id } = await context.params;
    const pgMode = isPostgresEnabled();
    const supplyID = Number(id);
    if (Number.isSafeInteger(supplyID)) {
      const stored = pgMode
        ? await getAcceptedSupplyContentPg(supplyID)
        : getAcceptedSupplyContent(supplyID);
      if (stored) {
        if (!pgMode) {
          await mirrorAcceptedSupplyContent({
            supplyID,
            source: stored.source,
            payload: stored.payload,
          });
        }
        return NextResponse.json(withSortedBarcodeSizes(stored.payload as { articles?: ArticleSummary[] }));
      }
    }

    if (pgMode && isPostgresReadonlyConnection()) {
      return NextResponse.json(
        { error: "WB supply package live fetch is disabled in local PostgreSQL readonly mode. Localhost reads production-saved data only." },
        { status: 403 }
      );
    }

    const detail = await wbFetchDetail(id);
    const meta = pgMode ? await buildBarcodeMetaPg() : buildBarcodeMeta();

    if (detail.virtualTypeID === 5) {
      const goods = await wbFetchGoods(id);
      const articles = summarizeGoods(goods, meta);
      const totalQuantity = goods.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      const totalAcceptedQuantity = goods.reduce((sum, item) => sum + Number(item.acceptedQuantity || 0), 0);

      const payload = {
        supplyID: id,
        source: "goods",
        goods,
        articles,
        meta: {
          source: "goods",
          packageCount: 0,
          totalQuantity,
          totalAcceptedQuantity,
          articleCount: articles.length,
          barcodeCount: articles.reduce((sum, article) => sum + article.barcodes.length, 0),
        },
      };

      if (detail.statusID === 5 && Number.isSafeInteger(supplyID)) {
        await persistAcceptedSupplyContent({ supplyID, source: "goods", payload });
      }

      return NextResponse.json(withSortedBarcodeSizes(payload));
    }

    const packages = await wbFetchPackage(id);
    const articles = summarizeArticles(packages, meta);
    const totalQuantity = packagePackedQuantity(packages);

    const payload = {
      supplyID: id,
      source: "package",
      packages,
      articles,
      meta: {
        source: "package",
        packageCount: packages.length,
        totalQuantity,
        articleCount: articles.length,
        barcodeCount: articles.reduce((sum, article) => sum + article.barcodes.length, 0),
      },
    };

    if (detail.statusID === 5 && Number.isSafeInteger(supplyID)) {
      await persistAcceptedSupplyContent({ supplyID, source: "package", payload });
    }

    return NextResponse.json(withSortedBarcodeSizes(payload));
  } catch (error) {
    return apiError(error, error instanceof WbApiError ? error.status : 500);
  }
}
