import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { getFilters, getFiltersPg } from "@/modules/finance/lib/queries";
import { isPostgresEnabled } from "@/lib/postgres";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;

  try {
    const filters = isPostgresEnabled() ? await getFiltersPg() : getFilters();
    return NextResponse.json(filters);
  } catch (error) {
    return apiError(error);
  }
}
