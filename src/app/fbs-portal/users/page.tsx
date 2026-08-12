import { requireFbsPortalAdminPage } from "@/lib/fbs-portal-page-auth";
import { FbsPortalUsersClient } from "@/components/FbsPortalUsersClient";

export default async function FbsPortalUsersPage() {
  await requireFbsPortalAdminPage();
  return <FbsPortalUsersClient />;
}
