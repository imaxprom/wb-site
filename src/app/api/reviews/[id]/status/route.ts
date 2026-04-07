import { NextRequest, NextResponse } from "next/server";
import { updateReviewStatus, initReviewTables } from "@/lib/reviews-db";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    initReviewTables();
    const { id } = await params;
    const body = await req.json();
    if (!body.status) {
      return NextResponse.json({ error: "status is required" }, { status: 400 });
    }
    updateReviewStatus(Number(id), body.status);
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
