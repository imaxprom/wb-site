import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { getReviewStats, getComplaintStats, initReviewTables } from "@/lib/reviews-db";

export async function GET(req: NextRequest) {
  const authError = requireAdmin(req);
  if (authError) return authError;

  try {
    initReviewTables();
    const sp = req.nextUrl.searchParams;
    const accountId = sp.get("account_id") ? Number(sp.get("account_id")) : undefined;
    const period = sp.get("period") || "month";
    const stats = getReviewStats(accountId, period);
    const complaint_stats = getComplaintStats(accountId, period);
    return NextResponse.json({ stats, complaint_stats });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
