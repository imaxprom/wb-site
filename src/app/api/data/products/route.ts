import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { initShipmentTables, getProducts } from "@/lib/shipment-db";

export async function GET(request: NextRequest) {
  const authError = requireAdmin(request);
  if (authError) return authError;

  try {
    initShipmentTables();
    const products = getProducts();
    return NextResponse.json(products);
  } catch (err) {
    return apiError(err);
  }
}
