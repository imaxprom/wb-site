import { NextRequest, NextResponse } from "next/server";
import { getDb, getLastWeekCorrection, initShipmentTables } from "@/lib/shipment-db";
import { apiError } from "@/lib/api-utils";
import type { OrderAggregates } from "@/types";

/**
 * GET /api/data/orders-aggregated?days=28
 *
 * Заменяет /api/data/orders для клиентов, которым нужны агрегаты, а не сырые заказы.
 * Возвращает per-barcode totals + weekly buckets + per-district counts +
 * warehouse × region детализацию для РФ/СНГ разбивки.
 *
 * Логика должна совпадать с клиентским кодом:
 * - perBarcode.weekly — повторяет getWeeklyOrders: недели от (now-loadedDays) к now,
 *   "сегодня" не включается (exclusive). Учитывает все заказы (включая отмены), как в
 *   getWeeklyOrders.
 * - perDistrict — ВСЕ заказы включая отмены (legacy — ShipmentSettings делает так:
 *   отменённый заказ = потребность со склада, имеет смысл для распределения %).
 * - perWarehouseRegion — аналогично, ВСЕ заказы (для РФ/СНГ разбивки).
 * - totalOrders — включая отмены; totalNonCancelled — без.
 * - lastWeek correction — если getLastWeekCorrection() даёт globalCoeff > 1, инфлятим
 *   последние 7 дней (как /api/data/orders раньше делал клонированием).
 */

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toLocalISO(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function fmtDDMM(d: Date): string {
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}`;
}

export async function GET(req: NextRequest) {
  try {
    initShipmentTables();
    const days = Number(req.nextUrl.searchParams.get("days") || "28");

    const now = new Date();
    const firstDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
    const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dateFrom = toLocalISO(firstDate);
    const dateTo = toLocalISO(todayDate);

    const numWeeks = Math.max(1, Math.floor(days / 7));
    const weekBounds = Array.from({ length: numWeeks }, (_, w) => {
      const start = new Date(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate() + w * 7);
      const end = new Date(firstDate.getFullYear(), firstDate.getMonth(), firstDate.getDate() + (w + 1) * 7);
      return {
        week: w + 1,
        startISO: toLocalISO(start),
        endISO: toLocalISO(end),
        label: `Нед. ${w + 1}`,
        dateRange: `${fmtDDMM(start)} – ${fmtDDMM(new Date(end.getFullYear(), end.getMonth(), end.getDate() - 1))}`,
      };
    });

    const db = getDb();
    const rows = db.prepare(`
      SELECT date, warehouse, federal_district, region, article_seller, article_wb,
        barcode, size, is_cancel
      FROM shipment_orders
      WHERE date >= ? AND date < ?
    `).all(dateFrom, dateTo) as {
      date: string;
      warehouse: string | null;
      federal_district: string | null;
      region: string | null;
      article_seller: string | null;
      article_wb: number | null;
      barcode: string | null;
      size: string | null;
      is_cancel: number;
    }[];

    // Correction multiplier: клонируем заказы последних 7 дней
    const corrections = getLastWeekCorrection();
    const globalCoeff = corrections.get("__global__") || 1;
    const sevenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
    const sevenDaysAgoISO = toLocalISO(sevenDaysAgo);
    const applyCorrection = globalCoeff > 1;

    const perBarcode: OrderAggregates["perBarcode"] = {};
    const perDistrict: Record<string, number> = {};
    const warehouseRegionMap = new Map<string, { warehouse: string; federalDistrict: string; region: string; count: number }>();
    let totalOrders = 0;
    let totalNonCancelled = 0;

    // Основной проход
    for (const r of rows) {
      const barcode = r.barcode || "";
      if (!barcode) continue;
      const dateStr = (r.date || "").substring(0, 10);
      const isCancel = r.is_cancel === 1;
      const district = r.federal_district || "";
      const region = r.region || "";
      const warehouse = r.warehouse || "";

      // Multiplier: реплицируем каждый заказ последних 7 дней globalCoeff раз
      // (как раньше клонировал /api/data/orders). Дробная часть — округляем к ближайшему int.
      const mult = applyCorrection && dateStr >= sevenDaysAgoISO
        ? Math.max(1, Math.round(globalCoeff))
        : 1;

      for (let m = 0; m < mult; m++) {
        totalOrders++;
        if (!isCancel) totalNonCancelled++;

        // Per-barcode
        let bAgg = perBarcode[barcode];
        if (!bAgg) {
          bAgg = {
            barcode,
            articleWB: String(r.article_wb ?? ""),
            size: r.size || "",
            articleSeller: r.article_seller || "",
            totalOrders: 0,
            cancelledOrders: 0,
            weekly: weekBounds.map(w => ({ week: w.week, label: w.label, orders: 0, dateRange: w.dateRange })),
          };
          perBarcode[barcode] = bAgg;
        }
        bAgg.totalOrders++;
        if (isCancel) bAgg.cancelledOrders++;

        // Weekly (включая отмены — как getWeeklyOrders)
        for (let w = 0; w < weekBounds.length; w++) {
          const wb = weekBounds[w];
          if (dateStr >= wb.startISO && dateStr < wb.endISO) {
            bAgg.weekly[w].orders++;
            break;
          }
        }

        // Per-district / per-warehouse-region — включая отмены (legacy логика).
        if (district) {
          perDistrict[district] = (perDistrict[district] || 0) + 1;
        }
        const whKey = `${warehouse}|${district}|${region}`;
        const wrEntry = warehouseRegionMap.get(whKey);
        if (wrEntry) {
          wrEntry.count++;
        } else {
          warehouseRegionMap.set(whKey, { warehouse, federalDistrict: district, region, count: 1 });
        }
      }
    }

    const result: OrderAggregates = {
      loadedDays: days,
      dateFrom,
      dateTo,
      totalOrders,
      totalNonCancelled,
      perBarcode,
      perDistrict,
      perWarehouseRegion: Array.from(warehouseRegionMap.values()),
    };

    return NextResponse.json(result);
  } catch (err) {
    return apiError(err);
  }
}
