import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { getPnl } from "@/modules/finance/lib/queries";
import { apiError } from "@/lib/api-utils";

export async function GET(request: NextRequest) {
  const authError = requireAdmin(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("from") || "2026-03-02";
  const dateTo = searchParams.get("to") || "2026-03-22";
  const nmId = searchParams.get("nm_id") ? Number(searchParams.get("nm_id")) : undefined;

  try {
    const pnl = getPnl(dateFrom, dateTo, nmId);
    return NextResponse.json(pnl);
  } catch (error) {
    return apiError(error);
  }
}
