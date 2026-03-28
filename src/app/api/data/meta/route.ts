import { NextResponse } from "next/server";
import { initShipmentTables, getUploadDate } from "@/lib/shipment-db";

export async function GET() {
  try {
    initShipmentTables();
    const uploadDate = getUploadDate();
    return NextResponse.json({ uploadDate });
  } catch (err) {
    console.error("[meta] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 }
    );
  }
}
