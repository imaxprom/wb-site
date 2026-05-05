import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { getFilters } from "@/modules/finance/lib/queries";

export async function GET(request: NextRequest) {
  const authError = requireAdmin(request);
  if (authError) return authError;

  try {
    const filters = getFilters();
    return NextResponse.json(filters);
  } catch (error) {
    return apiError(error);
  }
}
