"use client";

import { useState, useCallback, useEffect } from "react";
import { useData } from "@/components/DataProvider";
import { formatNumber } from "@/lib/utils";

import Link from "next/link";

type SyncState = "idle" | "loading" | "success" | "error";

export default function UploadPage() {
  const { stock, orders, products, uploadDate, clearAllData, syncFromWB } = useData();
  const hasData = stock.length > 0 || orders.length > 0;
  const [hasKey, setHasKey] = useState(false);
  const [days, setDays] = useState(30);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [syncMessage, setSyncMessage] = useState("");
  const isLoading = syncState === "loading";

  useEffect(() => {
    fetch("/api/settings/apikey").then(r => r.json()).then(d => setHasKey(!!d.hasKey)).catch(() => setHasKey(false));
  }, []);

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

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Загрузка данных</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Загрузите данные из Wildberries API
        </p>
      </div>

      {/* WB API section */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
        <h3 className="font-medium mb-1">Загрузка из WB API</h3>
        <p className="text-xs text-[var(--text-muted)] mb-4">
          Автоматическая загрузка карточек, остатков и заказов из Wildberries
        </p>

        {!hasKey ? (
          <div className="bg-[var(--warning)]/10 border border-[var(--warning)]/30 rounded-lg p-3 text-sm">
            <p className="font-medium text-[var(--warning)]">API-ключ не задан</p>
            <p className="text-[var(--text-muted)] mt-1">
              Добавьте ключ в{" "}
              <Link href="/settings" className="text-[var(--accent)] hover:underline">
                Настройках
              </Link>
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
                <input
                  type="number"
                  value={days}
                  onChange={(e) => setDays(Math.max(1, Math.min(90, Number(e.target.value) || 30)))}
                  className="w-16 bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1.5 text-center text-sm focus:outline-none focus:border-[var(--accent)]"
                  min="1"
                  max="90"
                />
                <span className="text-[var(--text-muted)]">дней</span>
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
              onClick={clearAllData}
              className="text-sm text-[var(--danger)] hover:text-[var(--danger)]/80 transition-colors"
            >
              Очистить всё
            </button>
          </div>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-[var(--text-muted)]">Заказы</p>
              <p className="text-lg font-bold">{formatNumber(orders.length)}</p>
              <p className="text-xs text-[var(--text-muted)]">штук</p>
            </div>
            <div>
              <p className="text-[var(--text-muted)]">Остатки</p>
              <p className="text-lg font-bold">{formatNumber(stock.reduce((s, i) => s + i.totalOnWarehouses, 0))}</p>
              <p className="text-xs text-[var(--text-muted)]">штук</p>
            </div>
            <div>
              <p className="text-[var(--text-muted)]">Товары</p>
              <p className="text-lg font-bold">{products.length}</p>
              <p className="text-xs text-[var(--text-muted)]">артикулов</p>
            </div>
          </div>
          {uploadDate && (
            <p className="text-xs text-[var(--text-muted)] mt-3">
              Загружено: {new Date(uploadDate).toLocaleString("ru-RU")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
