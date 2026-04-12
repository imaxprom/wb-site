import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-utils";
import { getDb } from "@/modules/finance/lib/queries";

/**
 * GET /api/finance/barcodes — unique barcodes with nm_id, sa_name, ts_name
 */
export async function GET() {
  try {
    const d = getDb();
    const rows = d.prepare(`
      SELECT DISTINCT barcode, nm_id, sa_name, ts_name
      FROM realization
      WHERE barcode != '' AND nm_id > 0
      ORDER BY sa_name, ts_name
    `).all();
    return NextResponse.json(rows);
  } catch (error) {
    return apiError(error);
  }
}
