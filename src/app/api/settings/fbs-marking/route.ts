import { NextRequest, NextResponse } from "next/server";
import {
  activateAuthenticatedRequestContext,
  requireFbsSettingsAccess,
} from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import {
  getFbsMarkingPolicy,
  setFbsMarkingPolicy,
} from "@/lib/fbs-marking-policy";
import { localReadonlyGuard } from "@/lib/local-readonly-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authError = await requireFbsSettingsAccess(request);
  if (authError) return authError;
  activateAuthenticatedRequestContext(request);
  try {
    return NextResponse.json(await getFbsMarkingPolicy());
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: NextRequest) {
  const authError = await requireFbsSettingsAccess(request, { mutation: true });
  if (authError) return authError;
  activateAuthenticatedRequestContext(request);
  const readonlyError = localReadonlyGuard("FBS marking settings mutation");
  if (readonlyError) return readonlyError;
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    if (typeof body.forceUnderwearSgtin !== "boolean") {
      return NextResponse.json({ error: "Некорректное значение настройки" }, { status: 400 });
    }
    return NextResponse.json(await setFbsMarkingPolicy({
      forceUnderwearSgtin: body.forceUnderwearSgtin,
    }));
  } catch (error) {
    return apiError(error);
  }
}
