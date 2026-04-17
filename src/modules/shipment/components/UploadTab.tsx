"use client";

import { useState, useCallback, useEffect } from "react";
import { useData } from "@/components/DataProvider";
import { formatNumber } from "@/lib/utils";
// API key is stored server-side (data/wb-api-key.txt)

type SyncState = "idle" | "loading" | "success" | "error";

export default function UploadTab() {
  const { stock, orderAggregates, products, uploadDate, clearAllData, syncFromWB, refreshData, settings, updateSettings } = useData();
  const hasData = stock.length > 0 || (orderAggregates?.totalOrders ?? 0) > 0;
  const [hasKey, setHasKey] = useState(true); // Server reads key from /tmp/wb_token.txt

  // uploadDays from settings (API), fallback 28
  const validValues = [28, 35, 42, 49, 56];
  const days = validValues.includes(settings.uploadDays ?? 0) ? (settings.uploadDays as number) : 28;

  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [syncMessage, setSyncMessage] = useState("");

  // Check if server has API key
  useEffect(() => {
    fetch("/api/auth/me").then((r) => {
      if (r.ok) setHasKey(true);
    }).catch(() => {});
  }, []);

  const handleDaysChange = useCallback(async (v: number) => {
    await updateSettings({ uploadDays: v } as Parameters<typeof updateSettings>[0]);
    // Refresh data with new period
    await refreshData();
  }, [updateSettings, refreshData]);

  const loadAll = useCallback(async () => {
    setSyncState("loading");
    setSyncMessage(`Загрузка данных за ${days} дней...`);
    try {
      await syncFromWB(days);
      setSyncState("success");
      setSyncMessage(`Данные успешно синхронизированы`);
    } catch (err) {
      setSyncState("error");
      setSyncMessage(err instanceof Error ? err.message : "Ошибка синхронизации");
    }
  }, [syncFromWB, days]);

  const isLoading = syncState === "loading";

  return (
    <div className="space-y-6">
      <div>
        <p className="text-base text-[var(--text-muted)]">
          Загрузите данные из Wildberries API
        </p>
      </div>

      {/* Auto-sync schedule */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-lg">🔄</span>
          <h3 className="font-medium">Автообновление</h3>
        </div>
        <div className="flex flex-wrap gap-3">
          {["09:00", "12:00", "15:00", "18:00", "21:00"].map((t) => {
            const [h] = t.split(":").map(Number);
            const now = new Date();
            const isPast = now.getHours() > h || (now.getHours() === h && now.getMinutes() > 0);
            return (
              <div
                key={t}
                className={`px-3 py-1.5 rounded-lg text-sm font-mono border ${
                  isPast
                    ? "border-[var(--border)] text-[var(--text-muted)]"
                    : "border-[var(--accent)]/40 text-[var(--accent)] bg-[var(--accent)]/5"
                }`}
              >
                {t}
                {isPast && " ✓"}
              </div>
            );
          })}
        </div>
        <p className="text-xs text-[var(--text-muted)] mt-2">
          Данные обновляются автоматически 5 раз в день
        </p>
      </div>

      {/* WB API section */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
        <h3 className="font-medium mb-1">Ручная загрузка из WB API</h3>
        <p className="text-sm text-[var(--text-muted)] mb-4">
          Загрузка карточек, остатков и заказов из Wildberries вручную
        </p>

        {!hasKey ? (
          <div className="bg-[var(--warning)]/10 border border-[var(--warning)]/30 rounded-lg p-3 text-sm">
            <p className="font-medium text-[var(--warning)]">API-ключ не задан</p>
            <p className="text-[var(--text-muted)] mt-1">
              Добавьте ключ на вкладке{" "}
              <span className="text-[var(--accent)]">Настройки отгрузки</span>
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <button
                onClick={loadAll}
                disabled={isLoading}
                className="px-5 py-2.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-40"
              >
                {isLoading ? "Загрузка..." : "Загрузить всё из WB"}
              </button>

              <div className="flex items-center gap-2 text-sm">
                <span className="text-[var(--text-muted)]">Заказы за</span>
                <select
                  value={days}
                  onChange={(e) => handleDaysChange(Number(e.target.value))}
                  className="bg-[var(--bg)] border border-[var(--border)] rounded px-3 py-1.5 text-sm focus:outline-none focus:border-[var(--accent)]"
                >
                  <option value={28}>4 недели (28 дней)</option>
                  <option value={35}>5 недель (35 дней)</option>
                  <option value={42}>6 недель (42 дня)</option>
                  <option value={49}>7 недель (49 дней)</option>
                  <option value={56}>8 недель (56 дней)</option>
                </select>
                <span className="text-[var(--text-muted)]">
                  {(() => {
                    const now = new Date();
                    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - days);
                    const to = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
                    const fmt = (d: Date) =>
                      `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
                    return `${fmt(from)} – ${fmt(to)}`;
                  })()}
                </span>
              </div>
            </div>

            {/* Sync status */}
            {syncState !== "idle" && (
              <div
                className={`flex items-center gap-2 text-sm ${
                  syncState === "loading"
                    ? "text-[var(--accent)]"
                    : syncState === "success"
                    ? "text-[var(--success)]"
                    : "text-[var(--danger)]"
                }`}
              >
                <span>
                  {syncState === "loading" ? "⏳" : syncState === "success" ? "✅" : "❌"}
                </span>
                <span>{syncMessage}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Current data summary */}
      {hasData && (
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium">Текущие данные</h3>
            <button
              onClick={() => {
                if (
                  confirm(
                    "Очистить данные API (остатки, заказы, карточки)?\n\nНастройки (имена артикулов, кол-во в коробе) НЕ будут затронуты."
                  )
                ) {
                  clearAllData();
                }
              }}
              className="text-sm text-[var(--danger)] hover:text-[var(--danger)]/80 transition-colors"
            >
              Очистить данные API
            </button>
          </div>
          <div className="grid grid-cols-3 gap-4 text-base">
            <div>
              <p className="text-[var(--text-muted)]">Заказы</p>
              <p className="text-xl font-bold" style={{ fontVariantNumeric: "tabular-nums" }}>
                {formatNumber(orderAggregates?.totalOrders ?? 0)}
              </p>
              <p className="text-sm text-[var(--text-muted)]">штук</p>
            </div>
            <div>
              <p className="text-[var(--text-muted)]">Остатки</p>
              <p className="text-xl font-bold" style={{ fontVariantNumeric: "tabular-nums" }}>
                {formatNumber(stock.reduce((s, i) => s + i.totalOnWarehouses, 0))}
              </p>
              <p className="text-sm text-[var(--text-muted)]">штук</p>
            </div>
            <div>
              <p className="text-[var(--text-muted)]">Товары</p>
              <p className="text-xl font-bold" style={{ fontVariantNumeric: "tabular-nums" }}>
                {products.length}
              </p>
              <p className="text-sm text-[var(--text-muted)]">артикулов</p>
            </div>
          </div>
          {uploadDate && (
            <p className="text-sm text-[var(--text-muted)] mt-3">
              Загружено: {new Date(uploadDate).toLocaleString("ru-RU")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
