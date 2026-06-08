import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { getStockPg } from "@/lib/shipment-db";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const stock = await getStockPg();
    return NextResponse.json(stock);
  } catch (err) {
    return apiError(err);
  }
}
