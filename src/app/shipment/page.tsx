"use client";

import { useState } from "react";
import ShipmentCalcV2 from "@/modules/shipment/components/ShipmentCalcV2";
import ShipmentCalcV3 from "@/modules/shipment/components/ShipmentCalcV3";
import ProductsTab from "@/modules/shipment/components/ProductsTab";
import UploadTab from "@/modules/shipment/components/UploadTab";
import ShipmentSettings from "@/modules/shipment/components/ShipmentSettings";
import { useData } from "@/components/DataProvider";

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={
        "px-4 py-2 text-sm font-medium rounded-lg transition-colors border " +
        (active
          ? "bg-[var(--bg-card-hover)] text-white border-[var(--accent)]"
          : "bg-transparent text-[var(--text-muted)] border-[var(--border)] hover:bg-[var(--bg-card-hover)] hover:text-[var(--text)]")
      }
    >
      {label}
    </button>
  );
}

type Tab = "calc" | "products" | "upload" | "settings";
type CalcMode = "v1" | "v2" | "v3";

export default function ShipmentPage() {
  const { settings, updateSettings, isLoaded } = useData();
  const [tab, setTab] = useState<Tab>("calc");
  const calcMode = settings.shipmentCalcMode as CalcMode | undefined;

  const switchCalcMode = (mode: CalcMode) => {
    updateSettings({ shipmentCalcMode: mode });
  };

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Расчёт отгрузки</h2>
      <div className="flex flex-wrap gap-2">
        <TabBtn label="Расчёт" active={tab === "calc"} onClick={() => setTab("calc")} />
        <TabBtn label="Товары" active={tab === "products"} onClick={() => setTab("products")} />
        <TabBtn label="Загрузка данных" active={tab === "upload"} onClick={() => setTab("upload")} />
        <TabBtn label="Настройки отгрузки" active={tab === "settings"} onClick={() => setTab("settings")} />
      </div>

      {tab === "calc" && !isLoaded && (
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-12 text-center">
          <div className="flex items-center justify-center gap-3">
            <svg className="animate-spin h-6 w-6 text-[var(--accent)]" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-[var(--text-muted)]">Загрузка настроек…</span>
          </div>
        </div>
      )}

      {tab === "calc" && isLoaded && (
        <>
          {/* Mode switcher */}
          <div className="flex rounded-lg border border-[var(--border)] overflow-hidden w-fit">
            <button
              onClick={() => switchCalcMode("v1")}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                calcMode === "v1"
                  ? "bg-[var(--bg-card-hover)] text-white"
                  : "text-[var(--text-muted)] hover:text-white"
              }`}
            >
              V1 Стандарт
            </button>
            <button
              onClick={() => switchCalcMode("v2")}
              className={`px-4 py-2 text-sm font-medium transition-colors border-l border-[var(--border)] ${
                calcMode === "v2"
                  ? "bg-[var(--accent)]/20 text-[var(--accent)]"
                  : "text-[var(--text-muted)] hover:text-white"
              }`}
            >
              V2 Динамика
            </button>
            <button
              onClick={() => switchCalcMode("v3")}
              className={`px-4 py-2 text-sm font-medium transition-colors border-l border-[var(--border)] ${
                calcMode === "v3"
                  ? "bg-[var(--success)]/20 text-[var(--success)]"
                  : "text-[var(--text-muted)] hover:text-white"
              }`}
            >
              V3 Умный
            </button>
          </div>

          {/* Render based on mode */}
          {calcMode === "v3" && <ShipmentCalcV3 />}
          {(calcMode === "v1" || calcMode === "v2") && <ShipmentCalcV2 initialMode={calcMode} />}
          {!calcMode && (
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-8 text-center text-[var(--text-muted)]">
              Выберите режим расчёта: V1 Стандарт, V2 Динамика или V3 Умный.
            </div>
          )}
        </>
      )}

      {tab === "products" && <ProductsTab />}
      {tab === "upload" && <UploadTab />}
      {tab === "settings" && <ShipmentSettings />}
    </div>
  );
}
