import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { activateMonitorOrganizationContext, requireMonitorAdmin } from "@/lib/monitor-auth";
import { getMonitorStatusPath } from "@/lib/monitor-paths";

export async function GET(req: NextRequest) {
  const authError = await requireMonitorAdmin(req);
  if (authError) return authError;
  activateMonitorOrganizationContext(req);

  try {
    const data = readFileSync(getMonitorStatusPath(), "utf-8");
    return NextResponse.json(JSON.parse(data));
  } catch {
    return NextResponse.json(
      { error: "Failed to load status", timestamp: new Date().toISOString(), machine: "MacBook Air", services: [] },
      { status: 500 }
    );
  }
}
