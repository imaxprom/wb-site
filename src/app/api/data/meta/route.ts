import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-utils";
import { initShipmentTables, getUploadDate } from "@/lib/shipment-db";

export async function GET() {
  try {
    initShipmentTables();
    const uploadDate = getUploadDate();
    return NextResponse.json({ uploadDate });
  } catch (err) {
    return apiError(err);
  }
}
