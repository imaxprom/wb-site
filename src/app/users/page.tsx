import { FbsPortalUsersClient } from "@/components/FbsPortalUsersClient";
import { requireFbsPortalAdminPage } from "@/lib/fbs-portal-page-auth";

export default async function WarehouseUsersPage() {
  await requireFbsPortalAdminPage();
  return <FbsPortalUsersClient />;
}
