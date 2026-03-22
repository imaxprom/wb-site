"use client";

import { useState, useMemo } from "react";
import { useData } from "@/components/DataProvider";
import { ApiKeySettings } from "@/components/ApiKeySettings";
import { WarehousePicker } from "@/components/WarehousePicker";
import type { RegionConfig } from "@/types";

export default function SettingsPage() {
  const { settings, updateSettings } = useData();
  const [buyoutRate, setBuyoutRate] = useState(settings.buyoutRate * 100);
  const [regions, setRegions] = useState<RegionConfig[]>(settings.regions);
  const [saved, setSaved] = useState(false);
  const [pickerRegionId, setPickerRegionId] = useState<string | null>(null);

  const handleSave = () => {
    updateSettings({
      buyoutRate: buyoutRate / 100,
      regions,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const updateRegion = (id: string, field: keyof RegionConfig, value: string | number) => {
    setRegions((prev) =>
      prev.map((r) => (r.id === id ? { ...r, [field]: value } : r))
    );
  };

  const updateRegionPercentage = (id: string, value: number) => {
    setRegions((prev) =>
      prev.map((r) => (r.id === id ? { ...r, percentage: value / 100 } : r))
    );
  };

  const removeWarehouse = (regionId: string, warehouseName: string) => {
    setRegions((prev) =>
      prev.map((r) => {
        if (r.id !== regionId) return r;
        return { ...r, warehouses: r.warehouses.filter((w) => w !== warehouseName) };
      })
    );
  };

  const addWarehouses = (regionId: string, warehouses: string[]) => {
    setRegions((prev) =>
      prev.map((r) => {
        if (r.id !== regionId) return r;
        const existing = new Set(r.warehouses);
        const newOnes = warehouses.filter((w) => !existing.has(w));
        return { ...r, warehouses: [...r.warehouses, ...newOnes] };
      })
    );
  };

  // Build a map of all assigned warehouses → region name (for the picker)
  const assignedWarehouses = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of regions) {
      for (const wh of r.warehouses) {
        map.set(wh, r.name);
      }
    }
    return map;
  }, [regions]);

  const totalPercent = regions.reduce((s, r) => s + r.percentage * 100, 0);
  const pickerRegion = regions.find((r) => r.id === pickerRegionId);

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Настройки</h2>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Параметры расчёта отгрузки
          </p>
        </div>
        <button
          onClick={handleSave}
          className={`px-5 py-2 rounded-lg font-medium transition-all ${
            saved
              ? "bg-[var(--success)] text-white"
              : "bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white"
          }`}
        >
          {saved ? "✓ Сохранено" : "Сохранить"}
        </button>
      </div>

      {/* API Key */}
      <ApiKeySettings />

      {/* Buyout rate */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
        <h3 className="font-medium mb-4">Процент выкупа</h3>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min="10"
            max="100"
            value={buyoutRate}
            onChange={(e) => setBuyoutRate(Number(e.target.value))}
            className="flex-1 accent-[var(--accent)]"
          />
          <div className="flex items-center gap-1">
            <input
              type="number"
              value={buyoutRate}
              onChange={(e) => setBuyoutRate(Number(e.target.value))}
              className="w-16 bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 text-center text-sm"
              min="10"
              max="100"
            />
            <span className="text-[var(--text-muted)]">%</span>
          </div>
        </div>
        <p className="text-xs text-[var(--text-muted)] mt-2">
          Доля заказов, которые фактически выкупаются покупателями
        </p>
      </div>

      {/* Regions */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium">Регионы и склады</h3>
          <span
            className={`text-sm font-medium ${
              Math.abs(totalPercent - 100) < 0.1
                ? "text-[var(--success)]"
                : "text-[var(--danger)]"
            }`}
          >
            Итого: {totalPercent.toFixed(0)}%
          </span>
        </div>

        <div className="space-y-6">
          {regions.map((region) => (
            <div key={region.id} className="border border-[var(--border)] rounded-lg p-4">
              <div className="flex items-center gap-4 mb-3">
                <input
                  type="text"
                  value={region.name}
                  onChange={(e) => updateRegion(region.id, "name", e.target.value)}
                  className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded px-3 py-1.5 text-sm"
                />
                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    value={Math.round(region.percentage * 100)}
                    onChange={(e) => updateRegionPercentage(region.id, Number(e.target.value))}
                    className="w-16 bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1.5 text-center text-sm"
                    min="0"
                    max="100"
                  />
                  <span className="text-[var(--text-muted)] text-sm">%</span>
                </div>
              </div>

              <div>
                <p className="text-xs text-[var(--text-muted)] uppercase tracking-wide mb-2">
                  Склады ({region.warehouses.length})
                </p>

                {/* Warehouse badges */}
                <div className="flex flex-wrap gap-2 mb-2">
                  {region.warehouses.map((wh) => (
                    <span
                      key={wh}
                      className="inline-flex items-center gap-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm group"
                    >
                      {wh}
                      <button
                        onClick={() => removeWarehouse(region.id, wh)}
                        className="text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors ml-0.5"
                      >
                        ✕
                      </button>
                    </span>
                  ))}

                  {/* Add button */}
                  <button
                    onClick={() => setPickerRegionId(region.id)}
                    className="inline-flex items-center gap-1 border border-dashed border-[var(--border)] hover:border-[var(--accent)] rounded-lg px-3 py-1.5 text-sm text-[var(--accent)] hover:bg-[var(--accent)]/5 transition-colors"
                  >
                    + Добавить
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Warehouse Picker Modal */}
      {pickerRegion && (
        <WarehousePicker
          regionName={pickerRegion.name}
          assignedWarehouses={assignedWarehouses}
          onAdd={(whs) => addWarehouses(pickerRegion.id, whs)}
          onClose={() => setPickerRegionId(null)}
        />
      )}
    </div>
  );
}
