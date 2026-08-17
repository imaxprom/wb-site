import { NextRequest, NextResponse } from "next/server";
import { activateAuthenticatedRequestContext, requireOrganizationAdmin } from "@/lib/api-auth";
import { playwrightCheckProgress } from "@/lib/wb-auth-playwright";
import { localReadonlyGuard } from "@/lib/local-readonly-guard";

/**
 * GET /api/wb/auth/progress — short polling request for the background WB login.
 */
export async function GET(req: NextRequest) {
  const authError = await requireOrganizationAdmin(req);
  if (authError) return authError;
  activateAuthenticatedRequestContext(req);
  const readonlyError = localReadonlyGuard("WB cabinet auth progress");
  if (readonlyError) return readonlyError;

  try {
    return NextResponse.json(await playwrightCheckProgress());
  } catch (err) {
    return NextResponse.json(
      { ok: false, step: "error", error: String(err) },
      { status: 500 },
    );
  }
}
