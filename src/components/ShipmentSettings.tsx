"use client";

import { useState, useMemo } from "react";
import { useData } from "@/components/DataProvider";
import { ALL_DISTRICTS, getDefaultRegionGroups, toRegionConfigs, getAllBuyoutRates } from "@/lib/calculation-engine";
import { WarehousePicker } from "@/components/WarehousePicker";
import type { RegionGroup } from "@/types";

export default function ShipmentSettings() {
  const { settings, orders, updateSettings } = useData();
  const [buyoutRate, setBuyoutRate] = useState(settings.buyoutRate * 100);
  const [groups, setGroups] = useState<RegionGroup[]>(
    settings.regionGroups || getDefaultRegionGroups()
  );
  const [regionMode, setRegionMode] = useState<"manual" | "auto">(settings.regionMode || "manual");
  const [buyoutMode, setBuyoutMode] = useState<"manual" | "auto">(settings.buyoutMode || "manual");
  const [boxLength, setBoxLength] = useState(settings.boxLengthCm || 60);
  const [boxWidth, setBoxWidth] = useState(settings.boxWidthCm || 40);
  const [boxHeight, setBoxHeight] = useState(settings.boxHeightCm || 40);
  const [saved, setSaved] = useState(false);
  const [pickerGroupId, setPickerGroupId] = useState<string | null>(null);

  // Auto percentages preview
  const autoConfigs = useMemo(() => {
    return toRegionConfigs(groups, "auto", orders);
  }, [groups, orders]);

  // Все заказы (включая отмены) — отменённый заказ = потребность со склада
  const allOrders = orders;
  const nonCancelledOrders = allOrders; // legacy name for compatibility
  const totalAutoOrders = allOrders.length;

  // Per-district order counts (for info display)
  const districtCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const d of ALL_DISTRICTS) counts[d] = 0;
    for (const o of nonCancelledOrders) {
      if (counts[o.federalDistrict] !== undefined) {
        counts[o.federalDistrict]++;
      }
    }
    return counts;
  }, [nonCancelledOrders]);

  // Per-article buyout rates
  const buyoutRates = useMemo(() => {
    return getAllBuyoutRates(orders, settings.buyoutRate, 30);
  }, [orders, settings.buyoutRate]);

  // CIS orders (no federal district) — distributed by warehouse
  const cisOrderCount = useMemo(() => {
    return nonCancelledOrders.filter((o) => !o.federalDistrict || o.federalDistrict === "").length;
  }, [nonCancelledOrders]);

  // Unassigned districts
  const assignedDistricts = useMemo(() => {
    const set = new Set<string>();
    for (const g of groups) {
      for (const d of g.districts) set.add(d);
    }
    return set;
  }, [groups]);

  const unassignedDistricts = useMemo(() => {
    return ALL_DISTRICTS.filter((d) => !assignedDistricts.has(d));
  }, [assignedDistricts]);

  // Assigned warehouses map (for picker)
  const assignedWarehouses = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of groups) {
      for (const wh of g.warehouses) {
        map.set(wh, g.name);
      }
    }
    return map;
  }, [groups]);

  const totalPercent = groups.reduce((s, g) => s + g.manualPercentage * 100, 0);
  const pickerGroup = groups.find((g) => g.id === pickerGroupId);

  const handleSave = () => {
    updateSettings({
      buyoutRate: buyoutRate / 100,
      regions: toRegionConfigs(groups, regionMode, orders),
      regionGroups: groups,
      regionMode,
      buyoutMode,
      boxLengthCm: boxLength,
      boxWidthCm: boxWidth,
      boxHeightCm: boxHeight,
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const updateGroup = (id: string, updates: Partial<RegionGroup>) => {
    setGroups((prev) => prev.map((g) => (g.id === id ? { ...g, ...updates } : g)));
  };

  const removeDistrictFromGroup = (groupId: string, district: string) => {
    setGroups((prev) =>
      prev.map((g) => {
        if (g.id !== groupId) return g;
        return { ...g, districts: g.districts.filter((d) => d !== district) };
      })
    );
  };

  const addDistrictToGroup = (groupId: string, district: string) => {
    setGroups((prev) =>
      prev.map((g) => {
        if (g.id !== groupId) return g;
        return { ...g, districts: [...g.districts, district] };
      })
    );
  };

  const removeWarehouse = (groupId: string, wh: string) => {
    setGroups((prev) =>
      prev.map((g) => {
        if (g.id !== groupId) return g;
        return { ...g, warehouses: g.warehouses.filter((w) => w !== wh) };
      })
    );
  };

  const addWarehouses = (groupId: string, warehouses: string[]) => {
    setGroups((prev) =>
      prev.map((g) => {
        if (g.id !== groupId) return g;
        const existing = new Set(g.warehouses);
        const newOnes = warehouses.filter((w) => !existing.has(w));
        return { ...g, warehouses: [...g.warehouses, ...newOnes] };
      })
    );
  };

  const createGroup = () => {
    const id = `group-${Date.now()}`;
    setGroups((prev) => [
      ...prev,
      { id, name: "Новая группа", shortName: "НОВ", districts: [], warehouses: [], manualPercentage: 0 },
    ]);
  };

  const deleteGroup = (id: string) => {
    setGroups((prev) => prev.filter((g) => g.id !== id));
  };

  // Short district name for badges
  const shortDistrict = (d: string) => {
    const map: Record<string, string> = {
      "Центральный федеральный округ": "ЦФО",
      "Приволжский федеральный округ": "ПФО",
      "Сибирский федеральный округ": "СФО",
      "Южный федеральный округ": "ЮФО",
      "Северо-Западный федеральный округ": "СЗФО",
      "Уральский федеральный округ": "УФО",
      "Дальневосточный федеральный округ": "ДФО",
      "Северо-Кавказский федеральный округ": "СКФО",
    };
    return map[d] || d;
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-base text-[var(--text-muted)]">
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
          {saved ? "\u2713 Сохранено" : "Сохранить"}
        </button>
      </div>

      {/* Box dimensions */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
        <h3 className="font-medium mb-4">📦 Размер короба</h3>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-sm text-[var(--text-muted)]">Длина</label>
            <input type="number" value={boxLength} onChange={(e) => setBoxLength(Math.max(1, Number(e.target.value) || 60))}
              className="w-16 bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1.5 text-center text-sm focus:outline-none focus:border-[var(--accent)]" />
            <span className="text-sm text-[var(--text-muted)]">см</span>
          </div>
          <span className="text-[var(--text-muted)]">×</span>
          <div className="flex items-center gap-2">
            <label className="text-sm text-[var(--text-muted)]">Ширина</label>
            <input type="number" value={boxWidth} onChange={(e) => setBoxWidth(Math.max(1, Number(e.target.value) || 40))}
              className="w-16 bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1.5 text-center text-sm focus:outline-none focus:border-[var(--accent)]" />
            <span className="text-sm text-[var(--text-muted)]">см</span>
          </div>
          <span className="text-[var(--text-muted)]">×</span>
          <div className="flex items-center gap-2">
            <label className="text-sm text-[var(--text-muted)]">Высота</label>
            <input type="number" value={boxHeight} onChange={(e) => setBoxHeight(Math.max(1, Number(e.target.value) || 40))}
              className="w-16 bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1.5 text-center text-sm focus:outline-none focus:border-[var(--accent)]" />
            <span className="text-sm text-[var(--text-muted)]">см</span>
          </div>
          <div className="text-sm text-[var(--text-muted)] ml-2">
            = {(boxLength * boxWidth * boxHeight / 1000).toFixed(1)} л
          </div>
        </div>
      </div>

      {/* Buyout rate */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium">Процент выкупа</h3>
          <div className="flex rounded-lg border border-[var(--border)] overflow-hidden">
            <button
              onClick={() => setBuyoutMode("auto")}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                buyoutMode === "auto"
                  ? "bg-[var(--accent)]/20 text-[var(--accent)]"
                  : "text-[var(--text-muted)] hover:text-white"
              }`}
            >
              Авто (по артикулам)
            </button>
            <button
              onClick={() => setBuyoutMode("manual")}
              className={`px-3 py-1.5 text-xs font-medium transition-colors border-l border-[var(--border)] ${
                buyoutMode === "manual"
                  ? "bg-[var(--bg-card-hover)] text-white"
                  : "text-[var(--text-muted)] hover:text-white"
              }`}
            >
              Ручной на всех
            </button>
          </div>
        </div>
        {buyoutMode === "manual" && (
          <>
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
            <p className="text-sm text-[var(--text-muted)] mt-2">
              Один процент выкупа для всех артикулов
            </p>
          </>
        )}

        {buyoutMode === "auto" && buyoutRates.length > 0 && (
          <div className="mt-4 bg-[var(--bg)] border border-[var(--accent)]/20 rounded-lg p-3">
            <p className="text-xs text-[var(--accent)] font-medium mb-2">
              Реальный % выкупа по артикулам
            </p>
            <div className="overflow-auto max-h-48">
              <table className="data-table text-xs">
                <thead>
                  <tr>
                    <th>Артикул</th>
                    <th className="num">Заказов</th>
                    <th className="num">Отмены</th>
                    <th className="num">% выкупа</th>
                    <th className="num">vs ручной</th>
                  </tr>
                </thead>
                <tbody>
                  {buyoutRates.filter(r => r.totalOrders > 0).map((r) => {
                    const diff = (r.buyoutRate - buyoutRate / 100) * 100;
                    return (
                      <tr key={r.articleWB}>
                        <td className="font-mono text-[var(--text-muted)]">{r.articleWB}</td>
                        <td className="num">{r.totalOrders}</td>
                        <td className="num text-[var(--danger)]">{r.cancelledOrders}</td>
                        <td className="num font-bold" style={{
                          color: r.buyoutRate > 0.8 ? "var(--success)" : r.buyoutRate > 0.6 ? "var(--warning)" : "var(--danger)"
                        }}>
                          {(r.buyoutRate * 100).toFixed(1)}%
                        </td>
                        <td className={`num ${diff > 0 ? "text-[var(--success)]" : diff < 0 ? "text-[var(--danger)]" : ""}`}>
                          {diff > 0 ? "+" : ""}{diff.toFixed(1)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {orders.length === 0 && (
              <p className="text-[10px] text-[var(--warning)] mt-1">Нет загруженных заказов.</p>
            )}
          </div>
        )}
      </div>

      {/* Region Groups */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-medium">Регионы и склады</h3>
          <div className="flex items-center gap-3">
            <div className="flex rounded-lg border border-[var(--border)] overflow-hidden">
              <button
                onClick={() => setRegionMode("auto")}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  regionMode === "auto"
                    ? "bg-[var(--accent)]/20 text-[var(--accent)]"
                    : "text-[var(--text-muted)] hover:text-white"
                }`}
              >
                Авто (по заказам)
              </button>
              <button
                onClick={() => setRegionMode("manual")}
                className={`px-3 py-1.5 text-xs font-medium transition-colors border-l border-[var(--border)] ${
                  regionMode === "manual"
                    ? "bg-[var(--bg-card-hover)] text-white"
                    : "text-[var(--text-muted)] hover:text-white"
                }`}
              >
                Ручной %
              </button>
            </div>
            {regionMode === "manual" && (
              <span
                className={`text-sm font-medium ${
                  Math.abs(totalPercent - 100) < 0.1
                    ? "text-[var(--success)]"
                    : "text-[var(--danger)]"
                }`}
              >
                Итого: {totalPercent.toFixed(0)}%
              </span>
            )}
          </div>
        </div>

        {/* Auto info */}
        {regionMode === "auto" && totalAutoOrders > 0 && (
          <div className="space-y-1 mb-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-[var(--text-muted)]">
              На основе {totalAutoOrders.toLocaleString("ru-RU")} заказов за период
            </p>
            <span className={`text-sm font-medium ${
              Math.abs(autoConfigs.reduce((s, c) => s + c.percentage * 100, 0) - 100) < 1
                ? "text-[var(--success)]"
                : "text-[var(--warning)]"
            }`}>
              Итого: {autoConfigs.reduce((s, c) => s + c.percentage * 100, 0).toFixed(1)}%
            </span>
          </div>
          {cisOrderCount > 0 && (
            <p className="text-[10px] text-[var(--text-muted)]">
              💡 Включая {cisOrderCount.toLocaleString("ru-RU")} заказов СНГ ({(cisOrderCount / totalAutoOrders * 100).toFixed(1)}%) — Беларусь, Казахстан, Армения. Распределены по складу отправления.
            </p>
          )}
          </div>
        )}

        {/* Group cards */}
        <div className="space-y-4">
          {groups.map((group) => {
            const autoConfig = autoConfigs.find((c) => c.id === group.id);
            const autoPercent = autoConfig ? (autoConfig.percentage * 100).toFixed(1) : "0.0";
            const autoOrders = autoConfig
              ? nonCancelledOrders.filter((o) => group.districts.includes(o.federalDistrict)).length
              : 0;

            return (
              <div key={group.id} className="border border-[var(--border)] rounded-lg p-4">
                {/* Header */}
                <div className="flex items-center gap-3 mb-3">
                  {regionMode === "manual" ? (
                    <>
                      <input
                        type="text"
                        value={group.name}
                        onChange={(e) => updateGroup(group.id, { name: e.target.value })}
                        className="flex-1 bg-[var(--bg)] border border-[var(--border)] rounded px-3 py-1.5 text-sm"
                      />
                      <input
                        type="text"
                        value={group.shortName}
                        onChange={(e) => updateGroup(group.id, { shortName: e.target.value })}
                        className="w-24 bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1.5 text-center text-sm text-[var(--text-muted)]"
                        placeholder="Кратко"
                      />
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          value={Math.round(group.manualPercentage * 100)}
                          onChange={(e) =>
                            updateGroup(group.id, { manualPercentage: Number(e.target.value) / 100 })
                          }
                          className="w-16 bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1.5 text-center text-sm"
                          min="0"
                          max="100"
                        />
                        <span className="text-[var(--text-muted)] text-sm">%</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex-1">
                        <span className="font-medium text-sm">{group.name}</span>
                        <span className="text-[var(--text-muted)] text-xs ml-2">({group.shortName})</span>
                      </div>
                      <div className="text-right">
                        <div className="text-white font-bold text-sm">{autoPercent}%</div>
                        <div className="text-[10px] text-[var(--text-muted)]">{autoOrders} заказов</div>
                      </div>
                    </>
                  )}
                  <button
                    onClick={() => deleteGroup(group.id)}
                    className="text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors text-lg leading-none px-1"
                    title="Удалить группу"
                  >
                    &times;
                  </button>
                </div>

                {/* Districts */}
                <div className="mb-3">
                  <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1.5">
                    Федеральные округа ({group.districts.length})
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {group.districts.map((d) => {
                      const pct = totalAutoOrders > 0
                        ? ((districtCounts[d] || 0) / totalAutoOrders * 100).toFixed(1)
                        : null;
                      return (
                        <span
                          key={d}
                          className="inline-flex items-center gap-1 bg-[var(--accent)]/10 border border-[var(--accent)]/20 rounded px-2 py-1 text-xs"
                        >
                          <span className="text-[var(--accent)] font-medium">{shortDistrict(d)}</span>
                          {pct && <span className="text-[var(--text-muted)]">{pct}%</span>}
                          <button
                            onClick={() => removeDistrictFromGroup(group.id, d)}
                            className="text-[var(--text-muted)] hover:text-[var(--danger)] ml-0.5 transition-colors"
                          >
                            &times;
                          </button>
                        </span>
                      );
                    })}
                    {group.districts.length === 0 && (
                      <span className="text-xs text-[var(--text-muted)] italic">Нет ФО</span>
                    )}
                  </div>
                </div>

                {/* Warehouses */}
                <div>
                  <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1.5">
                    Склады ({group.warehouses.length})
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {group.warehouses.map((wh) => (
                      <span
                        key={wh}
                        className="inline-flex items-center gap-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-sm group"
                      >
                        {wh}
                        <button
                          onClick={() => removeWarehouse(group.id, wh)}
                          className="text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors ml-0.5"
                        >
                          &times;
                        </button>
                      </span>
                    ))}
                    <button
                      onClick={() => setPickerGroupId(group.id)}
                      className="inline-flex items-center gap-1 border border-dashed border-[var(--border)] hover:border-[var(--accent)] rounded-lg px-3 py-1.5 text-sm text-[var(--accent)] hover:bg-[var(--accent)]/5 transition-colors"
                    >
                      + Добавить
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Unassigned districts */}
        {unassignedDistricts.length > 0 && (
          <div className="mt-4 border border-dashed border-[var(--warning)]/30 rounded-lg p-4">
            <p className="text-xs font-medium text-[var(--warning)] uppercase tracking-wide mb-2">
              Не назначенные ФО ({unassignedDistricts.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {unassignedDistricts.map((d) => {
                const pct = totalAutoOrders > 0
                  ? ((districtCounts[d] || 0) / totalAutoOrders * 100).toFixed(1)
                  : null;
                return (
                  <UnassignedDistrictBadge
                    key={d}
                    district={d}
                    shortName={shortDistrict(d)}
                    pct={pct}
                    groups={groups}
                    onAdd={(groupId) => addDistrictToGroup(groupId, d)}
                  />
                );
              })}
            </div>
          </div>
        )}

        {/* Create group button */}
        <button
          onClick={createGroup}
          className="mt-4 w-full border border-dashed border-[var(--border)] hover:border-[var(--accent)] rounded-lg py-3 text-sm text-[var(--accent)] hover:bg-[var(--accent)]/5 transition-colors"
        >
          + Создать группу
        </button>

        {totalAutoOrders === 0 && regionMode === "auto" && (
          <p className="text-[10px] text-[var(--warning)] mt-2">
            Нет загруженных заказов. Загрузите данные на вкладке «Загрузка данных».
          </p>
        )}
      </div>

      {/* Warehouse Picker Modal */}
      {pickerGroup && (
        <WarehousePicker
          regionName={pickerGroup.name}
          assignedWarehouses={assignedWarehouses}
          onAdd={(whs) => addWarehouses(pickerGroup.id, whs)}
          onClose={() => setPickerGroupId(null)}
        />
      )}
    </div>
  );
}

/** Badge for unassigned district with "add to group" dropdown */
function UnassignedDistrictBadge({
  district,
  shortName,
  pct,
  groups,
  onAdd,
}: {
  district: string;
  shortName: string;
  pct: string | null;
  groups: RegionGroup[];
  onAdd: (groupId: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 bg-[var(--bg)] border border-[var(--warning)]/30 rounded px-2.5 py-1.5 text-xs hover:border-[var(--accent)] transition-colors"
      >
        <span className="text-[var(--warning)] font-medium">{shortName}</span>
        {pct && <span className="text-[var(--text-muted)]">{pct}%</span>}
        <span className="text-[var(--accent)] text-[10px]">+</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 z-50 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-xl py-1 min-w-[180px]">
            <p className="px-3 py-1.5 text-[10px] text-[var(--text-muted)] uppercase tracking-wide">
              Добавить в группу
            </p>
            {groups.map((g) => (
              <button
                key={g.id}
                onClick={() => {
                  onAdd(g.id);
                  setOpen(false);
                }}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-[var(--bg-card-hover)] transition-colors"
              >
                {g.shortName} — {g.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
