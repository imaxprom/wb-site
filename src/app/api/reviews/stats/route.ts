import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { getReviewStats, getReviewStatsPg, getComplaintStats, getComplaintStatsPg, initReviewTables } from "@/lib/reviews-db";
import { isPostgresEnabled } from "@/lib/postgres";

export async function GET(req: NextRequest) {
  const authError = await requireAdmin(req);
  if (authError) return authError;

  try {
    initReviewTables();
    const sp = req.nextUrl.searchParams;
    const accountId = sp.get("account_id") ? Number(sp.get("account_id")) : undefined;
    const period = sp.get("period") || "month";
    const stats = isPostgresEnabled()
      ? await getReviewStatsPg(accountId, period)
      : getReviewStats(accountId, period);
    const complaint_stats = isPostgresEnabled()
      ? await getComplaintStatsPg(accountId, period)
      : getComplaintStats(accountId, period);
    return NextResponse.json({ stats, complaint_stats });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
