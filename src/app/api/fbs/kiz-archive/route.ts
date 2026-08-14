import { NextRequest, NextResponse } from "next/server";
import { activateAuthenticatedRequestContext, requireFbsAccess } from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import {
  addFbsKizToArchive,
  createFbsKizPrintBatch,
  FbsKizMappingRequiredError,
  getFbsKizArchiveSnapshot,
  resumeFbsKizPrintBatch,
} from "@/lib/fbs-kiz-archive";
import { localReadonlyGuard } from "@/lib/local-readonly-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authError = await requireFbsAccess(request, "assembly");
  if (authError) return authError;
  activateAuthenticatedRequestContext(request);
  try {
    return NextResponse.json({ ok: true, snapshot: await getFbsKizArchiveSnapshot() });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireFbsAccess(request, "assembly", { mutation: true });
  if (authError) return authError;
  activateAuthenticatedRequestContext(request);
  const readonlyError = localReadonlyGuard("FBS KIZ archive mutation");
  if (readonlyError) return readonlyError;
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  try {
    const action = String(body.action || "scan");
    if (action === "create_print_batch") {
      const result = await createFbsKizPrintBatch({
        nmId: Number(body.nmId || 0),
        barcode: String(body.barcode || ""),
        quantity: Number(body.quantity || 0),
      });
      return NextResponse.json({ ok: true, result, snapshot: await getFbsKizArchiveSnapshot() });
    }
    if (action === "resume_print_batch") {
      const result = await resumeFbsKizPrintBatch(String(body.jobId || ""), Number(body.lastPrintedPosition));
      return NextResponse.json({ ok: true, result, snapshot: await getFbsKizArchiveSnapshot() });
    }
    if (!["scan", "map_and_scan"].includes(action)) {
      return NextResponse.json({ error: "Неизвестное действие" }, { status: 400 });
    }
    const result = await addFbsKizToArchive(
      String(body.value || ""),
      action === "map_and_scan"
        ? { nmId: Number(body.nmId || 0), barcode: String(body.barcode || "") }
        : undefined,
    );
    return NextResponse.json({ ok: true, result, snapshot: await getFbsKizArchiveSnapshot() });
  } catch (error) {
    if (error instanceof FbsKizMappingRequiredError) {
      return NextResponse.json({
        ok: false,
        error: error.message,
        code: error.code,
        gtin: error.gtin,
        candidates: error.candidates,
      }, { status: 409 });
    }
    return apiError(error);
  }
}
