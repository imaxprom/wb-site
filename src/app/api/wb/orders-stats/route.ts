import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-utils";

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("x-wb-api-key");
  if (!apiKey) return NextResponse.json({ error: "API key missing" }, { status: 401 });

  try {
    // Match the file period: from Feb 19
    const dateFrom = "2026-02-19T00:00:00Z";
    const res = await fetch(
      `https://statistics-api.wildberries.ru/api/v1/supplier/orders?dateFrom=${encodeURIComponent(dateFrom)}&flag=0`,
      { headers: { Authorization: apiKey } }
    );

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: text }, { status: res.status });
    }

    const orders = await res.json();

    // Group by nmId
    const articles: Record<number, { supplier: string; total: number; cancels: number }> = {};
    for (const o of orders) {
      const nmid = o.nmId;
      if (!articles[nmid]) {
        articles[nmid] = { supplier: o.supplierArticle, total: 0, cancels: 0 };
      }
      articles[nmid].total++;
      if (o.isCancel) articles[nmid].cancels++;
    }

    const sorted = Object.entries(articles)
      .map(([nmid, data]) => ({
        nmid: Number(nmid),
        ...data,
        without: data.total - data.cancels,
      }))
      .sort((a, b) => b.without - a.without);

    const totalAll = orders.length;
    const cancelsAll = orders.filter((o: { isCancel: boolean }) => o.isCancel).length;

    return NextResponse.json({
      period: `19.02.2026 — сегодня`,
      totalOrders: totalAll,
      totalCancels: cancelsAll,
      totalWithout: totalAll - cancelsAll,
      articles: sorted,
    });
  } catch (err) {
    return apiError(err);
  }
}
