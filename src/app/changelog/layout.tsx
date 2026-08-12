import { requireSystemAdminPage } from "@/lib/page-auth";

export default async function ChangelogAdminLayout({ children }: { children: React.ReactNode }) {
  await requireSystemAdminPage();
  return children;
}
