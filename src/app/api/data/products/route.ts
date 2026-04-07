import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-utils";
import { initShipmentTables, getProducts } from "@/lib/shipment-db";

export async function GET() {
  try {
    initShipmentTables();
    const products = getProducts();
    return NextResponse.json(products);
  } catch (err) {
    return apiError(err);
  }
}
