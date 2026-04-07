import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-utils";
import { getSyncStatus, syncDailyReport, syncYesterday, startDailyCron } from "@/lib/daily-sync";

/**
 * GET /api/wb/daily-sync — Get sync status + history
 * POST /api/wb/daily-sync — Trigger manual sync
 *   Body: { date?: "YYYY-MM-DD" } — omit date to sync yesterday
 */

// Start cron on first request (lazy init)
let cronStarted = false;

export async function GET() {
  if (!cronStarted) {
    startDailyCron();
    cronStarted = true;
  }

  const status = getSyncStatus();
  return NextResponse.json(status);
}

export async function POST(req: NextRequest) {
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
