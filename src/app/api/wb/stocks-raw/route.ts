import { NextRequest, NextResponse } from "next/server";
import { activateAuthenticatedRequestContext, requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { localReadonlyGuard } from "@/lib/local-readonly-guard";
import { getWbApiKeyFromRequest } from "@/lib/wb-api-key";

export async function GET(req: NextRequest) {
  const authError = await requireAdmin(req);
  if (authError) return authError;
  activateAuthenticatedRequestContext(req);
  const readonlyError = localReadonlyGuard("WB raw stocks proxy");
  if (readonlyError) return readonlyError;

  const apiKey = getWbApiKeyFromRequest(req.headers);
  if (!apiKey) return NextResponse.json({ error: "API key missing" }, { status: 401 });

  try {
    const dateFrom = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const res = await fetch(
      `https://statistics-api.wildberries.ru/api/v1/supplier/stocks?dateFrom=${encodeURIComponent(dateFrom)}`,
      { headers: { Authorization: apiKey } }
    );

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: text }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json({
      total: data.length,
      sample: data.slice(0, 5),
    });
  } catch (err) {
    return apiError(err);
  }
}
