import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-utils";
import { finishCartStockJobAcrossOrganizations, type AuthorizedCartStockResult } from "@/lib/cart-stock-jobs";
import {
  CartStockWorkerAuthError,
  verifyCartStockWorkerRequest,
} from "@/lib/cart-stock-worker-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  try {
    const workerId = await verifyCartStockWorkerRequest(request, rawBody);
    const payload = JSON.parse(rawBody) as AuthorizedCartStockResult;
    if (!Number.isInteger(Number(payload.jobId)) || !payload.claimToken) {
      return apiError(new Error("Invalid cart stock result payload"), 400);
    }
    const result = await finishCartStockJobAcrossOrganizations(workerId, payload);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof CartStockWorkerAuthError) return apiError(error, error.status);
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("not found") ? 404
      : message.includes("stale") || message.includes("belongs") ? 409
        : message.includes("Invalid") || message.includes("mismatch") ? 400
          : 500;
    return apiError(error, status);
  }
}
