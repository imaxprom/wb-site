import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { getUploadDatePg } from "@/lib/shipment-db";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const uploadDate = await getUploadDatePg();
    return NextResponse.json({ uploadDate });
  } catch (err) {
    return apiError(err);
  }
}
