import { NextResponse } from "next/server";
import { getSyncStatusDb, getReviewsCount } from "@/lib/reviews-db";

export async function GET() {
  const status = getSyncStatusDb();

  if (status.status === "idle") {
    const dbCount = getReviewsCount();
    return NextResponse.json({
      ...status,
      loaded: dbCount,
      total: dbCount,
      message: dbCount > 0
        ? `В базе: ${dbCount.toLocaleString("ru-RU")} из ${dbCount.toLocaleString("ru-RU")} ✅`
        : "",
    });
  }

  return NextResponse.json(status);
}
