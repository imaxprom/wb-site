import { NextResponse } from "next/server";
import { getWbApiKey } from "@/lib/wb-api-key";
import { FALLBACK_WAREHOUSES } from "@/lib/warehouses-fallback";

/** GET — list of WB warehouses. If `?raw=1`, returns full raw response from WB for inspection. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const raw = url.searchParams.get("raw") === "1";

  const apiKey = getWbApiKey();

  if (apiKey) {
    try {
      const res = await fetch(
        "https://marketplace-api.wildberries.ru/api/v3/offices",
        { headers: { Authorization: apiKey } }
      );
      if (res.ok) {
        const data = await res.json() as Array<Record<string, unknown>>;

        if (raw) {
          // Debug: return full raw response with a sample + field keys
          const sampleKeys = data.length > 0 ? Object.keys(data[0]) : [];
          return NextResponse.json({
            count: data.length,
            fieldKeys: sampleKeys,
            first3: data.slice(0, 3),
            all: data,
          });
        }

        // Log raw first entry to server console for quick inspection
        if (data.length > 0) {
          console.log("[/api/data/warehouses] WB /offices sample:", JSON.stringify(data[0]));
          console.log("[/api/data/warehouses] WB /offices keys:", Object.keys(data[0]));
        }

        const names = data
          .map((w) => typeof w.name === "string" ? w.name : "")
          .filter(Boolean)
          .sort();
        if (names.length > 0) {
          return NextResponse.json({ warehouses: names, source: "api" });
        }
      }
    } catch (err) {
      console.warn("[/api/data/warehouses] WB /offices failed:", err);
    }
  }

  return NextResponse.json({ warehouses: FALLBACK_WAREHOUSES, source: "fallback" });
}
