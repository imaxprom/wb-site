import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-utils";
import { initShipmentTables, getStock } from "@/lib/shipment-db";

export async function GET() {
  try {
    initShipmentTables();
    const stock = getStock();
    return NextResponse.json(stock);
  } catch (err) {
    return apiError(err);
  }
}
