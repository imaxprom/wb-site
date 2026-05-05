import { NextRequest, NextResponse } from "next/server";
import { initShipmentTables, getUserByEmail, updateUserPasswordHash } from "@/lib/shipment-db";
import { verifyPassword, createToken, hashPassword, isLegacyPasswordHash } from "@/lib/auth";

initShipmentTables();

const MAX_AGE = 30 * 24 * 60 * 60; // 30 days
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;

type AttemptState = { count: number; firstAt: number };
const attempts = new Map<string, AttemptState>();

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

function attemptKey(req: NextRequest, email: string): string {
  return `${getClientIp(req)}:${email.toLowerCase()}`;
}

function isBlocked(key: string): boolean {
  const state = attempts.get(key);
  if (!state) return false;
  if (Date.now() - state.firstAt > LOGIN_WINDOW_MS) {
    attempts.delete(key);
    return false;
  }
  return state.count >= MAX_FAILED_ATTEMPTS;
}

function recordFailure(key: string): void {
  const now = Date.now();
  const state = attempts.get(key);
  if (!state || now - state.firstAt > LOGIN_WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now });
    return;
  }
  state.count += 1;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { email?: string; password?: string };
    const email = body.email?.trim();
    const password = body.password;

    if (!email || !password) {
      return NextResponse.json({ ok: false, error: "Email и пароль обязательны" }, { status: 400 });
    }

    const key = attemptKey(req, email);
    if (isBlocked(key)) {
      return NextResponse.json({ ok: false, error: "Слишком много попыток входа. Попробуйте позже." }, { status: 429 });
    }

    const user = getUserByEmail(email);
    if (!user) {
      recordFailure(key);
      return NextResponse.json({ ok: false, error: "Неверный email или пароль" }, { status: 401 });
    }

    if (!verifyPassword(password, user.password_hash)) {
      recordFailure(key);
      return NextResponse.json({ ok: false, error: "Неверный email или пароль" }, { status: 401 });
    }

    attempts.delete(key);
    if (isLegacyPasswordHash(user.password_hash)) {
      updateUserPasswordHash(user.id, hashPassword(password));
    }

    const token = createToken(user.id);

    const res = NextResponse.json({
      ok: true,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });

    res.cookies.set("mphub-token", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: MAX_AGE,
    });

    return res;
  } catch (err) {
    console.error("[auth/login]", err);
    return NextResponse.json({ ok: false, error: "Внутренняя ошибка" }, { status: 500 });
  }
}
