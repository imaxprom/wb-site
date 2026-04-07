import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-utils";

/**
 * Sales Funnel API — получить orderCount по дням за последние 7 дней.
 * Один запрос — все дни.
 *
 * GET /api/wb/funnel?start=2026-03-21&end=2026-03-27
 * Response: { days: [{ date: "2026-03-21", orderCount: 1231 }, ...], total: 7628 }
 */
export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("x-wb-api-key");
  if (!apiKey) return NextResponse.json({ error: "API key missing" }, { status: 401 });

  const start = req.nextUrl.searchParams.get("start");
  const end = req.nextUrl.searchParams.get("end");

  if (!start || !end) {
    return NextResponse.json({ error: "start and end params required" }, { status: 400 });
  }

  try {
    const res = await fetch(
      "https://seller-analytics-api.wildberries.ru/api/analytics/v3/sales-funnel/grouped/history",
      {
        method: "POST",
        headers: { Authorization: apiKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          brandNames: [],
          subjectIds: [],
          tagIds: [],
          selectedPeriod: { start, end },
          aggregationLevel: "day",
        }),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: `WB API ${res.status}: ${text}` }, { status: res.status });
    }

    const data = (await res.json()) as {
      data?: { history?: { date: string; orderCount: number; orderSum: number }[] }[];
    };

    const history = data?.data?.[0]?.history || [];
    const days = history
      .map((h) => ({ date: h.date, orderCount: h.orderCount }))
      .sort((a, b) => a.date.localeCompare(b.date));
    const total = days.reduce((s, d) => s + d.orderCount, 0);

    return NextResponse.json({ days, total });
  } catch (err) {
    return apiError(err);
  }
}
