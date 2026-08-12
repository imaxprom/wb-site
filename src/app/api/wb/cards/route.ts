import { NextRequest, NextResponse } from "next/server";
import { activateAuthenticatedRequestContext, requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { localReadonlyGuard } from "@/lib/local-readonly-guard";
import { getWbApiKeyFromRequest } from "@/lib/wb-api-key";

interface CardsCursor {
  limit?: number;
  updatedAt?: string;
  nmID?: number;
}

async function fetchCards(apiKey: string, cursor: CardsCursor = {}) {
  const wbBody = {
    settings: {
      sort: { ascending: false },
      cursor: {
        limit: cursor.limit || 100,
        ...(cursor.updatedAt ? { updatedAt: cursor.updatedAt } : {}),
        ...(cursor.nmID ? { nmID: cursor.nmID } : {}),
      },
      filter: { withPhoto: -1 },
    },
  };

  const res = await fetch(
    "https://content-api.wildberries.ru/content/v2/get/cards/list",
    {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(wbBody),
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
}

async function validate(req: NextRequest) {
  const authError = await requireAdmin(req);
  if (authError) return authError;
  activateAuthenticatedRequestContext(req);
  const readonlyError = localReadonlyGuard("WB cards proxy");
  if (readonlyError) return readonlyError;

  const apiKey = getWbApiKeyFromRequest(req.headers);
  if (!apiKey) return NextResponse.json({ error: "API key missing" }, { status: 401 });

  return apiKey;
}

export async function GET(req: NextRequest) {
  const authOrKey = await validate(req);
  if (typeof authOrKey !== "string") return authOrKey;

  try {
    const limit = Number(req.nextUrl.searchParams.get("limit") || "100");
    const nmID = Number(req.nextUrl.searchParams.get("nmID") || "0");
    const updatedAt = req.nextUrl.searchParams.get("updatedAt") || "";
    return await fetchCards(authOrKey, { limit, nmID, updatedAt });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(req: NextRequest) {
  const authOrKey = await validate(req);
  if (typeof authOrKey !== "string") return authOrKey;

  try {
    const body = await req.json();
    const cursor = body.cursor || { limit: 100, updatedAt: "", nmID: 0 };
    return await fetchCards(authOrKey, cursor);
  } catch (err) {
    return apiError(err);
  }
}
