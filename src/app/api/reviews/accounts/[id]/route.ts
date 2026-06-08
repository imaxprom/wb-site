import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import {
  updateReviewAccountPg,
  deleteReviewAccountPg,
  getReviewAccountByIdPg,
  toPublicReviewAccount,
} from "@/lib/reviews-db";
import { isPostgresReadonlyConnection } from "@/lib/postgres";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireAdmin(req);
  if (authError) return authError;

  try {
    if (isPostgresReadonlyConnection()) {
      return NextResponse.json(
        { error: "Review account writes are disabled in local PostgreSQL readonly mode" },
        { status: 403 }
      );
    }

    const { id } = await params;
    const body = await req.json();
    for (const key of ["api_key", "wb_authorize_v3", "wb_validation_key"]) {
      if (body[key] === "") {
        delete body[key];
      }
    }
    await updateReviewAccountPg(Number(id), body);
    const updated = await getReviewAccountByIdPg(Number(id));
    return NextResponse.json(updated ? toPublicReviewAccount(updated) : null);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireAdmin(req);
  if (authError) return authError;

  try {
    if (isPostgresReadonlyConnection()) {
      return NextResponse.json(
        { error: "Review account writes are disabled in local PostgreSQL readonly mode" },
        { status: 403 }
      );
    }

    const { id } = await params;
    await deleteReviewAccountPg(Number(id));
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
