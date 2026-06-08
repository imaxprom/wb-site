import { NextRequest, NextResponse } from "next/server";
import {
  getUserSettingsPg,
  initShipmentTablesPg,
  setUserSettingPg,
} from "@/lib/shipment-db";
import { verifyToken } from "@/lib/auth";
import { isPostgresReadonlyConnection } from "@/lib/postgres";

const DEFAULT_SETTINGS = {
  buyoutMode: "auto",
  buyoutRate: 0.75,
  regionMode: "auto",
  uploadDays: 28,
  warehousePackingDays: 30,
  warehousePackingMultiplier: 1,
  logisticsSelectedWarehouseNames: [],
  logisticsWarehouseLimit: 10,
  boxLengthCm: 60,
  boxWidthCm: 40,
  boxHeightCm: 40,
};

function getUserIdFromRequest(req: NextRequest): number | null {
  const token = req.cookies.get("mphub-token")?.value;
  if (!token) return null;
  const payload = verifyToken(token);
  return payload?.userId ?? null;
}

export async function GET(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await initShipmentTablesPg();
  const stored = await getUserSettingsPg(userId);

  // Merge defaults with stored settings
  const settings = { ...DEFAULT_SETTINGS, ...stored };

  return NextResponse.json(settings);
}

export async function PUT(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
      await setUserSettingPg(userId, key, value);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/settings PUT]", err);
    return NextResponse.json({ error: "Внутренняя ошибка" }, { status: 500 });
  }
}
