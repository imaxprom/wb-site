import { NextRequest, NextResponse } from "next/server";
import { activateAuthenticatedRequestContext, requireFbsAccess } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { isCronRequest } from "@/lib/cron-auth";
import {
  getFbsArchiveOverview,
  getFbsArchiveSupplyDetails,
  syncFbsArchive,
} from "@/lib/fbs-archive";
import { localReadonlyGuard } from "@/lib/local-readonly-guard";
import { runWithOrganizationContext } from "@/lib/organization-context";
import { pgRows } from "@/lib/postgres";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const authError = await requireFbsAccess(request, "assembly");
  if (authError) return authError;
  activateAuthenticatedRequestContext(request);
  try {
    const supplyId = request.nextUrl.searchParams.get("supplyId")?.trim() || "";
    if (supplyId) {
      return NextResponse.json({ ok: true, ...(await getFbsArchiveSupplyDetails(supplyId)) });
    }
    const days = Number(request.nextUrl.searchParams.get("days") || 90);
    const query = request.nextUrl.searchParams.get("query") || "";
    return NextResponse.json({ ok: true, overview: await getFbsArchiveOverview({ days, query }) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as { full?: unknown };
  if (!isCronRequest(request)) {
    const authError = await requireFbsAccess(request, "assembly", { mutation: true });
    if (authError) return authError;
    activateAuthenticatedRequestContext(request);
    const readonlyError = localReadonlyGuard("FBS archive sync");
    if (readonlyError) return readonlyError;
    try {
      return NextResponse.json({ ok: true, result: await syncFbsArchive({ full: body.full === true }) });
    } catch (error) {
      return apiError(error);
    }
  }

  try {
    const organizations = await pgRows<{ id: number; display_name: string }>(`
      SELECT id,display_name FROM public.organizations WHERE status='active' ORDER BY id
    `);
    const results = [];
    for (const organization of organizations) {
      try {
        const result = await runWithOrganizationContext({
          organizationId: Number(organization.id),
          userId: null,
          organizationRole: "owner",
          source: "job",
        }, () => syncFbsArchive({ full: body.full === true }));
        results.push({ organizationId: Number(organization.id), name: organization.display_name, ok: true, result });
      } catch (error) {
        results.push({
          organizationId: Number(organization.id),
          name: organization.display_name,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return NextResponse.json({ ok: results.every((row) => row.ok), results });
  } catch (error) {
    return apiError(error);
  }
}
