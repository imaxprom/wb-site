import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { getSyncStatusDb, getSyncStatusDbPg, getReviewsCount, getReviewsCountPg } from "@/lib/reviews-db";
import { isPostgresEnabled } from "@/lib/postgres";

export async function GET(req: NextRequest) {
  const authError = await requireAdmin(req);
  if (authError) return authError;

  const pgMode = isPostgresEnabled();
  const status = pgMode ? await getSyncStatusDbPg() : getSyncStatusDb();

  if (status.status === "idle") {
    const dbCount = pgMode ? await getReviewsCountPg() : getReviewsCount();
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
