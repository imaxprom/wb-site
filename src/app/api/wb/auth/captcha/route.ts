import { NextRequest, NextResponse } from "next/server";
import { cdpSubmitCaptcha } from "@/lib/wb-auth-cdp";

/**
 * POST /api/wb/auth/captcha — Submit captcha solution (CDP approach)
 */

export async function POST(req: NextRequest) {
  try {
    const { captcha } = await req.json();
    if (!captcha) {
      return NextResponse.json({ ok: false, step: "error", error: "Введите текст капчи" }, { status: 400 });
    }
    const result = await cdpSubmitCaptcha(captcha);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ ok: false, step: "error", error: String(err) }, { status: 500 });
  }
}
