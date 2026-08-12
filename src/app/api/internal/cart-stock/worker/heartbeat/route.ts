import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-utils";
import { updateCartStockWorker, type CartStockHeartbeat } from "@/lib/cart-stock-jobs";
import {
  CartStockWorkerAuthError,
  verifyCartStockWorkerRequest,
} from "@/lib/cart-stock-worker-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  try {
    const workerId = await verifyCartStockWorkerRequest(request, rawBody);
    const payload = rawBody ? JSON.parse(rawBody) as CartStockHeartbeat : {};
    await updateCartStockWorker(workerId, payload);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof CartStockWorkerAuthError) return apiError(error, error.status);
    return apiError(error);
  }
}
