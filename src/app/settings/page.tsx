import { headers } from "next/headers";
import { FbsApiKeySettings } from "@/components/FbsApiKeySettings";
import { FbsOrganizationNameSettings } from "@/components/FbsOrganizationNameSettings";
import { FbsMarkingSettings } from "@/components/FbsMarkingSettings";
import { FbsKizArchiveSettings } from "@/components/FbsKizArchiveSettings";
import { MphubSettingsPage } from "@/components/MphubSettingsPage";
import { isFbsPortalHostname } from "@/lib/fbs-portal-host";
import { requireFbsPortalAdminPage } from "@/lib/fbs-portal-page-auth";

export default async function SettingsPage() {
  const requestHeaders = await headers();
  if (!isFbsPortalHostname(requestHeaders.get("host"))) return <MphubSettingsPage />;
  await requireFbsPortalAdminPage();
  return <main className="fbs-portal-content space-y-5">
    <header>
      <h1 className="text-2xl font-bold">Настройки FBS</h1>
      <p className="mt-1 text-sm text-[var(--text-muted)]">Подключение активного юрлица к Wildberries</p>
    </header>
    <FbsOrganizationNameSettings />
    <FbsMarkingSettings />
    <FbsKizArchiveSettings />
    <FbsApiKeySettings />
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 text-sm text-[var(--text-muted)]">Настройка применяется только к выбранному в левом меню юрлицу. Ключи двух кабинетов хранятся раздельно.</div>
  </main>;
}
