"use client";

import { useState, useCallback, useMemo } from "react";
import { ALL_DISTRICTS, shortDistrict } from "@/modules/shipment/lib/engine";

interface DistrictPickerProps {
  regionName: string;
  /** district → group name it's already assigned to (pass-through to mark unavailable) */
  assignedDistricts: Map<string, string>;
  /** Map warehouse → district (from WB Tariffs) — used to show warehouse count per district */
  warehouseDistricts?: Record<string, string>;
  onAdd: (districts: string[]) => void;
  onClose: () => void;
}

export function DistrictPicker({
  regionName,
  assignedDistricts,
  warehouseDistricts = {},
  onAdd,
  onClose,
}: DistrictPickerProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const districtStats = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const d of Object.values(warehouseDistricts)) {
      if (d) counts[d] = (counts[d] || 0) + 1;
    }
    return counts;
  }, [warehouseDistricts]);

  const toggle = useCallback((d: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  }, []);

  const handleAdd = () => {
    onAdd(Array.from(selected));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl">
        <div className="p-5 border-b border-[var(--border)]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-lg">Добавить федеральные округа</h3>
            <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl leading-none">✕</button>
          </div>
          <p className="text-sm text-[var(--accent)]">{regionName}</p>
          <p className="text-xs text-[var(--text-muted)] mt-1">Склады для выбранных ФО подтянутся автоматически из справочника WB.</p>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {ALL_DISTRICTS.map((d) => {
            const assignedTo = assignedDistricts.get(d);
            const isAssignedHere = assignedTo === regionName;
            const isAssignedElsewhere = assignedTo && assignedTo !== regionName;
            const isSelected = selected.has(d);
            const isDisabled = !!assignedTo;
            const whCount = districtStats[d] || 0;

            return (
              <button
                key={d}
                onClick={() => !isDisabled && toggle(d)}
                disabled={isDisabled}
                className={`w-full flex items-center gap-3 px-3 py-3 rounded-lg text-left text-sm transition-colors ${
                  isDisabled
                    ? "opacity-40 cursor-not-allowed"
                    : isSelected
                    ? "bg-[var(--accent)]/10"
                    : "hover:bg-[var(--bg-card-hover)]"
                }`}
              >
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

                <div className="flex-1">
                  <div className="text-[var(--accent)] font-semibold">{shortDistrict(d)}</div>
                  <div className="text-xs text-[var(--text-muted)]">{d}</div>
                </div>

                {whCount > 0 && !assignedTo && (
                  <span className="text-[10px] text-[var(--text-muted)] bg-[var(--bg)] px-2 py-0.5 rounded">
                    {whCount} складов
                  </span>
                )}

                {assignedTo && (
                  <span className="text-xs text-[var(--text-muted)] bg-[var(--bg)] px-2 py-0.5 rounded">
                    {isAssignedHere ? "уже здесь" : `в ${assignedTo}`}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="p-4 border-t border-[var(--border)] flex items-center justify-between">
          <span className="text-sm text-[var(--text-muted)]">
            {selected.size > 0 ? `Выбрано: ${selected.size}` : `${ALL_DISTRICTS.length} ФО`}
          </span>
          <div className="flex gap-3">
            <button onClick={onClose} className="px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
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
