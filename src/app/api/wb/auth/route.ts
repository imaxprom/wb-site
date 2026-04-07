import { NextRequest, NextResponse } from "next/server";
import { cdpSendPhone, cdpCheckSession, cdpLogout } from "@/lib/wb-auth-cdp";

/**
 * POST /api/wb/auth — Start auth: send phone number (CDP approach)
 * GET /api/wb/auth — Check if session is active
 * DELETE /api/wb/auth — Logout
 */

export async function POST(req: NextRequest) {
  try {
    const { phone } = await req.json();
    if (!phone) {
      return NextResponse.json({ ok: false, step: "error", error: "Укажите номер телефона" }, { status: 400 });
    }
    const result = await cdpSendPhone(phone);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ ok: false, step: "error", error: String(err) }, { status: 500 });
  }
}

export async function GET() {
  try {
    const result = await cdpCheckSession();
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    cdpLogout();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
