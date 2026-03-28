import { NextResponse } from "next/server";
import { initShipmentTables, getStock } from "@/lib/shipment-db";

export async function GET() {
  try {
    initShipmentTables();
    const stock = getStock();
    return NextResponse.json(stock);
  } catch (err) {
    console.error("[stock] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
