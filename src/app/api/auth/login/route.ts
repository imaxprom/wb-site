import { NextRequest, NextResponse } from "next/server";
import { initShipmentTables, getDb, getUserByEmail, updateUserPasswordHash } from "@/lib/shipment-db";
import { verifyPassword, createToken, hashPassword, isLegacyPasswordHash } from "@/lib/auth";

initShipmentTables();

const MAX_AGE = 30 * 24 * 60 * 60; // 30 days
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;

type AttemptState = { count: number; first_at: number };

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
  const state = getDb()
    .prepare("SELECT count, first_at FROM auth_login_attempts WHERE key = ?")
    .get(key) as AttemptState | undefined;

  if (!state) return false;

  if (Date.now() - state.first_at > LOGIN_WINDOW_MS) {
    getDb().prepare("DELETE FROM auth_login_attempts WHERE key = ?").run(key);
    return false;
  }

  return state.count >= MAX_FAILED_ATTEMPTS;
}

function recordFailure(key: string): void {
  const now = Date.now();
  getDb()
    .prepare("DELETE FROM auth_login_attempts WHERE updated_at < ?")
    .run(now - LOGIN_WINDOW_MS * 4);

  const state = getDb()
    .prepare("SELECT count, first_at FROM auth_login_attempts WHERE key = ?")
    .get(key) as AttemptState | undefined;

  if (!state || now - state.first_at > LOGIN_WINDOW_MS) {
    getDb()
      .prepare(`
        INSERT INTO auth_login_attempts (key, count, first_at, updated_at)
        VALUES (?, 1, ?, ?)
        ON CONFLICT(key) DO UPDATE SET count = 1, first_at = excluded.first_at, updated_at = excluded.updated_at
      `)
      .run(key, now, now);
    return;
  }

  getDb()
    .prepare("UPDATE auth_login_attempts SET count = count + 1, updated_at = ? WHERE key = ?")
    .run(now, key);
}

function clearFailures(key: string): void {
  getDb().prepare("DELETE FROM auth_login_attempts WHERE key = ?").run(key);
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

    clearFailures(key);
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
