import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/api-auth";
import { updateReviewStatusPg } from "@/lib/reviews-db";
import { isPostgresReadonlyConnection } from "@/lib/postgres";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const authError = await requireAdmin(req);
  if (authError) return authError;

  try {
    if (isPostgresReadonlyConnection()) {
      return NextResponse.json(
        { error: "Review status writes are disabled in local PostgreSQL readonly mode" },
        { status: 403 }
      );
    }

    const { id } = await params;
    const body = await req.json();
    if (!body.status) {
      return NextResponse.json({ error: "status is required" }, { status: 400 });
    }
    await updateReviewStatusPg(Number(id), body.status);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
