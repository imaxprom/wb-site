import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { getReviewAccountsPg, createReviewAccountPg, toPublicReviewAccount } from "@/lib/reviews-db";
import { isPostgresReadonlyConnection } from "@/lib/postgres";

export async function GET(req: NextRequest) {
  const authError = await requireAdmin(req);
  if (authError) return authError;

  try {
    const accounts = (await getReviewAccountsPg()).map(toPublicReviewAccount);
    return NextResponse.json(accounts);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const authError = await requireAdmin(req);
  if (authError) return authError;

  try {
    if (isPostgresReadonlyConnection()) {
      return NextResponse.json(
        { error: "Review account writes are disabled in local PostgreSQL readonly mode" },
        { status: 403 }
      );
    }

    const body = await req.json();
    if (!body.name || !body.api_key) {
      return NextResponse.json({ error: "name and api_key are required" }, { status: 400 });
    }
    const id = await createReviewAccountPg(body);
    return NextResponse.json({ id });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
