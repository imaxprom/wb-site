import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { getDb, initShipmentTables } from "@/lib/shipment-db";

interface AlertRow {
  article_wb: string;
  measurement_volume: number;
  card_volume: number;
  measured_at: string;
}

interface NewMeasurementRow {
  article_wb: string;
  measurement_volume: number;
  measured_at: string;
}

function tableExists(tableName: string): boolean {
  const db = getDb();
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(tableName);
  return Boolean(row);
}

export async function GET(request: NextRequest) {
  const authError = requireAdmin(request);
  if (authError) return authError;

  try {
    initShipmentTables();
    const db = getDb();

    if (!tableExists("warehouse_measurements")) {
      return NextResponse.json({ measurementOverCardCount: 0, newMeasurementsCount: 0, items: [], newItems: [] });
    }

    const items = db.prepare(`
      WITH latest AS (
        SELECT
          article_wb,
          volume,
          measured_at,
          ROW_NUMBER() OVER (
            PARTITION BY article_wb
            ORDER BY datetime(measured_at) DESC, dim_id DESC
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
      )
      SELECT
        latest.article_wb,
        latest.volume AS measurement_volume,
        card.card_volume,
        latest.measured_at
      FROM latest
      JOIN card USING(article_wb)
      WHERE latest.rn = 1
        AND latest.volume > card.card_volume
      ORDER BY latest.article_wb
    `).all() as AlertRow[];

    const newItems = db.prepare(`
      WITH latest AS (
        SELECT
          article_wb,
          volume,
          measured_at,
          ROW_NUMBER() OVER (
            PARTITION BY article_wb
            ORDER BY datetime(measured_at) DESC, dim_id DESC
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
        AND datetime(measured_at) >= datetime('now', '-7 days')
      ORDER BY datetime(measured_at) DESC, article_wb
    `).all() as NewMeasurementRow[];

    return NextResponse.json({
      measurementOverCardCount: items.length,
      newMeasurementsCount: newItems.length,
      items: items.map((item) => ({
        articleWB: item.article_wb,
        measurementVolumeLiters: Number(item.measurement_volume) || 0,
        cardVolumeLiters: Number(item.card_volume) || 0,
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
