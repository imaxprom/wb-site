import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";

export async function GET(req: NextRequest) {
  const authError = requireAdmin(req);
  if (authError) return authError;

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

    let totalQuantity = 0;
    let totalQuantityFull = 0;
    let totalInWayToClient = 0;
    let totalInWayFromClient = 0;

    for (const item of data) {
      totalQuantity += item.quantity || 0;
      totalQuantityFull += item.quantityFull || 0;
      totalInWayToClient += item.inWayToClient || 0;
      totalInWayFromClient += item.inWayFromClient || 0;
    }

    return NextResponse.json({
      records: data.length,
      quantity: totalQuantity,
      quantityFull: totalQuantityFull,
      inWayToClient: totalInWayToClient,
      inWayFromClient: totalInWayFromClient,
      reserved: totalQuantityFull - totalQuantity,
      formula: "quantityFull = quantity + reserved; reserved ≈ inWayToClient + ещё не отправленные",
    });
  } catch (err) {
    return apiError(err);
  }
}
