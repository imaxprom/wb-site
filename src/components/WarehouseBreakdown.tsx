"use client";

import { useState } from "react";
import type { ShipmentCalculation } from "@/types";

interface WarehouseBreakdownProps {
  calculation: ShipmentCalculation;
}

export function WarehouseBreakdown({ calculation }: WarehouseBreakdownProps) {
  const [expanded, setExpanded] = useState(false);

  if (!expanded) {
    return (
      <button
        onClick={() => setExpanded(true)}
        className="text-sm text-[var(--accent)] hover:text-[var(--accent-hover)] transition-colors"
      >
        Показать детализацию по складам →
      </button>
    );
  }

  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] overflow-auto">
      <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
        <h3 className="font-medium">Детализация по складам</h3>
        <button
          onClick={() => setExpanded(false)}
          className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          Свернуть
        </button>
      </div>
      <table className="data-table">
        <thead>
          <tr>
            <th>Размер</th>
            {calculation.regionConfigs.flatMap((r) =>
              r.warehouses.map((wh) => (
                <th key={`${r.id}-${wh}`} className="num text-xs">
                  {wh.length > 15 ? wh.substring(0, 15) + "..." : wh}
                </th>
              ))
            )}
          </tr>
        </thead>
        <tbody>
          {calculation.rows.map((row) => (
            <tr key={row.barcode}>
              <td className="font-medium">{row.size}</td>
              {calculation.regionConfigs.flatMap((reg) => {
                const regionData = row.regions.find((x) => x.regionId === reg.id);
                return reg.warehouses.map((wh) => (
                  <td key={`${reg.id}-${wh}`} className="num">
                    {regionData?.warehouseBreakdown[wh] || (
                      <span className="cell-zero">0</span>
                    )}
                  </td>
                ));
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
