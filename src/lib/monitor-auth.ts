import { NextRequest, NextResponse } from "next/server";
import { activateAuthenticatedRequestContext, requireSystemAdmin } from "@/lib/api-auth";

export const activateMonitorOrganizationContext = activateAuthenticatedRequestContext;

export async function requireMonitorAdmin(req: NextRequest): Promise<NextResponse | null> {
  return requireSystemAdmin(req);
}
