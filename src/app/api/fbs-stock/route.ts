import { NextRequest, NextResponse } from "next/server";
import {
  activateAuthenticatedRequestContext,
  requireFbsAccess,
} from "@/lib/api-auth";
import { apiError } from "@/lib/api-utils";
import { localReadonlyGuard } from "@/lib/local-readonly-guard";
import {
  configureFbsProduct,
  deleteFbsProduct,
  discoverFbsProduct,
  getFbsStockSnapshot,
  pauseFbsProduct,
  syncFbsProduct,
  zeroFbsProductStocks,
} from "@/lib/fbs-stock-manager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function positiveInteger(value: unknown, field: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`Некорректное поле ${field}`);
  return number;
}

export async function GET(request: NextRequest) {
  const authError = await requireFbsAccess(request, "stock");
  if (authError) return authError;
  activateAuthenticatedRequestContext(request);
  try {
    return NextResponse.json({ ok: true, ...(await getFbsStockSnapshot()) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const action = String(body.action || "");

  if (action === "discover") {
    const authError = await requireFbsAccess(request, "stock");
    if (authError) return authError;
    activateAuthenticatedRequestContext(request);
    try {
      const nmId = positiveInteger(body.nmId, "nmId");
      return NextResponse.json({ ok: true, ...(await discoverFbsProduct(nmId)) });
    } catch (error) {
      return apiError(error);
    }
  }

  const authError = await requireFbsAccess(request, "stock", { mutation: true });
  if (authError) return authError;
  activateAuthenticatedRequestContext(request);
  const readonlyError = localReadonlyGuard("FBS stock manager mutation");
  if (readonlyError) return readonlyError;

  try {
    if (action === "configure") {
      const warehouseIds = Array.isArray(body.warehouseIds) ? body.warehouseIds.map(Number) : [];
      const product = await configureFbsProduct({
        nmId: positiveInteger(body.nmId, "nmId"),
        chrtId: positiveInteger(body.chrtId, "chrtId"),
        physicalQuantity: Number(body.physicalQuantity),
        warehouseIds,
      });
      return NextResponse.json({ ok: true, product, snapshot: await getFbsStockSnapshot() });
    }
    if (action === "pause") {
      await pauseFbsProduct(positiveInteger(body.productId, "productId"));
      return NextResponse.json({ ok: true, snapshot: await getFbsStockSnapshot() });
    }
    if (action === "sync") {
      const result = await syncFbsProduct(positiveInteger(body.productId, "productId"));
      return NextResponse.json({ ok: true, result, snapshot: await getFbsStockSnapshot() });
    }
    if (action === "zero") {
      const productId = positiveInteger(body.productId, "productId");
      const confirmationNmId = positiveInteger(body.confirmationNmId, "confirmationNmId");
      const result = await zeroFbsProductStocks(productId, confirmationNmId);
      return NextResponse.json({ ok: true, result, snapshot: await getFbsStockSnapshot() });
    }
    if (action === "delete") {
      const productId = positiveInteger(body.productId, "productId");
      const confirmationNmId = positiveInteger(body.confirmationNmId, "confirmationNmId");
      const result = await deleteFbsProduct(productId, confirmationNmId);
      return NextResponse.json({ ok: true, result, snapshot: await getFbsStockSnapshot() });
    }
    return NextResponse.json({ ok: false, error: "Неизвестное действие" }, { status: 400 });
  } catch (error) {
    return apiError(error);
  }
}
