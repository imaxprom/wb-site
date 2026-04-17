import { NextResponse } from "next/server";
import { getWbApiKey } from "@/lib/wb-api-key";

/**
 * GET — map of WB warehouses to their federal districts.
 * Source: WB Tariffs API (/api/v1/tariffs/box) — public data available to any seller key.
 * Caches in memory for 24h (data is effectively static).
 */

interface TariffWarehouse {
  warehouseName: string;
  geoName: string; // federal district like "Центральный федеральный округ" or "Казахстан" or ""
}

interface WarehouseRegion {
  warehouseName: string;
  district: string; // federal district name, or "" if non-RF / unassigned
}

let cache: { data: WarehouseRegion[]; ts: number } | null = null;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export async function GET() {
  if (cache && Date.now() - cache.ts < CACHE_TTL_MS) {
    return NextResponse.json({ warehouses: cache.data, source: "cache" });
  }

  const apiKey = getWbApiKey();
  if (!apiKey) {
    return NextResponse.json({ warehouses: [], source: "no-key" });
  }

  try {
    const date = new Date().toISOString().slice(0, 10);
    const res = await fetch(
      `https://common-api.wildberries.ru/api/v1/tariffs/box?date=${date}`,
      { headers: { Authorization: apiKey } }
    );
    if (!res.ok) {
      return NextResponse.json({ warehouses: [], source: "error", status: res.status });
    }
    const json = await res.json() as {
      response?: { data?: { warehouseList?: TariffWarehouse[] } };
    };
    const list = json.response?.data?.warehouseList ?? [];
    const data: WarehouseRegion[] = list
      .filter((w) => w.warehouseName)
      .map((w) => ({ warehouseName: w.warehouseName, district: w.geoName || "" }));
    cache = { data, ts: Date.now() };
    return NextResponse.json({ warehouses: data, source: "api" });
  } catch (err) {
    console.warn("[/api/data/warehouse-regions] failed:", err);
    return NextResponse.json({ warehouses: [], source: "exception" });
  }
}
