import { NextRequest, NextResponse } from "next/server";
import { activateMonitorOrganizationContext, requireMonitorAdmin } from "@/lib/monitor-auth";

export async function POST(req: NextRequest) {
  const authError = await requireMonitorAdmin(req);
  if (authError) return authError;
  activateMonitorOrganizationContext(req);

  return NextResponse.json({
    ok: false,
    error: "Manual monitor runs are disabled in production. Use cron/PM2 schedules instead.",
  }, { status: 410 });
}
