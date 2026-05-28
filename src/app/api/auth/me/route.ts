import { NextRequest, NextResponse } from "next/server";
import { getUserById, getUserByIdPg, initShipmentTables, initShipmentTablesPg } from "@/lib/shipment-db";
import { verifyToken } from "@/lib/auth";
import { isPostgresEnabled } from "@/lib/postgres";

initShipmentTables();

export async function GET(req: NextRequest) {
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
    : getUserById(payload.userId);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ id: user.id, email: user.email, name: user.name, role: user.role });
}
