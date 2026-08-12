import { requireSystemAdminPage } from "@/lib/page-auth";

export default async function DocsAdminLayout({ children }: { children: React.ReactNode }) {
  await requireSystemAdminPage();
  return children;
}
