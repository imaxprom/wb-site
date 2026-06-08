import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { getSyncStatusDbPg, getReviewsCountPg } from "@/lib/reviews-db";

export async function GET(req: NextRequest) {
  const authError = await requireAdmin(req);
  if (authError) return authError;

  const status = await getSyncStatusDbPg();

  if (status.status === "idle") {
    const dbCount = await getReviewsCountPg();
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
