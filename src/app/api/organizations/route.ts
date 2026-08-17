import { NextRequest, NextResponse } from "next/server";
import { activateAuthenticatedRequestContext, getAuthenticatedRequestContext, requireSystemAdmin } from "@/lib/api-auth";
import { getUserOrganizations } from "@/lib/organization-db";
import { withPgTransaction } from "@/lib/postgres";
import { getFbsKizArchiveEnabled } from "@/lib/fbs-kiz-archive-access";
import crypto from "node:crypto";

export async function GET(request: NextRequest) {
  const context = await getAuthenticatedRequestContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  activateAuthenticatedRequestContext(request);

  const [organizations, kizArchiveEnabled] = await Promise.all([
    getUserOrganizations(context.userId),
    getFbsKizArchiveEnabled(),
  ]);
  return NextResponse.json({
    activeOrganizationId: context.organizationId,
    isSystemAdmin: context.userRole === "admin",
    kizArchiveEnabled,
    organizations: organizations.map((organization) => ({
      id: organization.id,
      slug: organization.slug,
      displayName: organization.display_name,
      legalName: organization.legal_name,
      inn: organization.inn,
      supplierId: organization.supplier_id,
      storeName: organization.store_name,
      role: organization.role,
      isDefault: organization.is_default,
      status: organization.status,
    })),
  });
}

export async function POST(request: NextRequest) {
  const authError = await requireSystemAdmin(request);
  if (authError) return authError;
  const context = await getAuthenticatedRequestContext(request);
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({})) as {
    displayName?: unknown;
    legalName?: unknown;
    inn?: unknown;
  };
  const displayName = String(body.displayName || "").trim().slice(0, 120);
  const legalName = String(body.legalName || displayName).trim().slice(0, 200);
  const inn = String(body.inn || "").replace(/\D/g, "").slice(0, 12) || null;
  if (!displayName) {
    return NextResponse.json({ error: "Укажите название профиля" }, { status: 400 });
  }

  const organization = await withPgTransaction(async (client) => {
    const idResult = await client.query<{ id: number }>(
      "SELECT nextval('public.organizations_id_seq')::bigint AS id",
    );
    const organizationId = Number(idResult.rows[0].id);
    const slug = `organization-${organizationId}-${crypto.randomBytes(3).toString("hex")}`;
    const schema = `organization_${organizationId}`;
    await client.query(`
      INSERT INTO public.organizations (
        id, slug, display_name, legal_name, inn, status, data_schema, is_default
      ) VALUES ($1, $2, $3, $4, $5, 'setup', $6, FALSE)
    `, [organizationId, slug, displayName, legalName || displayName, inn, schema]);
    await client.query(`
      INSERT INTO public.organization_members (organization_id, user_id, role, status)
      VALUES ($1, $2, 'owner', 'active')
    `, [organizationId, context.userId]);
    await client.query("SELECT public.mphub_provision_organization_schema($1)", [organizationId]);
    return { id: organizationId, slug, displayName, legalName: legalName || displayName, inn, status: "setup" };
  });

  return NextResponse.json({ ok: true, organization }, { status: 201 });
}
