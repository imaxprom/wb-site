import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";

export function requireMonitorAdmin(req: NextRequest): NextResponse | null {
  return requireAdmin(req);
}
