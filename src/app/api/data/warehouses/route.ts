import { NextResponse } from "next/server";
import { getWbApiKey } from "@/lib/wb-api-key";
import { FALLBACK_WAREHOUSES } from "@/lib/warehouses-fallback";

/** GET — list of WB warehouse names. Falls back to hardcoded list if no API key. */
export async function GET() {
  const apiKey = getWbApiKey();

  if (apiKey) {
    try {
      const res = await fetch(
        "https://marketplace-api.wildberries.ru/api/v3/offices",
        { headers: { Authorization: apiKey } }
      );
      if (res.ok) {
        const data = await res.json() as { name: string }[];
        const names = data.map((w) => w.name).sort();
        if (names.length > 0) {
          return NextResponse.json({ warehouses: names, source: "api" });
        }
      }
    } catch { /* fall through to fallback */ }
  }

  return NextResponse.json({ warehouses: FALLBACK_WAREHOUSES, source: "fallback" });
}
