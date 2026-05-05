import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";

export async function POST(req: NextRequest) {
  const authError = requireAdmin(req);
  if (authError) return authError;

  const apiKey = req.headers.get("x-wb-api-key");
  if (!apiKey) return NextResponse.json({ error: "API key missing" }, { status: 401 });

  try {
    const body = await req.json();
    const cursor = body.cursor || { limit: 100, updatedAt: "", nmID: 0 };

    const wbBody = {
      settings: {
        sort: { ascending: false },
        cursor: {
          limit: cursor.limit,
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
  } catch (err) {
    return apiError(err);
  }
}
