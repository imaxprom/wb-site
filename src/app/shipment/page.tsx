"use client";

import { useEffect, useMemo, useState } from "react";
import ShipmentCalcV2 from "@/modules/shipment/components/ShipmentCalcV2";
import ShipmentCalcV3 from "@/modules/shipment/components/ShipmentCalcV3";
import ProductsTab from "@/modules/shipment/components/ProductsTab";
import UploadTab from "@/modules/shipment/components/UploadTab";
import ShipmentSettings from "@/modules/shipment/components/ShipmentSettings";
import CartStockTab from "@/modules/shipment/components/CartStockTab";
import { useData } from "@/components/DataProvider";
import { SupplyDeductionSelector, useManualSupplyDeductionData } from "@/modules/shipment/components/SupplyDeductionSelector";
import { useEffectiveRegions } from "@/modules/shipment/lib/use-effective-regions";
import {
  normalizeExcludedWarehouseNames,
  summarizeWarehouseStock,
} from "@/modules/shipment/lib/warehouse-stock-exclusions";

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

type Tab = "calc" | "products" | "cart-stock" | "upload" | "settings";
type CalcMode = "v1" | "v2" | "v3";

export default function ShipmentPage() {
  const { settings, stock, updateSettings, isLoaded, refreshWarehouseReadyStock } = useData();
  const [tab, setTab] = useState<Tab>("calc");
  const [manualSupplyDeductionEnabled, setManualSupplyDeductionEnabled] = useState(false);
  const [selectedSupplyIds, setSelectedSupplyIds] = useState<Set<number>>(new Set());
  const effectiveRegions = useEffectiveRegions();
  const manualSupplyDeduction = useManualSupplyDeductionData(manualSupplyDeductionEnabled, selectedSupplyIds, effectiveRegions);
  const calcMode = settings.shipmentCalcMode as CalcMode | undefined;
  const excludedWarehouseNames = useMemo(
    () => normalizeExcludedWarehouseNames(settings.shipmentExcludedWarehouseNames),
    [settings.shipmentExcludedWarehouseNames],
  );
  const warehouseStockSummary = useMemo(
    () => summarizeWarehouseStock(stock, excludedWarehouseNames),
    [stock, excludedWarehouseNames],
  );

  const switchCalcMode = (mode: CalcMode) => {
    updateSettings({ shipmentCalcMode: mode });
  };

  useEffect(() => {
    if (tab !== "calc" || !isLoaded) return;
    void refreshWarehouseReadyStock();
  }, [tab, isLoaded, refreshWarehouseReadyStock]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-2">
        <TabBtn label="Расчёт" active={tab === "calc"} onClick={() => setTab("calc")} />
        <TabBtn label="Товары" active={tab === "products"} onClick={() => setTab("products")} />
        <TabBtn label="Остатки в карточке" active={tab === "cart-stock"} onClick={() => setTab("cart-stock")} />
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

          {excludedWarehouseNames.length > 0 && (
            <div className="rounded-xl border border-[var(--warning)]/30 bg-[var(--warning)]/5 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-[var(--warning)]">
                    В расчёте исключено складов: {excludedWarehouseNames.length}
                  </p>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">
                    {excludedWarehouseNames.join(", ")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs tabular-nums">
                  <span>
                    Всего WB: <b className="text-white">{warehouseStockSummary.totalUnits.toLocaleString("ru-RU")} шт.</b>
                  </span>
                  <span>
                    Учитывается: <b className="text-[var(--success)]">{warehouseStockSummary.includedUnits.toLocaleString("ru-RU")} шт.</b>
                  </span>
                  <span>
                    Исключено: <b className="text-[var(--danger)]">{warehouseStockSummary.excludedUnits.toLocaleString("ru-RU")} шт.</b>
                  </span>
                </div>
              </div>
            </div>
          )}

          {(calcMode === "v2" || calcMode === "v3") && (
            <SupplyDeductionSelector
              enabled={manualSupplyDeductionEnabled}
              selectedSupplyIds={selectedSupplyIds}
              onEnabledChange={setManualSupplyDeductionEnabled}
              onSelectedSupplyIdsChange={setSelectedSupplyIds}
              data={manualSupplyDeduction}
            />
          )}

          {/* Render based on mode */}
          {calcMode === "v3" && <ShipmentCalcV3 manualSupplyDeductByBarcode={manualSupplyDeduction.deductByBarcode} />}
          {(calcMode === "v1" || calcMode === "v2") && (
            <ShipmentCalcV2
              initialMode={calcMode}
              manualSupplyDeductByBarcode={calcMode === "v2" ? manualSupplyDeduction.deductByBarcode : undefined}
            />
          )}
          {!calcMode && (
            <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-8 text-center text-[var(--text-muted)]">
              Выберите режим расчёта: V1 Стандарт, V2 Динамика или V3 Умный.
            </div>
          )}
        </>
      )}

      {tab === "products" && <ProductsTab />}
      {tab === "cart-stock" && <CartStockTab />}
      {tab === "upload" && <UploadTab />}
      {tab === "settings" && <ShipmentSettings />}
    </div>
  );
}
