import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedRequestContext } from "@/lib/api-auth";
import { getUserOrganization } from "@/lib/organization-db";
import {
  createOrganizationCookie,
  ORGANIZATION_COOKIE_MAX_AGE,
  ORGANIZATION_COOKIE_NAME,
} from "@/lib/organization-cookie";

export async function POST(request: NextRequest) {
  const context = await getAuthenticatedRequestContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as { organizationId?: unknown };
  const organizationId = Number(body.organizationId);
  if (!Number.isSafeInteger(organizationId) || organizationId <= 0) {
    return NextResponse.json({ error: "Invalid organization" }, { status: 400 });
  }

  const organization = await getUserOrganization(context.userId, organizationId);
  if (!organization) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const response = NextResponse.json({ ok: true, organizationId });
  response.cookies.set(ORGANIZATION_COOKIE_NAME, createOrganizationCookie(organizationId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ORGANIZATION_COOKIE_MAX_AGE,
  });
  return response;
}
