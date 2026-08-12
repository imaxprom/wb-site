import { NextRequest, NextResponse } from "next/server";
import { activateAuthenticatedRequestContext, requireAdmin } from "@/lib/api-auth";
import { getPnlPg } from "@/modules/finance/lib/queries";
import { apiError } from "@/lib/api-utils";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  activateAuthenticatedRequestContext(request);

  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("from") || "2026-03-02";
  const dateTo = searchParams.get("to") || "2026-03-22";
  const nmId = searchParams.get("nm_id") ? Number(searchParams.get("nm_id")) : undefined;

  try {
    const pnl = await getPnlPg(dateFrom, dateTo, nmId);
    return NextResponse.json(pnl);
  } catch (error) {
    return apiError(error);
  }
}
