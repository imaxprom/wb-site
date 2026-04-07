import { NextRequest, NextResponse } from "next/server";
import { getDaily } from "@/lib/db";
import { apiError } from "@/lib/api-utils";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const dateFrom = searchParams.get("from") || "2026-03-02";
  const dateTo = searchParams.get("to") || "2026-03-22";
  const nmId = searchParams.get("nm_id") ? Number(searchParams.get("nm_id")) : undefined;

  try {
    const daily = getDaily(dateFrom, dateTo, nmId);
    return NextResponse.json(daily);
  } catch (error) {
    return apiError(error);
  }
}
