import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { isCronRequest } from "@/lib/cron-auth";
import { getSyncStatus, syncDailyReport, syncYesterday, startDailyCron } from "@/lib/daily-sync";
import { localReadonlyGuard } from "@/lib/local-readonly-guard";

/**
 * GET /api/wb/daily-sync — Get sync status + history
 * POST /api/wb/daily-sync — Trigger manual sync
 *   Body: { date?: "YYYY-MM-DD" } — omit date to sync yesterday
 */

// Start cron on first request (lazy init)
let cronStarted = false;

export async function GET(req: NextRequest) {
  const authError = await requireAdmin(req);
  if (authError) return authError;

  const readonlyError = localReadonlyGuard("Daily sync cron");
  if (readonlyError) {
    const status = getSyncStatus();
    return NextResponse.json({ ...status, disabled: true, reason: "local_postgres_readonly" });
  }

  if (!cronStarted) {
    startDailyCron();
    cronStarted = true;
  }

  const status = getSyncStatus();
  return NextResponse.json(status);
}

export async function POST(req: NextRequest) {
  if (!isCronRequest(req)) {
    const authError = await requireAdmin(req);
    if (authError) return authError;
  }
  const readonlyError = localReadonlyGuard("Manual daily sync");
  if (readonlyError) return readonlyError;

  if (!cronStarted) {
    startDailyCron();
    cronStarted = true;
  }

  try {
    const body = await req.json().catch(() => ({}));
    const date = body.date as string | undefined;

    const result = date ? await syncDailyReport(date) : await syncYesterday();

    return NextResponse.json(result);
  } catch (err) {
    return apiError(err);
  }
}
