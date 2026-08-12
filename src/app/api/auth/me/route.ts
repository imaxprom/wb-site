import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedRequestContext } from "@/lib/api-auth";
import { getUserOrganization } from "@/lib/organization-db";

export async function GET(req: NextRequest) {
  const context = await getAuthenticatedRequestContext(req);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const organization = await getUserOrganization(context.userId, context.organizationId);

  return NextResponse.json({
    id: context.userId,
    email: context.userEmail,
    name: context.userName,
    role: context.userRole,
    organizationRole: context.organizationRole,
    organization: organization ? {
      id: organization.id,
      slug: organization.slug,
      displayName: organization.display_name,
      legalName: organization.legal_name,
      inn: organization.inn,
      supplierId: organization.supplier_id,
      storeName: organization.store_name,
    } : null,
  });
}
