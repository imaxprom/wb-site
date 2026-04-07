"use client";

import { ApiKeySettings } from "@/components/ApiKeySettings";
import { WbAuth } from "@/components/WbAuth";

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Настройки</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Подключение к Wildberries
        </p>
      </div>

      {/* API Key */}
      <ApiKeySettings />

      {/* WB Browser Auth */}
      <WbAuth />
    </div>
  );
}
