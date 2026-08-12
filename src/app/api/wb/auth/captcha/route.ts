import { NextRequest, NextResponse } from "next/server";
import { activateAuthenticatedRequestContext, requireOrganizationAdmin } from "@/lib/api-auth";

/**
 * POST /api/wb/auth/captcha — Submit captcha solution (CDP approach)
 */

export async function POST(req: NextRequest) {
  const authError = await requireOrganizationAdmin(req);
  if (authError) return authError;
  activateAuthenticatedRequestContext(req);
  return NextResponse.json(
    {
      ok: false,
      step: "error",
      error: "Устаревший общий CAPTCHA-сеанс отключён; повторите вход через текущую форму авторизации",
    },
    { status: 410 },
  );
}
