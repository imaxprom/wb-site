import { NextRequest, NextResponse } from "next/server";
import {
  getUserOverrides,
  getUserOverridesPg,
  initShipmentTables,
  initShipmentTablesPg,
  setUserOverride,
  setUserOverridePg,
} from "@/lib/shipment-db";
import { verifyToken } from "@/lib/auth";
import { isPostgresEnabled } from "@/lib/postgres";
import { localReadonlyGuard } from "@/lib/local-readonly-guard";

initShipmentTables();

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

  const overrides = isPostgresEnabled()
    ? (await initShipmentTablesPg(), await getUserOverridesPg(userId))
    : getUserOverrides(userId);
  return NextResponse.json(overrides);
}

export async function PUT(req: NextRequest) {
  const userId = getUserIdFromRequest(req);
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
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

    if (isPostgresEnabled()) {
      await initShipmentTablesPg();
      await setUserOverridePg(userId, articleWB, barcodeKey, {
        customName,
        perBox,
        disabled,
      });
    } else {
      setUserOverride(userId, articleWB, barcodeKey, {
        customName,
        perBox,
        disabled,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/overrides PUT]", err);
    return NextResponse.json({ error: "Внутренняя ошибка" }, { status: 500 });
  }
}
