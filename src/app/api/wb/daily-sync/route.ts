import { NextRequest, NextResponse } from "next/server";
import { activateAuthenticatedRequestContext, requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { activateCronOrganizationContext, enterCronOrganizationContext, isCronRequest } from "@/lib/cron-auth";
import { getSyncStatus, syncDailyReport, syncYesterday } from "@/lib/daily-sync";
import { localReadonlyGuard } from "@/lib/local-readonly-guard";

/**
 * GET /api/wb/daily-sync — Get sync status + history
 * POST /api/wb/daily-sync — Trigger manual sync
 *   Body: { date?: "YYYY-MM-DD" } — omit date to sync yesterday
 */

export async function GET(req: NextRequest) {
  const authError = await requireAdmin(req);
  if (authError) return authError;
  activateAuthenticatedRequestContext(req);

  const readonlyError = localReadonlyGuard("Daily sync cron");
  if (readonlyError) {
    const status = getSyncStatus();
    return NextResponse.json({ ...status, disabled: true, reason: "local_postgres_readonly" });
  }

  const status = getSyncStatus();
  return NextResponse.json(status);
}

export async function POST(req: NextRequest) {
  const cronRequest = isCronRequest(req);
  if (cronRequest) {
    if (!await enterCronOrganizationContext(req)) {
      return NextResponse.json({ error: "Active organization is required for cron" }, { status: 400 });
    }
    activateCronOrganizationContext(req);
  } else {
    const authError = await requireAdmin(req);
    if (authError) return authError;
    activateAuthenticatedRequestContext(req);
  }
  const readonlyError = localReadonlyGuard("Manual daily sync");
  if (readonlyError) return readonlyError;

  try {
    const body = await req.json().catch(() => ({}));
    const date = body.date as string | undefined;

    const result = date ? await syncDailyReport(date) : await syncYesterday();

    return NextResponse.json(result);
  } catch (err) {
    return apiError(err);
  }
}
