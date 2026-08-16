import { requireFbsPortalPageAccess } from "@/lib/fbs-portal-page-auth";
import { FbsSupplyArchiveClient } from "./client";

export default async function FbsSupplyArchivePage() {
  await requireFbsPortalPageAccess("assembly");
  return <FbsSupplyArchiveClient />;
}
