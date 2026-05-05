import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { playwrightSelectSupplier } from "@/lib/wb-auth-playwright";

/**
 * POST /api/wb/auth/select-supplier — Choose supplier (юрлицо)
 */
export async function POST(req: NextRequest) {
  const authError = requireAdmin(req);
  if (authError) return authError;

  try {
    const { supplier } = await req.json();
    if (!supplier) {
      return NextResponse.json({ ok: false, step: "error", error: "Укажите юрлицо" }, { status: 400 });
    }
    const result = await playwrightSelectSupplier(supplier);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ ok: false, step: "error", error: String(err) }, { status: 500 });
  }
}
