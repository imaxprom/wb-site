import { NextRequest, NextResponse } from "next/server";
import { playwrightSelectSupplier } from "@/lib/wb-auth-playwright";

/**
 * POST /api/wb/auth/select-supplier — Choose supplier (юрлицо)
 */
export async function POST(req: NextRequest) {
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
