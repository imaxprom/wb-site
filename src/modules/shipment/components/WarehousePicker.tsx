"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { FALLBACK_WAREHOUSES } from "@/lib/warehouses-fallback";
import { shortDistrict } from "@/modules/shipment/lib/engine";

interface WarehousePickerProps {
  regionName: string;
  /** Warehouses already assigned to ANY region (with region name) */
  assignedWarehouses: Map<string, string>;
  /** Optional map: warehouseName → federal district (from WB Tariffs API) */
  warehouseDistricts?: Record<string, string>;
  onAdd: (warehouses: string[]) => void;
  onClose: () => void;
}

export function WarehousePicker({
  regionName,
  assignedWarehouses,
  warehouseDistricts = {},
  onAdd,
  onClose,
}: WarehousePickerProps) {
  const [allWarehouses, setAllWarehouses] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/data/warehouses");
        const data = await res.json();
        if (!cancelled && data.warehouses?.length > 0) {
          setAllWarehouses(data.warehouses);
          setLoading(false);
          return;
        }
      } catch { /* fall through */ }

      // Fallback
      if (!cancelled) {
        setAllWarehouses(FALLBACK_WAREHOUSES);
        setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const filtered = useMemo(() => {
    if (!search.trim()) return allWarehouses;
    const q = search.toLowerCase();
    return allWarehouses.filter((wh) => wh.toLowerCase().includes(q));
  }, [allWarehouses, search]);

  const toggle = useCallback((wh: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(wh)) next.delete(wh);
      else next.add(wh);
      return next;
    });
  }, []);

  const handleAdd = () => {
    onAdd(Array.from(selected));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="p-5 border-b border-[var(--border)]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-lg">Добавить склады</h3>
            <button
              onClick={onClose}
              className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl leading-none"
            >
              ✕
            </button>
          </div>
          <p className="text-sm text-[var(--accent)] mb-3">{regionName}</p>

          {/* Search */}
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Поиск по названию..."
            autoFocus
            className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[var(--accent)]"
          />
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto p-2">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-[var(--text-muted)]">
              Загрузка складов...
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-[var(--text-muted)]">
              Ничего не найдено
            </div>
          ) : (
            filtered.map((wh) => {
              const assignedTo = assignedWarehouses.get(wh);
              const isAssignedHere = assignedTo === regionName;
              const isAssignedElsewhere = assignedTo && assignedTo !== regionName;
              const isSelected = selected.has(wh);
              const isDisabled = !!assignedTo;

              return (
                <button
                  key={wh}
                  onClick={() => !isDisabled && toggle(wh)}
                  disabled={isDisabled}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm transition-colors ${
                    isDisabled
                      ? "opacity-40 cursor-not-allowed"
                      : isSelected
                      ? "bg-[var(--accent)]/10"
                      : "hover:bg-[var(--bg-card-hover)]"
                  }`}
                >
                  {/* Checkbox */}
                  <span
                    className={`w-5 h-5 rounded border flex-shrink-0 flex items-center justify-center text-xs ${
                      isSelected
                        ? "bg-[var(--accent)] border-[var(--accent)] text-white"
                        : isDisabled
                        ? "border-[var(--border)] bg-[var(--bg)]"
                        : "border-[var(--border)]"
                    }`}
                  >
                    {isSelected && "✓"}
                    {isAssignedHere && "—"}
                  </span>

                  {/* Name */}
                  <span className="flex-1">{wh}</span>

                  {/* Federal district badge (from WB Tariffs API) */}
                  {warehouseDistricts[wh] && !assignedTo && (
                    <span className="text-[10px] text-[var(--accent)] bg-[var(--accent)]/10 px-1.5 py-0.5 rounded">
                      {shortDistrict(warehouseDistricts[wh])}
                    </span>
                  )}

                  {/* Assigned badge */}
                  {assignedTo && (
                    <span className="text-xs text-[var(--text-muted)] bg-[var(--bg)] px-2 py-0.5 rounded">
                      {isAssignedHere ? "уже здесь" : `в ${assignedTo}`}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--border)] flex items-center justify-between">
          <span className="text-sm text-[var(--text-muted)]">
            {selected.size > 0
              ? `Выбрано: ${selected.size}`
              : `${filtered.length} складов`}
          </span>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
            >
              Отмена
            </button>
            <button
              onClick={handleAdd}
              disabled={selected.size === 0}
              className="px-5 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-40"
            >
              Добавить{selected.size > 0 ? ` (${selected.size})` : ""}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
