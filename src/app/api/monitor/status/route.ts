import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { requireMonitorAdmin } from "@/lib/monitor-auth";

const STATUS_PATH = join(process.cwd(), "public/data/monitor/status.json");

export async function GET(req: NextRequest) {
  const authError = await requireMonitorAdmin(req);
  if (authError) return authError;

  try {
    const data = readFileSync(STATUS_PATH, "utf-8");
    return NextResponse.json(JSON.parse(data));
  } catch {
    return NextResponse.json(
      { error: "Failed to load status", timestamp: new Date().toISOString(), machine: "MacBook Air", services: [] },
      { status: 500 }
    );
  }
}
