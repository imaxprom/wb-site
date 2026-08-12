import { NextRequest, NextResponse } from "next/server";
import {
  activateAuthenticatedRequestContext,
  requireFbsAccess,
} from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { isCronRequest } from "@/lib/cron-auth";
import { syncFbsOrganization } from "@/lib/fbs-stock-manager";
import { runWithOrganizationContext } from "@/lib/organization-context";
import { pgRows } from "@/lib/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  if (!isCronRequest(request)) {
    const authError = await requireFbsAccess(request, "stock", { mutation: true });
    if (authError) return authError;
    activateAuthenticatedRequestContext(request);
    try {
      return NextResponse.json({ ok: true, results: await syncFbsOrganization() });
    } catch (error) {
      return apiError(error);
    }
  }

  try {
    const organizations = await pgRows<{ id: number; display_name: string }>(`
      SELECT id, display_name
      FROM public.organizations
      WHERE status = 'active'
      ORDER BY id
    `);
    const results = [];
    for (const organization of organizations) {
      const organizationId = Number(organization.id);
      try {
        const organizationResults = await runWithOrganizationContext({
          organizationId,
          userId: null,
          organizationRole: "owner",
          source: "job",
        }, () => syncFbsOrganization());
        results.push({ organizationId, name: organization.display_name, ok: true, products: organizationResults });
      } catch (error) {
        results.push({
          organizationId,
          name: organization.display_name,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return NextResponse.json({ ok: true, results });
  } catch (error) {
    return apiError(error);
  }
}
