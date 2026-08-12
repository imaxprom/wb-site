import { NextRequest, NextResponse } from "next/server";
import {
  getUserOverridesPg,
  initShipmentTablesPg,
  setUserOverridePg,
} from "@/lib/shipment-db";
import { localReadonlyGuard } from "@/lib/local-readonly-guard";
import { activateAuthenticatedRequestContext, getAuthenticatedRequestContext } from "@/lib/api-auth";

export async function GET(req: NextRequest) {
  const context = await getAuthenticatedRequestContext(req);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  activateAuthenticatedRequestContext(req);

  await initShipmentTablesPg();
  const overrides = await getUserOverridesPg(context.userId);
  return NextResponse.json(overrides);
}

export async function PUT(req: NextRequest) {
  const context = await getAuthenticatedRequestContext(req);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  activateAuthenticatedRequestContext(req);
  const readonlyError = localReadonlyGuard("Product override updates");
  if (readonlyError) return readonlyError;

  try {
    const body = await req.json() as {
      articleWB: string;
      barcode?: string;
      customName?: string;
      perBox?: number;
      disabled?: boolean;
    };

    const { articleWB, barcode, customName, perBox, disabled } = body;
    if (!articleWB) {
      return NextResponse.json({ error: "articleWB обязателен" }, { status: 400 });
    }

    // Use empty barcode if not provided (for customName updates)
    const barcodeKey = barcode || "";

    await initShipmentTablesPg();
    await setUserOverridePg(context.userId, articleWB, barcodeKey, {
      customName,
      perBox,
      disabled,
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/overrides PUT]", err);
    return NextResponse.json({ error: "Внутренняя ошибка" }, { status: 500 });
  }
}
