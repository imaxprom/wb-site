import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-utils";
import {
  activateAuthenticatedRequestContext,
  requireFbsSettingsAccess,
} from "@/lib/api-auth";
import { localReadonlyGuard } from "@/lib/local-readonly-guard";
import {
  deleteWbFbsApiKey,
  getWbFbsApiKey,
  setWbFbsApiKey,
} from "@/lib/wb-fbs-api-key";
import { validateFbsApiKey } from "@/lib/fbs-wb-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function maskedToken(value: string): string {
  return value.length > 12 ? `••••••••••••${value.slice(-8)}` : "••••••••";
}

export async function GET(request: NextRequest) {
  const authError = await requireFbsSettingsAccess(request);
  if (authError) return authError;
  activateAuthenticatedRequestContext(request);
  const token = getWbFbsApiKey();
  return NextResponse.json({ hasKey: Boolean(token), masked: token ? maskedToken(token) : "" });
}

export async function PUT(request: NextRequest) {
  const authError = await requireFbsSettingsAccess(request, { mutation: true });
  if (authError) return authError;
  activateAuthenticatedRequestContext(request);
  const readonlyError = localReadonlyGuard("FBS API token update");
  if (readonlyError) return readonlyError;
  try {
    const body = await request.json().catch(() => ({})) as { key?: unknown };
    const key = String(body.key || "").trim();
    if (key.length < 20) {
      return NextResponse.json({ error: "FBS API-токен выглядит некорректно" }, { status: 400 });
    }
    const validation = await validateFbsApiKey(key);
    setWbFbsApiKey(key);
    return NextResponse.json({ ok: true, masked: maskedToken(key), ...validation });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: NextRequest) {
  const authError = await requireFbsSettingsAccess(request, { mutation: true });
  if (authError) return authError;
  activateAuthenticatedRequestContext(request);
  const readonlyError = localReadonlyGuard("FBS API token deletion");
  if (readonlyError) return readonlyError;
  try {
    deleteWbFbsApiKey();
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
