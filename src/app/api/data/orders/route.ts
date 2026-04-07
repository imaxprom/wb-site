import { NextRequest, NextResponse } from "next/server";
import { initShipmentTables, getOrders, getLastWeekCorrection } from "@/lib/shipment-db";
import { apiError } from "@/lib/api-utils";

export async function GET(req: NextRequest) {
  try {
    initShipmentTables();

    const now = new Date();
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    const fromParam = req.nextUrl.searchParams.get("from");
    const toParam = req.nextUrl.searchParams.get("to");
    const days = Number(req.nextUrl.searchParams.get("days") || "28");

    const cutoffDate = fromParam || fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate() - days));
    const toDate = toParam || fmt(new Date(now.getFullYear(), now.getMonth(), now.getDate()));

    // getOrders uses date < ?, so add 1 day to include the end date
    const endDate = new Date(toDate);
    endDate.setDate(endDate.getDate() + 1);
    const todayDate = fmt(endDate);

    const orders = getOrders(cutoffDate, todayDate);

    // Apply last-week correction only for default range (no explicit from/to)
    const corrections = getLastWeekCorrection();
    const globalCoeff = corrections.get("__global__") || 1;

    if (globalCoeff > 1 && !fromParam && !toParam) {
      // Find orders from last 7 days
      const sevenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      const sevenDaysAgoStr = fmt(sevenDaysAgo);

      const lastWeekOrders = orders.filter((o) => o.date.substring(0, 10) >= sevenDaysAgoStr);
      const extraNeeded = Math.round(lastWeekOrders.length * (globalCoeff - 1));

      if (extraNeeded > 0) {
        // Clone random orders from last week to fill the gap
        for (let i = 0; i < extraNeeded; i++) {
          const source = lastWeekOrders[i % lastWeekOrders.length];
          orders.push({ ...source });
        }
      }
    }

    return NextResponse.json(orders);
  } catch (err) {
    return apiError(err);
  }
}
