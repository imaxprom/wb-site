import { NextRequest, NextResponse } from "next/server";
import { initShipmentTables, getUserById } from "@/lib/shipment-db";
import { verifyToken } from "@/lib/auth";

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

  const user = getUserById(payload.userId);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ id: user.id, email: user.email, name: user.name, role: user.role });
}
