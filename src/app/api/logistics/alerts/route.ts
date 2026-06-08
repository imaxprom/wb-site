import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { initShipmentTablesPg } from "@/lib/shipment-db";
import { pgGet, pgRows } from "@/lib/postgres";

interface AlertRow {
  article_wb: string;
  measurement_volume: number;
  card_volume: number;
  remains_volume: number | null;
  measured_at: string;
}

interface NewMeasurementRow {
  article_wb: string;
  measurement_volume: number;
  measured_at: string;
}

async function tableExistsPg(tableName: string): Promise<boolean> {
  const row = await pgGet<{ exists: boolean }>(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ?
    ) AS exists
  `, [tableName]);
  return Boolean(row?.exists);
}

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    await initShipmentTablesPg();

    const hasWarehouseMeasurements = await tableExistsPg("warehouse_measurements");
    if (!hasWarehouseMeasurements) {
      return NextResponse.json({ measurementOverCardCount: 0, newMeasurementsCount: 0, items: [], newItems: [] });
    }

    const hasWarehouseRemainsVolume = await tableExistsPg("warehouse_remains_volume");
    const remainsCte = hasWarehouseRemainsVolume ? `,
      remains AS (
        SELECT
          article_wb,
          MAX(volume) AS remains_volume
        FROM warehouse_remains_volume
        WHERE volume > 0
        GROUP BY article_wb
      )` : "";
    const remainsSelect = hasWarehouseRemainsVolume ? "remains.remains_volume" : "NULL AS remains_volume";
    const remainsJoin = hasWarehouseRemainsVolume ? "LEFT JOIN remains USING(article_wb)" : "";
    const remainsCondition = hasWarehouseRemainsVolume
      ? "AND (remains.remains_volume IS NULL OR remains.remains_volume > card.card_volume)"
      : "";

    const itemsSql = `
      WITH latest AS (
        SELECT
          article_wb,
          volume,
          measured_at,
          ROW_NUMBER() OVER (
            PARTITION BY article_wb
            ORDER BY measured_at DESC, dim_id DESC
          ) AS rn
        FROM warehouse_measurements
        WHERE volume > 0
      ),
      card AS (
        SELECT
          article_wb,
          (length_cm * width_cm * height_cm / 1000.0) AS card_volume
        FROM shipment_products
        WHERE length_cm > 0 AND width_cm > 0 AND height_cm > 0
      )${remainsCte}
      SELECT
        latest.article_wb,
        latest.volume AS measurement_volume,
        card.card_volume,
        ${remainsSelect},
        latest.measured_at
      FROM latest
      JOIN card USING(article_wb)
      ${remainsJoin}
      WHERE latest.rn = 1
        AND latest.volume > card.card_volume
        ${remainsCondition}
      ORDER BY latest.article_wb
    `;
    const items = await pgRows<AlertRow>(itemsSql);

    const newItemsSql = `
      WITH latest AS (
        SELECT
          article_wb,
          volume,
          measured_at,
          ROW_NUMBER() OVER (
            PARTITION BY article_wb
            ORDER BY measured_at DESC, dim_id DESC
          ) AS rn
        FROM warehouse_measurements
        WHERE volume > 0
      )
      SELECT
        article_wb,
        volume AS measurement_volume,
        measured_at
      FROM latest
      WHERE rn = 1
        AND measured_at >= ?
      ORDER BY measured_at DESC, article_wb
    `;
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const newItems = await pgRows<NewMeasurementRow>(newItemsSql, [sevenDaysAgo]);

    return NextResponse.json({
      measurementOverCardCount: items.length,
      newMeasurementsCount: newItems.length,
      items: items.map((item) => ({
        articleWB: item.article_wb,
        measurementVolumeLiters: Number(item.measurement_volume) || 0,
        cardVolumeLiters: Number(item.card_volume) || 0,
        remainsVolumeLiters: item.remains_volume === null ? null : Number(item.remains_volume) || null,
        measuredAt: item.measured_at,
      })),
      newItems: newItems.map((item) => ({
        articleWB: item.article_wb,
        measurementVolumeLiters: Number(item.measurement_volume) || 0,
        measuredAt: item.measured_at,
      })),
    });
  } catch (error) {
    return apiError(error);
  }
}
