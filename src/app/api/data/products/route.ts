import { NextRequest, NextResponse } from "next/server";
import { activateAuthenticatedRequestContext, requireAdmin } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { getProductsPg } from "@/lib/shipment-db";

export async function GET(request: NextRequest) {
  const authError = await requireAdmin(request);
  if (authError) return authError;
  activateAuthenticatedRequestContext(request);

  try {
    const products = await getProductsPg();
    return NextResponse.json(products);
  } catch (err) {
    return apiError(err);
  }
}
