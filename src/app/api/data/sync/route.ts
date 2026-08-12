import { NextRequest, NextResponse } from "next/server";
import { activateAuthenticatedRequestContext, requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { activateCronOrganizationContext, enterCronOrganizationContext, isCronRequest } from "@/lib/cron-auth";
import {
  saveOrdersPg,
  saveProductsPg,
  saveStockPg,
  setUploadDatePg,
} from "@/lib/shipment-db";
import { transformCards, transformWarehouseRemains, transformOrders } from "@/lib/wb-transformers";
import type { WBCard, WBWarehouseRemainsItem, WBOrder, WBCardsResponse } from "@/lib/wb-api";
import { getWbApiKey } from "@/lib/wb-api-key";
import { isPostgresReadonlyConnection } from "@/lib/postgres";

function readApiKey(headerKey?: string | null): string {
  if (headerKey) return headerKey;
  return getWbApiKey() || "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRetryDelayMs(res: Response): number {
  const retryHeader = res.headers.get("x-ratelimit-retry") || res.headers.get("retry-after");
  const resetHeader = res.headers.get("x-ratelimit-reset");
  const retrySeconds = Number(retryHeader);
  const resetSeconds = Number(resetHeader);

  if (Number.isFinite(retrySeconds) && retrySeconds > 0) {
    return Math.min(Math.ceil(retrySeconds + 1), 90) * 1000;
  }
  if (Number.isFinite(resetSeconds) && resetSeconds > 0) {
    return Math.min(Math.ceil(resetSeconds + 1), 90) * 1000;
  }

  return 65_000;
}

async function fetchWithRateLimitRetry(
  url: string,
  options: RequestInit,
  label: string,
  maxRetries = 2
): Promise<Response> {
  let lastText = "";

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const res = await fetch(url, options);
    if (res.ok) return res;

    lastText = await res.text().catch(() => "");
    if (res.status !== 429 || attempt >= maxRetries) {
      throw new Error(`${label} ${res.status}: ${lastText}`);
    }

    await sleep(getRetryDelayMs(res));
  }

  throw new Error(`${label}: ${lastText || "request failed"}`);
}

async function fetchAllCards(apiKey: string): Promise<WBCard[]> {
  const allCards: WBCard[] = [];
  let cursor = { limit: 100, updatedAt: "", nmID: 0 };

  while (true) {
    const wbBody = {
      settings: {
        sort: { ascending: false },
        cursor: {
          limit: cursor.limit,
          ...(cursor.updatedAt ? { updatedAt: cursor.updatedAt } : {}),
          ...(cursor.nmID ? { nmID: cursor.nmID } : {}),
        },
        filter: { withPhoto: -1 },
      },
    };

    const res = await fetch("https://content-api.wildberries.ru/content/v2/get/cards/list", {
      method: "POST",
      headers: { Authorization: apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(wbBody),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`WB cards API ${res.status}: ${text}`);
    }

    const data = (await res.json()) as WBCardsResponse;
    allCards.push(...(data.cards || []));

    if (!data.cursor || (data.cursor.total ?? 0) < cursor.limit) break;
    cursor = {
      limit: 100,
      updatedAt: data.cursor.updatedAt || "",
      nmID: data.cursor.nmID || 0,
    };
  }

  return allCards;
}

async function fetchWarehouseRemains(apiKey: string): Promise<WBWarehouseRemainsItem[]> {
  const url = new URL("https://seller-analytics-api.wildberries.ru/api/v1/warehouse_remains");
  url.searchParams.set("locale", "ru");
  url.searchParams.set("groupByNm", "true");
  url.searchParams.set("groupByBarcode", "true");
  url.searchParams.set("groupBySize", "true");
  url.searchParams.set("filterPics", "0");
  url.searchParams.set("filterVolume", "0");

  const createRes = await fetchWithRateLimitRetry(
    url.toString(),
    { headers: { Authorization: apiKey } },
    "WB warehouse remains create"
  );
  const createData = await createRes.json().catch(() => ({}));
  const taskId = createData?.data?.taskId || createData?.data?.id || createData?.taskId || createData?.id;
  if (!taskId) {
    throw new Error("WB warehouse remains create: task id missing");
  }

  let status = "";
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await sleep(3_000);
    const statusRes = await fetchWithRateLimitRetry(
      `https://seller-analytics-api.wildberries.ru/api/v1/warehouse_remains/tasks/${taskId}/status`,
      { headers: { Authorization: apiKey } },
      "WB warehouse remains status",
      1
    );
    const statusData = await statusRes.json().catch(() => ({}));
    status = statusData?.data?.status || statusData?.status || "";
    if (status === "done") break;
    if (status === "canceled" || status === "purged") {
      throw new Error(`WB warehouse remains task ${status}`);
    }
  }

  if (status !== "done") {
    throw new Error(`WB warehouse remains poll timeout, last status=${status || "unknown"}`);
  }

  const downloadRes = await fetchWithRateLimitRetry(
    `https://seller-analytics-api.wildberries.ru/api/v1/warehouse_remains/tasks/${taskId}/download`,
    { headers: { Authorization: apiKey } },
    "WB warehouse remains download"
  );
  const payload = await downloadRes.json();
  if (Array.isArray(payload)) return payload as WBWarehouseRemainsItem[];
  if (Array.isArray(payload?.data)) return payload.data as WBWarehouseRemainsItem[];
  if (Array.isArray(payload?.data?.report)) return payload.data.report as WBWarehouseRemainsItem[];
  if (Array.isArray(payload?.report)) return payload.report as WBWarehouseRemainsItem[];
  return [];
}

