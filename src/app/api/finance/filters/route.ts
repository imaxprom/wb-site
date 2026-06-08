import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { getFiltersPg } from "@/modules/finance/lib/queries";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const filters = await getFiltersPg();
    return NextResponse.json(filters);
  } catch (error) {
    return apiError(error);
  }
}
