import { NextRequest, NextResponse } from "next/server";
import { initShipmentTables, getOrders } from "@/lib/shipment-db";

export async function GET(req: NextRequest) {
  try {
    initShipmentTables();

    const days = Number(req.nextUrl.searchParams.get("days") || "28");
    const now = new Date();
    const cutoffDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
    const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    const orders = getOrders(fmt(cutoffDate), fmt(todayDate));
    return NextResponse.json(orders);
  } catch (err) {
    console.error("[orders] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
