import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { getStock, getStockPg, initShipmentTables } from "@/lib/shipment-db";
import { isPostgresEnabled } from "@/lib/postgres";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    initShipmentTables();
    const stock = isPostgresEnabled() ? await getStockPg() : getStock();
    return NextResponse.json(stock);
  } catch (err) {
    return apiError(err);
  }
}
