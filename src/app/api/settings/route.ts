import { NextRequest, NextResponse } from "next/server";
import { initShipmentTables, getUserSettings, setUserSetting } from "@/lib/shipment-db";
import { verifyToken } from "@/lib/auth";

initShipmentTables();

const DEFAULT_SETTINGS = {
  buyoutMode: "auto",
  buyoutRate: 0.75,
  regionMode: "auto",
  uploadDays: 28,
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

  const stored = getUserSettings(userId);

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
    const body = await req.json() as Record<string, unknown>;
    for (const [key, value] of Object.entries(body)) {
      setUserSetting(userId, key, value);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/settings PUT]", err);
    return NextResponse.json({ error: "Внутренняя ошибка" }, { status: 500 });
  }
}
