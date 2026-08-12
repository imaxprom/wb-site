import { requireSystemAdminPage } from "@/lib/page-auth";

export default async function MonitorAdminLayout({ children }: { children: React.ReactNode }) {
  await requireSystemAdminPage();
  return children;
}
