import { NextRequest, NextResponse } from "next/server";
import { getUserByIdPg, initShipmentTablesPg } from "@/lib/shipment-db";
import { verifyToken } from "@/lib/auth";
import { isPostgresReadonlyConnection } from "@/lib/postgres";

const DEV_READONLY_ADMIN_ID = 7218;

export async function GET(req: NextRequest) {
  const token = req.cookies.get("mphub-token")?.value;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = verifyToken(token);
  if (!payload) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (
    process.env.NODE_ENV !== "production" &&
    isPostgresReadonlyConnection() &&
    payload.userId === DEV_READONLY_ADMIN_ID
  ) {
    return NextResponse.json({ id: DEV_READONLY_ADMIN_ID, email: "admin", name: "Максим", role: "admin" });
  }

  await initShipmentTablesPg();
  const user = await getUserByIdPg(payload.userId);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ id: user.id, email: user.email, name: user.name, role: user.role });
}
