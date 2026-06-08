import { NextRequest, NextResponse } from "next/server";
import {
  deleteLoginAttemptPg,
  getLoginAttemptPg,
  getUserByEmailPg,
  getUserByIdPg,
  initShipmentTablesPg,
  recordLoginFailurePg,
  updateUserPasswordHashPg,
} from "@/lib/shipment-db";
import { verifyPassword, createToken, hashPassword, isLegacyPasswordHash } from "@/lib/auth";
import { isPostgresReadonlyConnection } from "@/lib/postgres";

const MAX_AGE = 30 * 24 * 60 * 60; // 30 days
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const DEV_PG_ADMIN_ID = 7218;

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

function isReadonlyPgDevLogin(email: string, password: string): boolean {
  return process.env.NODE_ENV !== "production"
    && isPostgresReadonlyConnection()
    && email === "admin"
    && password === "admin";
}

function buildLoginResponse(user: { id: number; email: string; name: string | null; role: string }): NextResponse {
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
}

async function isBlocked(key: string): Promise<boolean> {
  const state = await getLoginAttemptPg(key);

  if (!state) return false;

  if (Date.now() - state.first_at > LOGIN_WINDOW_MS) {
    await deleteLoginAttemptPg(key);
    return false;
  }

  return state.count >= MAX_FAILED_ATTEMPTS;
}

async function recordFailure(key: string): Promise<void> {
  const now = Date.now();
  await recordLoginFailurePg(key, now, LOGIN_WINDOW_MS);
}

async function clearFailures(key: string): Promise<void> {
  await deleteLoginAttemptPg(key);
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
    if (await isBlocked(key)) {
      return NextResponse.json({ ok: false, error: "Слишком много попыток входа. Попробуйте позже." }, { status: 429 });
    }

    if (isReadonlyPgDevLogin(email, password)) {
      const pgAdmin = await getUserByIdPg(DEV_PG_ADMIN_ID);
      if (pgAdmin?.role === "admin") {
        await clearFailures(key);
        return buildLoginResponse({
          id: pgAdmin.id,
          email: "admin",
          name: pgAdmin.name,
          role: pgAdmin.role,
        });
      }
    }

    await initShipmentTablesPg();
    const user = await getUserByEmailPg(email);
    if (!user) {
      await recordFailure(key);
      return NextResponse.json({ ok: false, error: "Неверный email или пароль" }, { status: 401 });
    }

    if (!verifyPassword(password, user.password_hash)) {
      await recordFailure(key);
      return NextResponse.json({ ok: false, error: "Неверный email или пароль" }, { status: 401 });
    }

    await clearFailures(key);
    if (isLegacyPasswordHash(user.password_hash)) {
      await updateUserPasswordHashPg(user.id, hashPassword(password));
    }

    return buildLoginResponse(user);
  } catch (err) {
    console.error("[auth/login]", err);
    return NextResponse.json({ ok: false, error: "Внутренняя ошибка" }, { status: 500 });
  }
}
