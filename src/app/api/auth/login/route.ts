import { NextRequest, NextResponse } from "next/server";
import { initShipmentTables, getUserByEmail } from "@/lib/shipment-db";
import { verifyPassword, createToken } from "@/lib/auth";

initShipmentTables();

const MAX_AGE = 30 * 24 * 60 * 60; // 30 days

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { email?: string; password?: string };
    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json({ ok: false, error: "Email и пароль обязательны" }, { status: 400 });
    }

    const user = getUserByEmail(email);
    if (!user) {
      return NextResponse.json({ ok: false, error: "Неверный email или пароль" }, { status: 401 });
    }

    if (!verifyPassword(password, user.password_hash)) {
      return NextResponse.json({ ok: false, error: "Неверный email или пароль" }, { status: 401 });
    }

    const token = createToken(user.id);

    const res = NextResponse.json({
      ok: true,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });

    res.cookies.set("mphub-token", token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: MAX_AGE,
    });

    return res;
  } catch (err) {
    console.error("[auth/login]", err);
    return NextResponse.json({ ok: false, error: "Внутренняя ошибка" }, { status: 500 });
  }
}
