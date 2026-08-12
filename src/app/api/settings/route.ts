import { NextRequest, NextResponse } from "next/server";
import {
  getUserSettingsPg,
  initShipmentTablesPg,
  setUserSettingPg,
} from "@/lib/shipment-db";
import { isPostgresReadonlyConnection } from "@/lib/postgres";
import { activateAuthenticatedRequestContext, getAuthenticatedRequestContext } from "@/lib/api-auth";

const DEFAULT_SETTINGS = {
  buyoutMode: "auto",
  buyoutRate: 0.75,
  regionMode: "auto",
  uploadDays: 28,
  warehousePackingDays: 30,
  warehousePackingMultiplier: 1,
  shipmentExcludedWarehouseNames: [],
  logisticsSelectedWarehouseNames: [],
  logisticsWarehouseLimit: 10,
  boxLengthCm: 60,
  boxWidthCm: 40,
  boxHeightCm: 40,
};

export async function GET(req: NextRequest) {
  const context = await getAuthenticatedRequestContext(req);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  activateAuthenticatedRequestContext(req);

  await initShipmentTablesPg();
  const stored = await getUserSettingsPg(context.userId);

  // Merge defaults with stored settings
  const settings = { ...DEFAULT_SETTINGS, ...stored };

  return NextResponse.json(settings);
}

export async function PUT(req: NextRequest) {
  const context = await getAuthenticatedRequestContext(req);
  if (!context) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  activateAuthenticatedRequestContext(req);

  try {
    if (isPostgresReadonlyConnection()) {
      return NextResponse.json(
        { error: "Settings writes are disabled in local PostgreSQL readonly mode" },
        { status: 403 }
      );
    }

    const body = await req.json() as Record<string, unknown>;
    await initShipmentTablesPg();
    for (const [key, value] of Object.entries(body)) {
      await setUserSettingPg(context.userId, key, value);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/settings PUT]", err);
    return NextResponse.json({ error: "Внутренняя ошибка" }, { status: 500 });
  }
}
