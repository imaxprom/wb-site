import { NextRequest, NextResponse } from "next/server";
import { getFbsPortalSession } from "@/lib/fbs-portal-auth";
import { isFbsPortalHostname } from "@/lib/fbs-portal-host";
import { createOrganizationCookie, ORGANIZATION_COOKIE_MAX_AGE, ORGANIZATION_COOKIE_NAME } from "@/lib/organization-cookie";
import { pgGet } from "@/lib/postgres";

export async function GET(request: NextRequest) {
  if (!isFbsPortalHostname(request.headers.get("host"))) return new NextResponse("Not found", { status: 404 });
  const session = await getFbsPortalSession(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json({
    activeOrganizationId: session.organization.id,
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      isAdmin: session.user.is_admin,
    },
    organizations: session.organizations.map((organization) => ({
      id: organization.id,
      slug: organization.slug,
      displayName: organization.display_name,
      legalName: organization.legal_name,
      inn: organization.inn,
      canAssembly: organization.can_assembly,
      canStock: organization.can_stock,
    })),
  });
}

export async function POST(request: NextRequest) {
  if (!isFbsPortalHostname(request.headers.get("host"))) return new NextResponse("Not found", { status: 404 });
  const session = await getFbsPortalSession(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await request.json().catch(() => ({})) as { organizationId?: unknown };
  const organizationId = Number(body.organizationId);
  const organization = session.organizations.find((row) => row.id === organizationId);
  if (!organization) return NextResponse.json({ error: "Нет доступа к этому юрлицу" }, { status: 403 });
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

export async function PUT(request: NextRequest) {
  if (!isFbsPortalHostname(request.headers.get("host"))) return new NextResponse("Not found", { status: 404 });
  const session = await getFbsPortalSession(request);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!session.user.is_admin) return NextResponse.json({ error: "Только администратор может менять название юрлица" }, { status: 403 });

  const body = await request.json().catch(() => ({})) as { organizationId?: unknown; displayName?: unknown };
  const organizationId = Number(body.organizationId);
  const organization = session.organizations.find((row) => row.id === organizationId);
  if (!organization) return NextResponse.json({ error: "Нет доступа к этому юрлицу" }, { status: 403 });

  const displayName = String(body.displayName || "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (!displayName) return NextResponse.json({ error: "Введите название юрлица" }, { status: 400 });

  await pgGet(`
    UPDATE public.organizations
    SET display_name=?,updated_at=CURRENT_TIMESTAMP
    WHERE id=?
    RETURNING id
  `, [displayName, organizationId]);
  await pgGet(`
    INSERT INTO public.fbs_portal_audit (actor_user_id,action,details_json)
    VALUES (?,'organization_renamed',?::jsonb)
    RETURNING id
  `, [session.user.id, JSON.stringify({ organizationId, previousDisplayName: organization.display_name, displayName })]);

  return NextResponse.json({ ok: true, organizationId, displayName });
}
