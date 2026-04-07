import { NextResponse } from "next/server";
import { apiError } from "@/lib/api-utils";
import { getFilters } from "@/lib/db";

export async function GET() {
  try {
    const filters = getFilters();
    return NextResponse.json(filters);
  } catch (error) {
    return apiError(error);
  }
}
