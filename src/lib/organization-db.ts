import { pgGet, pgRows } from "@/lib/postgres";
import type { OrganizationRole } from "@/lib/organization-context";

export interface OrganizationRow {
  id: number;
  slug: string;
  display_name: string;
  legal_name: string;
  inn: string | null;
  supplier_id: string | null;
  store_name: string | null;
  status: string;
  is_default: boolean;
  role: OrganizationRole;
}

export async function getUserOrganizations(userId: number): Promise<OrganizationRow[]> {
  return pgRows<OrganizationRow>(`
    SELECT
      o.id,
      o.slug,
      o.display_name,
      o.legal_name,
      o.inn,
      o.supplier_id,
      o.store_name,
      o.status,
      o.is_default,
      om.role
    FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = ?
      AND om.status = 'active'
      AND o.status IN ('active', 'setup')
    ORDER BY o.is_default DESC, o.display_name, o.id
  `, [userId]);
}

export async function getUserOrganization(
  userId: number,
  organizationId: number,
): Promise<OrganizationRow | undefined> {
  return pgGet<OrganizationRow>(`
    SELECT
      o.id,
      o.slug,
      o.display_name,
      o.legal_name,
      o.inn,
      o.supplier_id,
      o.store_name,
      o.status,
      o.is_default,
      om.role
    FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = ?
      AND om.organization_id = ?
      AND om.status = 'active'
      AND o.status IN ('active', 'setup')
  `, [userId, organizationId]);
}

export async function resolveUserOrganization(
  userId: number,
  requestedOrganizationId: number | null,
): Promise<OrganizationRow | undefined> {
  if (requestedOrganizationId) {
    const requested = await getUserOrganization(userId, requestedOrganizationId);
    if (requested) return requested;
  }
  const organizations = await getUserOrganizations(userId);
  return organizations[0];
}

export function isOrganizationAdmin(role: OrganizationRole): boolean {
  return role === "owner" || role === "admin";
}
