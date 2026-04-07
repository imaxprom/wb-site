import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-utils";

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("x-wb-api-key");
  if (!apiKey) return NextResponse.json({ error: "API key missing" }, { status: 401 });

  try {
    const dateFrom = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const res = await fetch(
      `https://statistics-api.wildberries.ru/api/v1/supplier/stocks?dateFrom=${encodeURIComponent(dateFrom)}`,
      { headers: { Authorization: apiKey } }
    );

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: text }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json({
      total: data.length,
      sample: data.slice(0, 5),
    });
  } catch (err) {
    return apiError(err);
  }
}
