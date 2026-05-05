import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { initShipmentTables, getUploadDate } from "@/lib/shipment-db";

export async function GET(request: NextRequest) {
  const authError = requireAdmin(request);
  if (authError) return authError;

  try {
    initShipmentTables();
    const uploadDate = getUploadDate();
    return NextResponse.json({ uploadDate });
  } catch (err) {
    return apiError(err);
  }
}
