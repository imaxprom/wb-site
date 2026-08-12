import { requireFbsPortalPageAccess } from "@/lib/fbs-portal-page-auth";

export default async function FbsLayout({ children }: { children: React.ReactNode }) {
  await requireFbsPortalPageAccess("assembly");
  return children;
}
