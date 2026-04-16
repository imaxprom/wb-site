import { NextRequest, NextResponse } from "next/server";
import { playwrightSubmitCode } from "@/lib/wb-auth-playwright";

/**
 * POST /api/wb/auth/verify — Submit SMS code (Playwright on VPS)
 */

export async function POST(req: NextRequest) {
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
