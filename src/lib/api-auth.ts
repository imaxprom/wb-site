import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/auth";
import { getUserByIdPg, initShipmentTablesPg } from "@/lib/shipment-db";
import { isPostgresReadonlyConnection } from "@/lib/postgres";

type CachedAdminUser = {
  role: string;
  expiresAt: number;
};

const ADMIN_USER_CACHE_TTL_MS = 30_000;
const DEV_READONLY_ADMIN_ID = 7218;
const adminUserCache = new Map<number, CachedAdminUser>();
const adminUserInflight = new Map<number, Promise<CachedAdminUser | null>>();

async function loadAdminUser(userId: number): Promise<CachedAdminUser | null> {
  const cached = adminUserCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached;

  const inflight = adminUserInflight.get(userId);
  if (inflight) return inflight;

  const promise = (async () => {
    await initShipmentTablesPg();
    const user = await getUserByIdPg(userId);

    if (!user) return null;
    const value = { role: user.role, expiresAt: Date.now() + ADMIN_USER_CACHE_TTL_MS };
    adminUserCache.set(userId, value);
    return value;
  })();

  adminUserInflight.set(userId, promise);
  try {
    return await promise;
  } finally {
    adminUserInflight.delete(userId);
  }
}

export async function requireAdmin(req: NextRequest): Promise<NextResponse | null> {
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
    return null;
  }

  const user = await loadAdminUser(payload.userId);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return null;
}
