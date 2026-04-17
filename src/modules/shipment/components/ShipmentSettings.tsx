"use client";

import { useState, useMemo, useEffect } from "react";
import { useData } from "@/components/DataProvider";
import { ALL_DISTRICTS, getDefaultRegionGroups, toRegionConfigs, shortDistrict } from "@/modules/shipment/lib/engine";
import { DistrictPicker } from "@/modules/shipment/components/DistrictPicker";
import { useBuyoutRates } from "@/modules/shipment/lib/use-effective-buyout";
import type { RegionGroup } from "@/types";

export default function ShipmentSettings() {
  const { settings, orders, updateSettings } = useData();
  // WB warehouse → federal district map (from /api/v1/tariffs/box)
  const [whToDistrict, setWhToDistrict] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    fetch("/api/data/warehouse-regions")
      .then(r => r.json())
      .then((data: { warehouses?: Array<{ warehouseName: string; district: string }> }) => {
        if (cancelled) return;
        const map: Record<string, string> = {};
        for (const w of data.warehouses || []) {
          if (w.district) map[w.warehouseName] = w.district;
        }
        setWhToDistrict(map);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Reconcile warehouses: on every WB-map update, ensure each group has all warehouses
  // matching its districts (no removal, only additions). Catches new WB warehouses.
  useEffect(() => {
    if (Object.keys(whToDistrict).length === 0) return;
    setGroups((prev) => {
      const occupiedByOther = new Map<string, string>(); // warehouse → groupId
      for (const g of prev) for (const wh of g.warehouses) occupiedByOther.set(wh, g.id);
      let changed = false;
      const next = prev.map((g) => {
        if (g.districts.length === 0) return g;
        const districtSet = new Set(g.districts);
        const allForDistricts = Object.entries(whToDistrict)
          .filter(([, d]) => districtSet.has(d))
          .map(([name]) => name);
        const existing = new Set(g.warehouses);
        const toAdd = allForDistricts.filter((wh) => {
          if (existing.has(wh)) return false;
          const owner = occupiedByOther.get(wh);
          return !owner || owner === g.id;
        });
        if (toAdd.length === 0) return g;
        changed = true;
        return { ...g, warehouses: [...g.warehouses, ...toAdd] };
      });
      return changed ? next : prev;
    });
  }, [whToDistrict]);
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpanded = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

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

  // Per-article buyout rates from realization (sales − returns)
  const buyoutRates = useBuyoutRates();

  // CIS orders (no federal district) — distributed by warehouse
  const cisOrderCount = useMemo(() => {
    return nonCancelledOrders.filter((o) => !o.federalDistrict || o.federalDistrict === "").length;
  }, [nonCancelledOrders]);

  // Per-group Russian region counts: groupId → Map<regionName, count> (orders with federalDistrict)
  const ruRegionsByGroup = useMemo(() => {
    const result: Record<string, Map<string, number>> = {};
    for (const o of nonCancelledOrders) {
      if (!o.federalDistrict) continue;
      // Find group via district
      const group = groups.find((g) => g.districts.includes(o.federalDistrict));
      if (!group) continue;
      const region = (o.region || "").trim();
      if (!region) continue;
      if (!result[group.id]) result[group.id] = new Map();
      result[group.id].set(region, (result[group.id].get(region) || 0) + 1);
    }
    return result;
  }, [nonCancelledOrders, groups]);

  const totalRuOrders = useMemo(() => {
    return nonCancelledOrders.filter((o) => o.federalDistrict && o.federalDistrict !== "").length;
  }, [nonCancelledOrders]);

  // Per-group CIS region counts: groupId → Map<regionName, count>
  const cisRegionsByGroup = useMemo(() => {
    const result: Record<string, Map<string, number>> = {};
    const whToGroup = new Map<string, string>();
    for (const g of groups) {
      for (const wh of g.warehouses) whToGroup.set(wh, g.id);
    }
    for (const o of nonCancelledOrders) {
      if (o.federalDistrict && o.federalDistrict !== "") continue;
      const gid = whToGroup.get(o.warehouse);
      if (!gid) continue;
      const region = (o.region || "").trim();
      if (!region) continue;
      if (!result[gid]) result[gid] = new Map();
      result[gid].set(region, (result[gid].get(region) || 0) + 1);
    }
    return result;
  }, [nonCancelledOrders, groups]);

  // Unassigned districts
  // district → group name (used by DistrictPicker to disable already-assigned districts)
  const assignedDistricts = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of groups) {
      for (const d of g.districts) map.set(d, g.name);
    }
    return map;
  }, [groups]);

  const totalPercent = groups.reduce((s, g) => s + g.manualPercentage * 100, 0);
  const pickerGroup = groups.find((g) => g.id === pickerGroupId);

  const handleSave = () => {
    // Sync name/shortName to derived values from districts (source of truth)
    const normalized = groups.map((g) => {
      const derivedShort = g.districts.map(shortDistrict).join("+");
      return {
        ...g,
        name: derivedShort || g.name,
        shortName: derivedShort || g.shortName,
      };
    });
    updateSettings({
      buyoutRate: buyoutRate / 100,
      regions: toRegionConfigs(normalized, regionMode, orders),
      regionGroups: normalized,
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

  const addDistrictsToGroup = (groupId: string, districts: string[]) => {
    if (districts.length === 0) return;
    // Collect warehouses belonging to ANY of selected districts (from WB tariffs map)
    const districtSet = new Set(districts);
    const autoWarehouses = Object.entries(whToDistrict)
      .filter(([, d]) => districtSet.has(d))
      .map(([name]) => name);

    setGroups((prev) => {
      const occupied = new Set<string>();
      for (const g of prev) {
        if (g.id === groupId) continue;
        for (const wh of g.warehouses) occupied.add(wh);
      }
      return prev.map((g) => {
        if (g.id !== groupId) return g;
        const existingDistricts = new Set(g.districts);
        const newDistricts = districts.filter((d) => !existingDistricts.has(d));
        const existingWh = new Set(g.warehouses);
        const toAdd = autoWarehouses.filter((wh) => !existingWh.has(wh) && !occupied.has(wh));
        return {
          ...g,
          districts: [...g.districts, ...newDistricts],
          warehouses: [...g.warehouses, ...toAdd],
        };
      });
    });
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
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-xs text-[var(--accent)] font-medium">
                Реальный % выкупа по артикулам
              </p>
              <p className="text-[10px] text-[var(--text-muted)]">
                За последние 90 дней
              </p>
            </div>
            <div className="overflow-auto max-h-48">
              <table className="data-table text-xs">
                <thead>
                  <tr>
                    <th>Артикул</th>
                    <th className="num">Выкупы</th>
                    <th className="num">Отмены</th>
                    <th className="num">% выкупа</th>
                    <th className="num">vs ручной</th>
                  </tr>
                </thead>
                <tbody>
                  {buyoutRates.map((r) => {
                    const diff = (r.buyoutRate - buyoutRate / 100) * 100;
                    return (
                      <tr key={r.articleWB}>
                        <td className="font-mono text-[var(--text-muted)]">{r.articleWB}</td>
                        <td className="num">{r.sales}</td>
                        <td className="num text-[var(--danger)]">{r.returns}</td>
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
            {buyoutRates.length === 0 && (
              <p className="text-[10px] text-[var(--warning)] mt-1">Нет данных реализации.</p>
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
              💡 Включая {cisOrderCount.toLocaleString("ru-RU")} заказов СНГ ({(cisOrderCount / totalAutoOrders * 100).toFixed(1)}%) — Беларусь, Казахстан, Армения, Кыргызстан, Грузия, Таджикистан, Узбекистан. Распределены по складу отправления.
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
              ? nonCancelledOrders.filter((o) => {
                  if (o.federalDistrict) return group.districts.includes(o.federalDistrict);
                  return group.warehouses.includes(o.warehouse);
                }).length
              : 0;

            const ruRegions = ruRegionsByGroup[group.id];
            const ruRegionList = ruRegions
              ? Array.from(ruRegions.entries()).sort((a, b) => b[1] - a[1])
              : [];
            const ruTotalInGroup = ruRegionList.reduce((s, [, n]) => s + n, 0);
            const ruTotalPct = totalAutoOrders > 0 ? (ruTotalInGroup / totalAutoOrders * 100).toFixed(1) : "0.0";

            const cisRegions = cisRegionsByGroup[group.id];
            const cisRegionList = cisRegions
              ? Array.from(cisRegions.entries()).sort((a, b) => b[1] - a[1])
              : [];
            const cisTotalInGroup = cisRegionList.reduce((s, [, n]) => s + n, 0);
            const cisTotalPct = totalAutoOrders > 0 ? (cisTotalInGroup / totalAutoOrders * 100).toFixed(1) : "0.0";

            return (
              <div key={group.id} className="border border-[var(--border)] rounded-lg p-4">
                {/* Header */}
                <div className="flex items-center gap-3 mb-3">
                  {(() => {
                    const derivedShort = group.districts.map(shortDistrict).join("+") || "Без ФО";
                    return regionMode === "manual" ? (
                      <>
                        <div className="flex-1">
                          <span className="font-medium text-sm">{derivedShort}</span>
                        </div>
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
                          <span className="font-medium text-sm">{autoConfig?.shortName || derivedShort}</span>
                        </div>
                        <div className="text-right">
                          <div className="text-white font-bold text-sm">{autoPercent}%</div>
                          <div className="text-[10px] text-[var(--text-muted)]">{autoOrders} заказов</div>
                        </div>
                      </>
                    );
                  })()}
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

                {/* Russian regions — collapsible list with counts and % of total orders */}
                {ruRegionList.length > 0 && (() => {
                  const key = `${group.id}:ru`;
                  const isOpen = expanded.has(key);
                  return (
                    <div className="mb-3 bg-[var(--accent)]/5 border border-[var(--accent)]/20 rounded px-3 py-2">
                      <button
                        onClick={() => toggleExpanded(key)}
                        className="w-full flex items-baseline justify-between hover:opacity-80 transition-opacity"
                      >
                        <p className="text-xs font-medium text-[var(--accent)] uppercase tracking-wide flex items-center gap-1.5">
                          <span className={`inline-block transition-transform ${isOpen ? "rotate-90" : ""}`}>▶</span>
                          Заказы РФ
                        </p>
                        <p className="text-xs text-[var(--text-muted)]">
                          <span className="font-semibold text-[var(--text)]">{ruTotalInGroup.toLocaleString("ru-RU")}</span>
                          <span> шт · </span>
                          <span className="text-[var(--accent)] font-semibold">{ruTotalPct}%</span>
                        </p>
                      </button>
                      {isOpen && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {ruRegionList.map(([region, count]) => {
                            const pct = totalAutoOrders > 0 ? (count / totalAutoOrders * 100).toFixed(1) : "0.0";
                            return (
                              <span
                                key={region}
                                className="inline-flex items-center bg-[var(--bg)] border border-[var(--accent)]/25 text-[var(--text)] rounded px-2 py-0.5 text-xs"
                              >
                                {region} — <b className="ml-1">{count}</b>
                                <span className="text-[var(--text-muted)] ml-1">({pct}%)</span>
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* CIS orders — collapsible region list */}
                {cisRegionList.length > 0 && (() => {
                  const key = `${group.id}:cis`;
                  const isOpen = expanded.has(key);
                  return (
                    <div className="mb-3 bg-[var(--warning)]/5 border border-[var(--warning)]/20 rounded px-3 py-2">
                      <button
                        onClick={() => toggleExpanded(key)}
                        className="w-full flex items-baseline justify-between hover:opacity-80 transition-opacity"
                      >
                        <p className="text-xs font-medium text-[var(--warning)] uppercase tracking-wide flex items-center gap-1.5">
                          <span className={`inline-block transition-transform ${isOpen ? "rotate-90" : ""}`}>▶</span>
                          Заказы СНГ
                        </p>
                        <p className="text-xs text-[var(--text-muted)]">
                          <span className="font-semibold text-[var(--text)]">{cisTotalInGroup.toLocaleString("ru-RU")}</span>
                          <span> шт · </span>
                          <span className="text-[var(--warning)] font-semibold">{cisTotalPct}%</span>
                        </p>
                      </button>
                      {isOpen && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {cisRegionList.map(([region, count]) => {
                            const pct = totalAutoOrders > 0 ? (count / totalAutoOrders * 100).toFixed(1) : "0.0";
                            return (
                              <span
                                key={region}
                                className="inline-flex items-center bg-[var(--bg)] border border-[var(--warning)]/25 text-[var(--text)] rounded px-2 py-0.5 text-xs"
                              >
                                {region} — <b className="ml-1">{count}</b>
                                <span className="text-[var(--text-muted)] ml-1">({pct}%)</span>
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Warehouses — read-only, auto-populated from WB Tariffs */}
                <div className="mt-3">
                  <p className="text-xs font-medium text-[var(--text-muted)] uppercase tracking-wide mb-1.5">
                    Склады ({group.warehouses.length})
                  </p>
                  {group.warehouses.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {group.warehouses.map((wh) => (
                        <span
                          key={wh}
                          className="inline-flex items-center bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 text-xs"
                        >
                          {wh}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className="text-xs text-[var(--text-muted)] italic">Добавятся автоматически при выборе ФО</span>
                  )}
                </div>

                {/* Add districts button */}
                <button
                  onClick={() => setPickerGroupId(group.id)}
                  className="mt-3 inline-flex items-center gap-1 border border-dashed border-[var(--border)] hover:border-[var(--accent)] rounded-lg px-3 py-1.5 text-sm text-[var(--accent)] hover:bg-[var(--accent)]/5 transition-colors"
                >
                  + Добавить ФО
                </button>
              </div>
            );
          })}
        </div>

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

      {/* District Picker Modal — multi-select ФО, warehouses pulled automatically */}
      {pickerGroup && (
        <DistrictPicker
          regionName={pickerGroup.name}
          assignedDistricts={assignedDistricts}
          warehouseDistricts={whToDistrict}
          onAdd={(districts) => addDistrictsToGroup(pickerGroup.id, districts)}
          onClose={() => setPickerGroupId(null)}
        />
      )}
    </div>
  );
}
