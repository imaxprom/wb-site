"use client";

import { useState } from "react";
import ShipmentCalcV2 from "@/modules/shipment/components/ShipmentCalcV2";
import ShipmentCalcV3 from "@/modules/shipment/components/ShipmentCalcV3";
import ProductsTab from "@/modules/shipment/components/ProductsTab";
import UploadTab from "@/modules/shipment/components/UploadTab";
import ShipmentSettings from "@/modules/shipment/components/ShipmentSettings";

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
  const [tab, setTab] = useState<Tab>("calc");
  const [calcMode, setCalcMode] = useState<CalcMode>("v3");

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Расчёт отгрузки</h2>
      <div className="flex flex-wrap gap-2">
        <TabBtn label="Расчёт" active={tab === "calc"} onClick={() => setTab("calc")} />
        <TabBtn label="Товары" active={tab === "products"} onClick={() => setTab("products")} />
        <TabBtn label="Загрузка данных" active={tab === "upload"} onClick={() => setTab("upload")} />
        <TabBtn label="Настройки отгрузки" active={tab === "settings"} onClick={() => setTab("settings")} />
      </div>

      {tab === "calc" && (
        <>
          {/* Mode switcher */}
          <div className="flex rounded-lg border border-[var(--border)] overflow-hidden w-fit">
            <button
              onClick={() => setCalcMode("v1")}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                calcMode === "v1"
                  ? "bg-[var(--bg-card-hover)] text-white"
                  : "text-[var(--text-muted)] hover:text-white"
              }`}
            >
              V1 Стандарт
            </button>
            <button
              onClick={() => setCalcMode("v2")}
              className={`px-4 py-2 text-sm font-medium transition-colors border-l border-[var(--border)] ${
                calcMode === "v2"
                  ? "bg-[var(--accent)]/20 text-[var(--accent)]"
                  : "text-[var(--text-muted)] hover:text-white"
              }`}
            >
              V2 Динамика
            </button>
            <button
              onClick={() => setCalcMode("v3")}
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
          {calcMode === "v3" ? (
            <ShipmentCalcV3 />
          ) : (
            <ShipmentCalcV2 initialMode={calcMode} />
          )}
        </>
      )}

      {tab === "products" && <ProductsTab />}
      {tab === "upload" && <UploadTab />}
      {tab === "settings" && <ShipmentSettings />}
    </div>
  );
}
