import { NextRequest, NextResponse } from "next/server";
import { activateAuthenticatedRequestContext, requireAdmin } from "@/lib/api-auth";
import { getReviewStatsPg, getComplaintStatsPg } from "@/lib/reviews-db";

export async function GET(req: NextRequest) {
  const authError = await requireAdmin(req);
  if (authError) return authError;
  activateAuthenticatedRequestContext(req);

  try {
    const sp = req.nextUrl.searchParams;
    const accountId = sp.get("account_id") ? Number(sp.get("account_id")) : undefined;
    const period = sp.get("period") || "month";
    const stats = await getReviewStatsPg(accountId, period);
    const complaint_stats = await getComplaintStatsPg(accountId, period);
    return NextResponse.json({ stats, complaint_stats });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
