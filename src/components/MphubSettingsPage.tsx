"use client";

import { ApiKeySettings } from "@/components/ApiKeySettings";
import { WbAuth } from "@/components/WbAuth";
import { FbsApiKeySettings } from "@/components/FbsApiKeySettings";
import { FbsMarkingSettings } from "@/components/FbsMarkingSettings";

export function MphubSettingsPage() {
  return <div className="space-y-6">
    <div>
      <h2 className="text-2xl font-bold">Настройки</h2>
      <p className="mt-1 text-sm text-[var(--text-muted)]">Подключение к Wildberries</p>
    </div>
    <ApiKeySettings />
    <FbsMarkingSettings />
    <FbsApiKeySettings />
    <WbAuth />
  </div>;
}
