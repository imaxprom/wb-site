import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { getUserById, getUserByIdPg, initShipmentTables, initShipmentTablesPg } from "@/lib/shipment-db";
import { isPostgresEnabled } from "@/lib/postgres";

export async function requireAdmin(req: NextRequest): Promise<NextResponse | null> {
  const token = req.cookies.get("mphub-token")?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = isPostgresEnabled()
    ? (await initShipmentTablesPg(), await getUserByIdPg(payload.userId))
    : (initShipmentTables(), getUserById(payload.userId));
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return null;
}
