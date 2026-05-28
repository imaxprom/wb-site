import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";

export async function requireMonitorAdmin(req: NextRequest): Promise<NextResponse | null> {
  return requireAdmin(req);
}
