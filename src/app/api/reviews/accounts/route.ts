import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { getReviewAccounts, createReviewAccount, toPublicReviewAccount } from "@/lib/reviews-db";

export async function GET(req: NextRequest) {
  const authError = requireAdmin(req);
  if (authError) return authError;

  try {
    const accounts = getReviewAccounts().map(toPublicReviewAccount);
    return NextResponse.json(accounts);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const authError = requireAdmin(req);
  if (authError) return authError;

  try {
    const body = await req.json();
    if (!body.name || !body.api_key) {
      return NextResponse.json({ error: "name and api_key are required" }, { status: 400 });
    }
    const id = createReviewAccount(body);
    return NextResponse.json({ id });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
