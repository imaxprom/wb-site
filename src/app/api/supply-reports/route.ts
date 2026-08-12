import { NextRequest, NextResponse } from "next/server";
import { activateAuthenticatedRequestContext, requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { listSupplyReportsPg } from "@/lib/supply-reports";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  activateAuthenticatedRequestContext(request);

  const limit = Math.min(Math.max(Number(request.nextUrl.searchParams.get("limit") || 100), 1), 1000);
  const offset = Math.max(Number(request.nextUrl.searchParams.get("offset") || 0), 0);

  try {
    const result = await listSupplyReportsPg(limit, offset);
    return NextResponse.json({ ok: true, ...result, meta: { limit, offset } });
  } catch (error) {
    return apiError(error);
  }
}
