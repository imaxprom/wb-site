import { NextRequest, NextResponse } from "next/server";
import { activateAuthenticatedRequestContext, requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { activateCronOrganizationContext, enterCronOrganizationContext, isCronRequest } from "@/lib/cron-auth";
import { localReadonlyGuard } from "@/lib/local-readonly-guard";
import { syncSupplyReportDocumentsPg } from "@/lib/supply-reports";

export async function POST(request: NextRequest) {
  const cronRequest = isCronRequest(request);
  if (cronRequest) {
    if (!await enterCronOrganizationContext(request)) {
      return NextResponse.json({ error: "Active organization is required for cron" }, { status: 400 });
    }
    activateCronOrganizationContext(request);
  } else {
    const authError = await requireAdmin(request);
    if (authError) return authError;
    activateAuthenticatedRequestContext(request);
  }

  const readonlyError = localReadonlyGuard("Supply report document sync");
  if (readonlyError) return readonlyError;

  try {
    const body = await request.json().catch(() => ({})) as {
      download?: boolean;
      supplyLimit?: number;
      documentPageLimit?: number;
    };
    const result = await syncSupplyReportDocumentsPg({
      download: cronRequest ? body.download !== false : Boolean(body.download),
      supplyLimit: Math.min(Math.max(Number(body.supplyLimit || 100), 1), 300),
      documentPageLimit: Math.min(Math.max(Number(body.documentPageLimit || 4), 1), 20),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return apiError(error);
  }
}
