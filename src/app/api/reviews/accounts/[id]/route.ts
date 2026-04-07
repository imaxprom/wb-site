import { NextRequest, NextResponse } from "next/server";
import { updateReviewAccount, deleteReviewAccount, getReviewAccountById, initReviewTables } from "@/lib/reviews-db";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    initReviewTables();
    const { id } = await params;
    const body = await req.json();
    updateReviewAccount(Number(id), body);
    const updated = getReviewAccountById(Number(id));
    return NextResponse.json(updated);
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    initReviewTables();
    const { id } = await params;
    deleteReviewAccount(Number(id));
    return NextResponse.json({ ok: true });
  } catch (e: unknown) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
