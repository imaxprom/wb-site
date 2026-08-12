import { NextRequest, NextResponse } from "next/server";
import {
  FBS_PORTAL_COOKIE_MAX_AGE,
  FBS_PORTAL_COOKIE_NAME,
  authenticateFbsPortalLogin,
  createFbsPortalToken,
  getFbsPortalOrganizations,
} from "@/lib/fbs-portal-auth";
import { isFbsPortalHostname } from "@/lib/fbs-portal-host";
import { createOrganizationCookie, ORGANIZATION_COOKIE_MAX_AGE, ORGANIZATION_COOKIE_NAME } from "@/lib/organization-cookie";
import { pgGet } from "@/lib/postgres";

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;

function clientIp(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "unknown";
}

function attemptKey(request: NextRequest, email: string): string {
  return `${clientIp(request)}:${email.toLowerCase()}`;
}

export async function POST(request: NextRequest) {
  if (!isFbsPortalHostname(request.headers.get("host"))) return new NextResponse("Not found", { status: 404 });
  const body = await request.json().catch(() => ({})) as { email?: unknown; password?: unknown };
  const email = String(body.email || "").trim().slice(0, 240);
  const password = String(body.password || "");
  if (!email || !password) return NextResponse.json({ error: "Введите логин и пароль" }, { status: 400 });

  const key = attemptKey(request, email);
  const attempt = await pgGet<{ count: number; first_at: number }>(`
    SELECT count,first_at FROM public.fbs_portal_login_attempts WHERE key=?
  `, [key]);
  if (attempt && Date.now() - Number(attempt.first_at) <= LOGIN_WINDOW_MS && Number(attempt.count) >= MAX_FAILED_ATTEMPTS) {
    return NextResponse.json({ error: "Слишком много попыток. Повторите через 15 минут" }, { status: 429 });
  }
  if (attempt && Date.now() - Number(attempt.first_at) > LOGIN_WINDOW_MS) {
    await pgGet(`DELETE FROM public.fbs_portal_login_attempts WHERE key=? RETURNING key`, [key]);
  }

  const user = await authenticateFbsPortalLogin(email, password);
  if (!user) {
    const now = Date.now();
    await pgGet(`
      INSERT INTO public.fbs_portal_login_attempts (key,count,first_at,updated_at)
      VALUES (?,1,?,?)
      ON CONFLICT (key) DO UPDATE SET count=public.fbs_portal_login_attempts.count+1,updated_at=EXCLUDED.updated_at
      RETURNING key
    `, [key, now, now]);
    return NextResponse.json({ error: "Неверный логин или пароль" }, { status: 401 });
  }

  const organizations = await getFbsPortalOrganizations(user.id);
  await pgGet(`DELETE FROM public.fbs_portal_login_attempts WHERE key=? RETURNING key`, [key]);
  const response = NextResponse.json({
    ok: true,
    user: { id: user.id, email: user.email, name: user.name, isAdmin: user.is_admin },
    redirect: organizations[0]?.can_assembly ? "/fbs" : "/fbs-stock",
  });
  response.cookies.set(FBS_PORTAL_COOKIE_NAME, createFbsPortalToken(user.id, user.session_version), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: FBS_PORTAL_COOKIE_MAX_AGE,
  });
  response.cookies.set(ORGANIZATION_COOKIE_NAME, createOrganizationCookie(organizations[0].id), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ORGANIZATION_COOKIE_MAX_AGE,
  });
  return response;
}
