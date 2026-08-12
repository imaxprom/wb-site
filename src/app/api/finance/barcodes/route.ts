import { NextRequest, NextResponse } from "next/server";
import { activateAuthenticatedRequestContext, requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { pgGet, pgRows } from "@/lib/postgres";

interface RealizationBarcodeRow {
  barcode: string;
  nm_id: number;
  sa_name: string | null;
  ts_name: string | null;
  last_seen: string | null;
  row_count: number;
}

interface ShipmentStockRow {
  article_wb: string;
  barcode: string;
  article_seller: string | null;
  size: string | null;
}

interface ShipmentProductRow {
  article_wb: string;
  sizes_json: string | null;
}

interface ProductSize {
  barcode?: unknown;
  size?: unknown;
}

interface BarcodeItem {
  barcode: string;
  nm_id: number;
  sa_name: string;
  ts_name: string;
}

interface BarcodeCandidate extends BarcodeItem {
  hasCurrentCatalogMatch: boolean;
  last_seen: string;
  row_count: number;
}

function clean(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

async function pgTableExists(tableName: string): Promise<boolean> {
  const row = await pgGet<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ?
    ) AS exists
  `, [tableName]);
  return Boolean(row?.exists);
}

function isBetterCandidate(
  candidate: BarcodeCandidate,
  current: BarcodeCandidate | undefined
): boolean {
  if (!current) return true;

  const checks = [
    [candidate.hasCurrentCatalogMatch, current.hasCurrentCatalogMatch],
    [Boolean(candidate.ts_name), Boolean(current.ts_name)],
    [Boolean(candidate.sa_name), Boolean(current.sa_name)],
  ] as const;

  for (const [next, prev] of checks) {
    if (next !== prev) return next;
  }

  if (candidate.last_seen !== current.last_seen) {
    return candidate.last_seen > current.last_seen;
  }

  if (candidate.row_count !== current.row_count) {
    return candidate.row_count > current.row_count;
  }

  return candidate.nm_id > current.nm_id;
}

/**
 * GET /api/finance/barcodes — unique barcodes with nm_id, sa_name, ts_name
 */
export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  activateAuthenticatedRequestContext(request);

  try {
    const stockByNmBarcode = new Map<string, ShipmentStockRow>();
    if (await pgTableExists("shipment_stock")) {
      const stockSql = `
        SELECT article_wb, barcode, article_seller, size
        FROM shipment_stock
        WHERE barcode != '' AND article_wb != ''
      `;
      const stockRows = await pgRows<ShipmentStockRow>(stockSql);

      for (const row of stockRows) {
        const articleWb = clean(row.article_wb);
        const barcode = clean(row.barcode);
        if (!articleWb || !barcode) continue;
        const key = `${articleWb}:${barcode}`;
        if (stockByNmBarcode.has(key)) continue;
        stockByNmBarcode.set(key, row);
      }
    }

    const productSizeByNmBarcode = new Map<string, string>();
    if (await pgTableExists("shipment_products")) {
      const productsSql = `
        SELECT article_wb, sizes_json
        FROM shipment_products
        WHERE article_wb != '' AND sizes_json IS NOT NULL AND sizes_json != ''
      `;
      const productRows = await pgRows<ShipmentProductRow>(productsSql);

      for (const product of productRows) {
        let sizes: unknown;
        try {
          sizes = JSON.parse(product.sizes_json || "[]");
        } catch {
          continue;
        }
        if (!Array.isArray(sizes)) continue;

        for (const size of sizes as ProductSize[]) {
          const barcode = clean(size.barcode);
          const sizeName = clean(size.size);
          if (!barcode || !sizeName) continue;
          productSizeByNmBarcode.set(`${clean(product.article_wb)}:${barcode}`, sizeName);
        }
      }
    }

    const realizationSql = `
      SELECT
        barcode,
        nm_id,
        TRIM(COALESCE(sa_name, '')) AS sa_name,
        TRIM(COALESCE(ts_name, '')) AS ts_name,
        MAX(COALESCE(
          NULLIF(rr_dt, ''),
          NULLIF(sale_dt, ''),
          NULLIF(order_dt, ''),
          NULLIF(date_to, ''),
          NULLIF(date_from, ''),
          ''
        )) AS last_seen,
        COUNT(*) AS row_count
      FROM realization
      WHERE barcode != '' AND nm_id > 0
      GROUP BY barcode, nm_id, TRIM(COALESCE(sa_name, '')), TRIM(COALESCE(ts_name, ''))
    `;
    const realizationRows = await pgRows<RealizationBarcodeRow>(realizationSql);

    const byBarcode = new Map<string, BarcodeCandidate>();
    for (const row of realizationRows) {
      const barcode = clean(row.barcode);
      if (!barcode) continue;

      const key = `${row.nm_id}:${barcode}`;
      const stock = stockByNmBarcode.get(key);
      const productSize = productSizeByNmBarcode.get(key) || "";

      const candidate: BarcodeCandidate = {
        barcode,
        nm_id: row.nm_id,
        sa_name: clean(stock?.article_seller) || clean(row.sa_name),
        ts_name: productSize || clean(stock?.size) || clean(row.ts_name),
        hasCurrentCatalogMatch: Boolean(productSize || clean(stock?.size)),
        last_seen: clean(row.last_seen),
        row_count: Number(row.row_count) || 0,
      };

      const current = byBarcode.get(barcode);
      if (isBetterCandidate(candidate, current)) {
        byBarcode.set(barcode, candidate);
      }
    }

    const rows: BarcodeItem[] = Array.from(byBarcode.values())
      .map(({ barcode, nm_id, sa_name, ts_name }) => ({
        barcode,
        nm_id,
        sa_name,
        ts_name,
      }))
      .sort((a, b) => {
        const byArticle = a.sa_name.localeCompare(b.sa_name, "ru");
        if (byArticle !== 0) return byArticle;
        const bySize = a.ts_name.localeCompare(b.ts_name, "ru");
        if (bySize !== 0) return bySize;
        return a.barcode.localeCompare(b.barcode, "ru");
      });

    return NextResponse.json(rows);
  } catch (error) {
    return apiError(error);
  }
}
