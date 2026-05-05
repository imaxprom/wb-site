import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { getWbApiKey } from "@/lib/wb-api-key";

export async function GET(req: NextRequest) {
  const authError = requireAdmin(req);
  if (authError) return authError;

  const apiKey = req.headers.get("x-wb-api-key") || getWbApiKey();
  if (!apiKey) return NextResponse.json({ error: "API key missing" }, { status: 401 });

  try {
    const res = await fetch(
      "https://marketplace-api.wildberries.ru/api/v3/offices",
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
