import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { isPostgresEnabled, pgRows } from "@/lib/postgres";
import { getDb } from "@/modules/finance/lib/queries";

export interface BarcodeItem {
  barcode: string;
  nm_id: number;
  sa_name: string;
  ts_name: string;
}

export async function GET(req: NextRequest) {
  const authError = await requireAdmin(req);
  if (authError) return authError;

  try {
    const sql = `
      WITH realization_barcodes AS (
        SELECT
          barcode,
          MAX(nm_id) AS nm_id,
          TRIM(COALESCE(MAX(NULLIF(sa_name, '')), '')) AS sa_name,
          TRIM(COALESCE(MAX(NULLIF(ts_name, '')), '')) AS ts_name
        FROM realization
        WHERE barcode != '' AND nm_id > 0
        GROUP BY barcode
      ),
      stock_barcodes AS (
        SELECT
          barcode,
          MAX(CAST(article_wb AS INTEGER)) AS nm_id,
          TRIM(COALESCE(MAX(NULLIF(article_seller, '')), '')) AS sa_name,
          TRIM(COALESCE(MAX(NULLIF(size, '')), '')) AS ts_name
        FROM shipment_stock
        WHERE barcode != '' AND article_wb != ''
        GROUP BY barcode
      )
      SELECT
        COALESCE(s.barcode, r.barcode) AS barcode,
        COALESCE(s.nm_id, r.nm_id, 0) AS nm_id,
        COALESCE(NULLIF(s.sa_name, ''), r.sa_name, '') AS sa_name,
        COALESCE(NULLIF(s.ts_name, ''), r.ts_name, '') AS ts_name
      FROM realization_barcodes r
      FULL OUTER JOIN stock_barcodes s ON s.barcode = r.barcode
      ORDER BY sa_name, ts_name, barcode
    `;

    const rows = isPostgresEnabled()
      ? await pgRows<BarcodeItem>(sql)
      : getDb().prepare(sql.replace("FULL OUTER JOIN", "LEFT JOIN")).all() as BarcodeItem[];

    return NextResponse.json(rows);
  } catch (err) {
    return apiError(err);
  }
}
