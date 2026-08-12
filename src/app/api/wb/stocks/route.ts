import { NextRequest, NextResponse } from "next/server";
import { activateAuthenticatedRequestContext, requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { localReadonlyGuard } from "@/lib/local-readonly-guard";
import { getWbApiKeyFromRequest } from "@/lib/wb-api-key";

export async function GET(req: NextRequest) {
  const authError = await requireAdmin(req);
  if (authError) return authError;
  activateAuthenticatedRequestContext(req);
  const readonlyError = localReadonlyGuard("WB stocks proxy");
  if (readonlyError) return readonlyError;

  const apiKey = getWbApiKeyFromRequest(req.headers);
  if (!apiKey) return NextResponse.json({ error: "API key missing" }, { status: 401 });

  try {
    // Statistics API requires dateFrom; use a date far enough back to get everything
    const dateFrom = "2019-01-01T00:00:00";

    const res = await fetch(
      `https://statistics-api.wildberries.ru/api/v1/supplier/stocks?dateFrom=${encodeURIComponent(dateFrom)}`,
      {
        headers: { Authorization: apiKey },
      }
    );

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `WB API ${res.status}: ${text}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err) {
    return apiError(err);
  }
}
