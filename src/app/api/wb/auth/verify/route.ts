import { NextRequest, NextResponse } from "next/server";
import { activateAuthenticatedRequestContext, requireOrganizationAdmin } from "@/lib/api-auth";
import { playwrightSubmitCode } from "@/lib/wb-auth-playwright";
import { localReadonlyGuard } from "@/lib/local-readonly-guard";

/**
 * POST /api/wb/auth/verify — Submit SMS code (Playwright on VPS)
 */

export async function POST(req: NextRequest) {
  const authError = await requireOrganizationAdmin(req);
  if (authError) return authError;
  activateAuthenticatedRequestContext(req);
  const readonlyError = localReadonlyGuard("WB cabinet SMS verification");
  if (readonlyError) return readonlyError;

  try {
    const { code } = await req.json();
    if (!code) {
      return NextResponse.json({ ok: false, step: "error", error: "Укажите код" }, { status: 400 });
    }
    const result = await playwrightSubmitCode(code);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ ok: false, step: "error", error: String(err) }, { status: 500 });
  }
}
