import { NextResponse } from "next/server";
import { initShipmentTables, getProducts } from "@/lib/shipment-db";

export async function GET() {
  try {
    initShipmentTables();
    const products = getProducts();
    return NextResponse.json(products);
  } catch (err) {
    console.error("[products] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
