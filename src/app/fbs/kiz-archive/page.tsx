import { KizArchiveClient } from "./client";
import { requireFbsKizArchivePageAccess } from "@/lib/fbs-portal-page-auth";

export default async function KizArchivePage() {
  await requireFbsKizArchivePageAccess();
  return <KizArchiveClient />;
}
