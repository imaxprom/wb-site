import { requireFbsPortalPageAccess } from "@/lib/fbs-portal-page-auth";

export default async function FbsStockLayout({ children }: { children: React.ReactNode }) {
  await requireFbsPortalPageAccess("stock");
  return children;
}
