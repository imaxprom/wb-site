import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { getSyncStatusDb, getReviewsCount } from "@/lib/reviews-db";

export async function GET(req: NextRequest) {
  const authError = requireAdmin(req);
  if (authError) return authError;

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
