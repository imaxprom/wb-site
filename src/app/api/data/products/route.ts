import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { getProducts, getProductsPg, initShipmentTables } from "@/lib/shipment-db";
import { isPostgresEnabled } from "@/lib/postgres";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    initShipmentTables();
    const products = isPostgresEnabled() ? await getProductsPg() : getProducts();
    return NextResponse.json(products);
  } catch (err) {
    return apiError(err);
  }
}
