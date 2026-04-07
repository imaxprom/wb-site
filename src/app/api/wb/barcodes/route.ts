import { NextRequest, NextResponse } from "next/server";
import { getWbApiKey } from "@/lib/wb-api-key";

const WB_STATS_URL =
  "https://statistics-api.wildberries.ru/api/v5/supplier/reportDetailByPeriod";

interface WbReportRow {
  nm_id: number;
  barcode: string;
  sa_name: string;
  ts_name: string;
  supplier_oper_name: string;
  quantity: number;
  rr_dt: string;
  rrdid: number;
}

export interface BarcodeItem {
  barcode: string;
  nm_id: number;
  sa_name: string;
  ts_name: string;
  quantity: number;
}

function getToken(req: NextRequest): string | null {
  // 1. From request header
  const headerToken = req.headers.get("x-wb-token");
  if (headerToken) return headerToken;

  // 2. From env
  if (process.env.WB_TOKEN) return process.env.WB_TOKEN;

  // 3. From unified API key
  return getWbApiKey();
}

export async function GET(req: NextRequest) {
  const token = getToken(req);
  if (!token) {
    return NextResponse.json({ error: "WB token not found" }, { status: 401 });
  }

  const dateFrom = "2026-03-01";
  const dateTo = "2026-03-23";

  const barcodeMap = new Map<
    string,
    { nm_id: number; sa_name: string; ts_name: string; quantity: number }
  >();

  let rrdid = 0;
  let pageCount = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    pageCount++;
    const url = new URL(WB_STATS_URL);
    url.searchParams.set("dateFrom", dateFrom);
    url.searchParams.set("dateTo", dateTo);
    url.searchParams.set("limit", "100000");
    if (rrdid > 0) {
      url.searchParams.set("rrdid", String(rrdid));
    }

    let rows: WbReportRow[];
    try {
      const resp = await fetch(url.toString(), {
        headers: {
          Authorization: token,
          "Content-Type": "application/json",
        },
        // 60s timeout via AbortController
        signal: AbortSignal.timeout(60_000),
      });

      if (resp.status === 429) {
        // Rate limited — wait and retry
        await new Promise((r) => setTimeout(r, 60_000));
        continue;
      }

      if (!resp.ok) {
        const text = await resp.text();
        return NextResponse.json(
          { error: `WB API error ${resp.status}: ${text}` },
          { status: 502 }
        );
      }

      rows = await resp.json();
    } catch (err) {
      return NextResponse.json(
        { error: `Fetch failed: ${String(err)}` },
        { status: 502 }
      );
    }

    // Empty response = pagination done
    if (!rows || rows.length === 0) break;

    for (const row of rows) {
      if (row.supplier_oper_name !== "Продажа") continue;
      if (!row.barcode) continue;

      const existing = barcodeMap.get(row.barcode);
      if (existing) {
        existing.quantity += row.quantity || 0;
      } else {
        barcodeMap.set(row.barcode, {
          nm_id: row.nm_id,
          sa_name: row.sa_name || "",
          ts_name: row.ts_name || "",
          quantity: row.quantity || 0,
        });
      }

      // Track max rrdid for next page
      if (row.rrdid && row.rrdid > rrdid) {
        rrdid = row.rrdid;
      }
    }

    // If fewer rows than limit — no more pages
    if (rows.length < 100000) break;

    // Safety: max 50 pages
    if (pageCount >= 50) break;
  }

  // Build sorted result
  const result: BarcodeItem[] = Array.from(barcodeMap.entries()).map(
    ([barcode, data]) => ({ barcode, ...data })
  );

  result.sort((a, b) => {
    const sa = a.sa_name.localeCompare(b.sa_name, "ru");
    if (sa !== 0) return sa;
    return a.ts_name.localeCompare(b.ts_name, "ru");
  });

  return NextResponse.json(result);
}
