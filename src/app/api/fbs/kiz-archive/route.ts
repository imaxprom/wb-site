import { NextRequest, NextResponse } from "next/server";
import { activateAuthenticatedRequestContext, requireFbsAccess } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { addFbsKizToArchive, getFbsKizArchiveSnapshot } from "@/lib/fbs-kiz-archive";
import { localReadonlyGuard } from "@/lib/local-readonly-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authError = await requireFbsAccess(request, "assembly");
  if (authError) return authError;
  activateAuthenticatedRequestContext(request);
  try {
    return NextResponse.json({ ok: true, snapshot: await getFbsKizArchiveSnapshot() });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireFbsAccess(request, "assembly", { mutation: true });
  if (authError) return authError;
  activateAuthenticatedRequestContext(request);
  const readonlyError = localReadonlyGuard("FBS KIZ archive mutation");
  if (readonlyError) return readonlyError;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  try {
    const value = String(body.value || "");
    const result = await addFbsKizToArchive(value);
    return NextResponse.json({ ok: true, result, snapshot: await getFbsKizArchiveSnapshot() });
  } catch (error) {
    return apiError(error);
  }
}
