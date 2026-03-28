import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import {
  initShipmentTables,
  saveOrders,
  saveStock,
  saveProducts,
  setUploadDate,
} from "@/lib/shipment-db";
import { transformCards, transformStocks, transformOrders } from "@/lib/wb-transformers";
import type { WBCard, WBStockItem, WBOrder, WBCardsResponse } from "@/lib/wb-api";

function readApiKey(headerKey?: string | null): string {
  if (headerKey) return headerKey;
  // Try /tmp/wb_token.txt
  try {
    const token = fs.readFileSync("/tmp/wb_token.txt", "utf-8").trim();
    if (token) return token;
  } catch {
    // ignore
  }
  // Try data/wb-api-key.txt
  try {
    const token = fs.readFileSync(path.join(process.cwd(), "data", "wb-api-key.txt"), "utf-8").trim();
    if (token) return token;
  } catch {
    // ignore
  }
  return "";
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

async function fetchAllStocks(apiKey: string): Promise<WBStockItem[]> {
  const dateFrom = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const res = await fetch(
    `https://statistics-api.wildberries.ru/api/v1/supplier/stocks?dateFrom=${encodeURIComponent(dateFrom)}`,
    { headers: { Authorization: apiKey } }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`WB stocks API ${res.status}: ${text}`);
  }
  return res.json() as Promise<WBStockItem[]>;
}

async function fetchAllOrders(apiKey: string, days: number): Promise<WBOrder[]> {
  const bufferDays = 7;
  const dateFrom = new Date(Date.now() - (days + bufferDays) * 24 * 60 * 60 * 1000).toISOString();
  const res = await fetch(
    `https://statistics-api.wildberries.ru/api/v1/supplier/orders?dateFrom=${encodeURIComponent(dateFrom)}&flag=0`,
    { headers: { Authorization: apiKey } }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`WB orders API ${res.status}: ${text}`);
  }
  return res.json() as Promise<WBOrder[]>;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({})) as { days?: number };
    const days = Number(body.days) || 28;

    const apiKey = readApiKey(req.headers.get("x-wb-api-key"));
    if (!apiKey) {
      return NextResponse.json({ error: "API key not found" }, { status: 401 });
    }

    // Init tables
    initShipmentTables();

    // Fetch all 3 in parallel (cards + stocks, then orders separately since they're independent)
    const [rawCards, rawStocks, rawOrders] = await Promise.all([
      fetchAllCards(apiKey),
      fetchAllStocks(apiKey),
      fetchAllOrders(apiKey, days),
    ]);

    // Transform
    const products = transformCards(rawCards);
    const stock = transformStocks(rawStocks);
    const allOrders = transformOrders(rawOrders);

    // Trim orders: dateFrom <= date < today
    const now = new Date();
    const cutoffDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
    const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const cutoffStr = fmt(cutoffDate);
    const todayStr = fmt(todayDate);

    const trimmedOrders = allOrders.filter((o) => {
      const d = o.date.substring(0, 10);
      return d >= cutoffStr && d < todayStr;
    });

    // Save to SQLite
    saveProducts(products);
    saveStock(stock);
    saveOrders(trimmedOrders);
    setUploadDate(new Date().toISOString());

    return NextResponse.json({
      orders: trimmedOrders.length,
      stock: stock.length,
      products: products.length,
    });
  } catch (err) {
    console.error("[sync] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
