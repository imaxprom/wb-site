import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyToken } from "@/lib/auth";
import { getUserByIdPg, initShipmentTablesPg } from "@/lib/shipment-db";
import { isPostgresReadonlyConnection } from "@/lib/postgres";

const DEV_READONLY_ADMIN_ID = 7218;

export async function requireSystemAdminPage(): Promise<void> {
  const cookieStore = await cookies();
  const payload = verifyToken(cookieStore.get("mphub-token")?.value || "");
  if (!payload) redirect("/login");

  if (
    process.env.NODE_ENV !== "production"
    && isPostgresReadonlyConnection()
    && payload.userId === DEV_READONLY_ADMIN_ID
  ) {
    return;
  }

  await initShipmentTablesPg();
  const user = await getUserByIdPg(payload.userId);
  if (!user) redirect("/login");
  if (user.role !== "admin") redirect("/analytics");
}
