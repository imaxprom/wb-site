import { NextRequest, NextResponse } from "next/server";
import { activateAuthenticatedRequestContext, requireOrganizationAdmin } from "@/lib/api-auth";
import { playwrightSelectSupplier } from "@/lib/wb-auth-playwright";
import { localReadonlyGuard } from "@/lib/local-readonly-guard";

/**
 * POST /api/wb/auth/select-supplier — Choose supplier (юрлицо)
 */
export async function POST(req: NextRequest) {
  const authError = await requireOrganizationAdmin(req);
  if (authError) return authError;
  activateAuthenticatedRequestContext(req);
  const readonlyError = localReadonlyGuard("WB cabinet supplier selection");
  if (readonlyError) return readonlyError;

  try {
    const { entityId } = await req.json();
    if (!entityId) {
      return NextResponse.json({ ok: false, step: "error", error: "Укажите юрлицо" }, { status: 400 });
    }
    const result = await playwrightSelectSupplier(String(entityId));
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ ok: false, step: "error", error: String(err) }, { status: 500 });
  }
}