async function fetchAllOrders(apiKey: string, days: number): Promise<WBOrder[]> {
  const bufferDays = 7;
  const dateFrom = new Date(Date.now() - (days + bufferDays) * 24 * 60 * 60 * 1000).toISOString();
  const res = await fetchWithRateLimitRetry(
    `https://statistics-api.wildberries.ru/api/v1/supplier/orders?dateFrom=${encodeURIComponent(dateFrom)}&flag=0`,
    { headers: { Authorization: apiKey } },
    "WB orders API"
  );
  return res.json() as Promise<WBOrder[]>;
}

export async function POST(req: NextRequest) {
  const cronRequest = isCronRequest(req);
  if (cronRequest) {
    if (!await enterCronOrganizationContext(req)) {
      return NextResponse.json({ error: "Active organization is required for cron" }, { status: 400 });
    }
    activateCronOrganizationContext(req);
  } else {
    const authError = await requireAdmin(req);
    if (authError) return authError;
    activateAuthenticatedRequestContext(req);
  }

  try {
    const body = await req.json().catch(() => ({})) as { days?: number };
    const days = Number(body.days) || 28;

    if (isPostgresReadonlyConnection()) {
      return NextResponse.json(
        { error: "Sync is disabled in local PostgreSQL readonly mode" },
        { status: 403 }
      );
    }

    const apiKey = readApiKey(req.headers.get("x-wb-api-key"));
    if (!apiKey) {
      return NextResponse.json({ error: "API key not found" }, { status: 401 });
    }

    const warnings: string[] = [];

    // Cards, warehouse remains and orders use separate WB services/limiters.
    const rawCardsPromise = fetchAllCards(apiKey);

    let rawStocks: WBWarehouseRemainsItem[] | null = null;
    try {
      rawStocks = await fetchWarehouseRemains(apiKey);
    } catch (err) {
      warnings.push(err instanceof Error ? err.message : String(err));
    }

    const rawOrders = await fetchAllOrders(apiKey, days);
    const rawCards = await rawCardsPromise;

    // Transform
    const products = transformCards(rawCards);
    const stock = rawStocks?.length ? transformWarehouseRemains(rawStocks, products) : null;
    const allOrders = transformOrders(rawOrders);

    // Save ALL orders (accumulate, no trimming). Duplicates are handled by
    // PostgreSQL ON CONFLICT in shipment-db.
    // Stock is always replaced (current state), products are upserted
    const productsResult = await saveProductsPg(products);
    const stockResult = stock ? await saveStockPg(stock) : { total: 0, written: 0, skipped: 0 };
    await saveOrdersPg(allOrders);
    await setUploadDatePg(new Date().toISOString());

    return NextResponse.json({
      orders: allOrders.length,
      stock: stock?.length ?? 0,
      stockSkipped: !stock,
      products: products.length,
      warnings,
      idempotent: {
        products: productsResult,
        stock: stockResult,
      },
    });
  } catch (err) {
    return apiError(err);
  }
}
