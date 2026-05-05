import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { updateReviewAccount, deleteReviewAccount, getReviewAccountById, initReviewTables, toPublicReviewAccount } from "@/lib/reviews-db";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = requireAdmin(req);
  if (authError) return authError;

  try {
    initReviewTables();
    const { id } = await params;
    const body = await req.json();
    for (const key of ["api_key", "wb_authorize_v3", "wb_validation_key"]) {
      if (body[key] === "") {
        delete body[key];
      }
    }
    updateReviewAccount(Number(id), body);
    const updated = getReviewAccountById(Number(id));
    return NextResponse.json(updated ? toPublicReviewAccount(updated) : null);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = requireAdmin(req);
  if (authError) return authError;

  try {
    initReviewTables();
    const { id } = await params;
    deleteReviewAccount(Number(id));
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
