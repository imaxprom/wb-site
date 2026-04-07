import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-utils";

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("x-wb-api-key");
  if (!apiKey) return NextResponse.json({ error: "API key missing" }, { status: 401 });

  try {
    const days = Number(req.nextUrl.searchParams.get("days") || "30");
    // Request 7 extra days: WB API filters by lastChangeDate, not order date.
    // Without buffer, orders from the first days are lost (~800/day missing).
    const bufferDays = 7;
    const dateFrom = new Date(Date.now() - (days + bufferDays) * 24 * 60 * 60 * 1000).toISOString();

    const res = await fetch(
      `https://statistics-api.wildberries.ru/api/v1/supplier/orders?dateFrom=${encodeURIComponent(dateFrom)}&flag=0`,
      {
        headers: { Authorization: apiKey },
      }
    );

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `WB API ${res.status}: ${text}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return apiError(err);
  }
}
