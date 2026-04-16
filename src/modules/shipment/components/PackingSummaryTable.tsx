"use client";

import React, { useMemo, useState } from "react";
import type { PackingItem, PackingResult } from "@/lib/packing-engine";

const ARTICLE_PALETTE = [
  { bg: "rgba(129, 140, 248, 0.08)", accent: "#818cf8", text: "#a5b4fc" }, // violet
  { bg: "rgba(245, 158, 11, 0.08)", accent: "#f59e0b", text: "#fcd34d" },  // amber
  { bg: "rgba(56, 189, 248, 0.08)", accent: "#38bdf8", text: "#7dd3fc" },  // cyan
  { bg: "rgba(34, 197, 94, 0.08)", accent: "#22c55e", text: "#86efac" },   // green
  { bg: "rgba(244, 114, 182, 0.08)", accent: "#f472b6", text: "#f9a8d4" }, // pink
  { bg: "rgba(163, 230, 53, 0.08)", accent: "#a3e635", text: "#bef264" },  // lime
];

export function PackingSummaryTable({
  packingByRegion,
  rowMeta,
}: {
  packingByRegion: Array<{ region: { id: string; shortName: string }; packing: PackingResult }>;
  rowMeta?: Record<string, { plan: number; fact: number; need: number }>;
}) {
  const aggregated = useMemo(() => {
    type SizeRow = { item: PackingItem; qtyByRegion: Record<string, number> };
    type Article = { articleWB: string; productName: string; sizes: SizeRow[]; totalUnits: number };

    const map = new Map<string, Article>();
    for (const { region, packing } of packingByRegion) {
      for (const box of packing.boxes) {
        for (const entry of box.items) {
          const { item, qty } = entry;
          if (qty <= 0) continue;
          if (!map.has(item.articleWB)) {
            map.set(item.articleWB, {
              articleWB: item.articleWB,
              productName: item.productName || item.articleName || "—",
              sizes: [],
              totalUnits: 0,
            });
          }
          const art = map.get(item.articleWB)!;
          let sr = art.sizes.find(s => s.item.barcode === item.barcode);
          if (!sr) {
            sr = { item, qtyByRegion: {} };
            art.sizes.push(sr);
          }
          sr.qtyByRegion[region.id] = (sr.qtyByRegion[region.id] || 0) + qty;
          art.totalUnits += qty;
        }
      }
    }
    for (const [key, art] of map) {
      let totalBoxes = 0;
      for (const sr of art.sizes) {
        const perBox = sr.item.perBox;
        for (const regId in sr.qtyByRegion) {
          const q = sr.qtyByRegion[regId];
          totalBoxes += perBox > 0 ? Math.round((q / perBox) * 2) / 2 : 0;
        }
      }
      if (totalBoxes === 0) map.delete(key);
    }

    const LETTER_ORDER: Record<string, number> = { XS: 1, S: 2, M: 3, L: 4, XL: 5, XXL: 6, XXXL: 7 };
    const sizeSortKey = (s: string): number => {
      const num = s.match(/\d+/);
      if (num) return parseInt(num[0], 10);
      return LETTER_ORDER[s.trim().toUpperCase()] ?? 999;
    };
    for (const art of map.values()) {
      art.sizes.sort((a, b) => sizeSortKey(a.item.size) - sizeSortKey(b.item.size));
    }
    return Array.from(map.values()).sort((a, b) => b.totalUnits - a.totalUnits);
  }, [packingByRegion]);

  const [stockByBarcode, setStockByBarcode] = useState<Record<string, string>>({});
  const [sampleByKey, setSampleByKey] = useState<Record<string, string>>({});
  const [boxesByKey, setBoxesByKey] = useState<Record<string, string>>({});
  const [deltaTooltipOpen, setDeltaTooltipOpen] = useState(false);
  const [sverkaTooltipOpen, setSverkaTooltipOpen] = useState(false);

  const regions = packingByRegion.map(p => p.region);
  // Article + Size + perBox + Barcode + Plan + Fact + Need + Stock (8) + N×2 + Sverka + Shipped(Кор/Шт/Δ) = 12 + 2N
  const totalCols = 8 + regions.length * 2 + 4;

  if (aggregated.length === 0) {
    return (
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-6 text-center text-sm text-[var(--text-muted)]">
        Нет данных для отгрузки
      </div>
    );
  }

  const headerBase: React.CSSProperties = { padding: "6px 10px", border: "1px solid var(--border)", textAlign: "center", whiteSpace: "nowrap", background: "var(--bg)", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.3, fontWeight: 600 };
  const cellBase: React.CSSProperties = { padding: "6px 10px", border: "1px solid var(--border)", textAlign: "center", whiteSpace: "nowrap", fontSize: 12 };

  const totalBoxesByRegion: Record<string, number> = {};
  const totalUnitsByRegion: Record<string, number> = {};
  let totalStock = 0;
  let totalShippedBoxes = 0;
  let totalShippedUnits = 0;
  let totalSverka = 0;
  let totalPlan = 0;
  let totalFact = 0;
  let totalNeed = 0;

  for (const art of aggregated) {
    for (const sr of art.sizes) {
      const perBox = sr.item.perBox;
      let rowShippedBoxes = 0;
      let rowShippedUnits = 0;
      for (const region of regions) {
        const qty = sr.qtyByRegion[region.id] || 0;
        const autoBoxes = perBox > 0 ? Math.round((qty / perBox) * 2) / 2 : 0;
        const key = `${sr.item.barcode}-${region.id}`;
        const override = boxesByKey[key];
        const boxes = override !== undefined && override !== ""
          ? (isNaN(Number(override.replace(",", "."))) ? 0 : Number(override.replace(",", ".")))
          : autoBoxes;
        const units = boxes * perBox;
        totalBoxesByRegion[region.id] = (totalBoxesByRegion[region.id] || 0) + boxes;
        totalUnitsByRegion[region.id] = (totalUnitsByRegion[region.id] || 0) + units;
        rowShippedBoxes += boxes;
        rowShippedUnits += units;
      }
      totalShippedBoxes += rowShippedBoxes;
      totalShippedUnits += rowShippedUnits;
      const stockStr = stockByBarcode[sr.item.barcode];
      const stock = stockStr !== undefined && stockStr !== "" ? Number(stockStr) : null;
      if (stock !== null && !isNaN(stock)) {
        totalStock += stock;
        totalSverka += stock - rowShippedBoxes;
      }
      const meta = rowMeta?.[sr.item.barcode];
      if (meta) {
        totalPlan += meta.plan;
        totalFact += meta.fact;
        totalNeed += meta.need;
      }
    }
    for (const region of regions) {
      const key = `${art.articleWB}-${region.id}`;
      const v = sampleByKey[key];
      const n = v !== undefined && v !== "" ? Number(v) : 0;
      if (!isNaN(n)) {
        totalBoxesByRegion[region.id] = (totalBoxesByRegion[region.id] || 0) + n;
        totalShippedBoxes += n;
      }
    }
  }

  return (
    <div className="overflow-auto">
      <table style={{ borderCollapse: "collapse", fontSize: 12, width: "100%", minWidth: 1100 }}>
        <thead>
          <tr>
            <th rowSpan={2} style={{ ...headerBase, minWidth: 170, background: "var(--bg-card)" }}>Артикул</th>
            <th rowSpan={2} style={{ ...headerBase, background: "var(--bg-card)" }}>Размер</th>
            <th rowSpan={2} style={{ ...headerBase, background: "var(--bg-card)", width: 70 }}>Штук<br/>в коробе</th>
            <th rowSpan={2} style={{ ...headerBase, background: "var(--bg-card)" }}>Баркод</th>
            <th rowSpan={2} style={{ ...headerBase, background: "var(--bg-card)", width: 70 }}>План</th>
            <th rowSpan={2} style={{ ...headerBase, background: "var(--bg-card)", width: 70 }}>Факт</th>
            <th rowSpan={2} style={{ ...headerBase, background: "var(--bg-card)", width: 70 }}>Нужно</th>
            <th rowSpan={2} style={{ ...headerBase, background: "var(--bg-card)", width: 70 }}>Всего на<br/>складе</th>
            {regions.map(r => (
              <th key={r.id} colSpan={2} style={{ ...headerBase, background: "rgba(129, 140, 248, 0.1)", color: "var(--accent)", minWidth: 120, whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.3 }}>
                {r.shortName}
              </th>
            ))}
            <th
              rowSpan={2}
              style={{ ...headerBase, background: "rgba(129, 140, 248, 0.15)", color: "var(--accent)", minWidth: 70, cursor: "help", position: "relative" }}
              onMouseEnter={() => setSverkaTooltipOpen(true)}
              onMouseLeave={() => setSverkaTooltipOpen(false)}
            >
              Сверка
              {sverkaTooltipOpen && (
                <div
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "100%",
                    marginTop: 6,
                    zIndex: 100,
                    width: 280,
                    padding: "12px 14px",
                    background: "var(--bg-card)",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                    textAlign: "left",
                    textTransform: "none",
                    letterSpacing: 0,
                    fontWeight: 400,
                    fontSize: 13,
                    lineHeight: 1.55,
                    color: "var(--text)",
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 8, color: "var(--accent)" }}>Сверка = Всего на складе − Отгружено (коробов)</div>
                  <div style={{ color: "var(--text-muted)", marginBottom: 10 }}>Показывает остаток коробов на складе после отгрузки.</div>
                  <div style={{ marginBottom: 4 }}><span style={{ color: "var(--success)", fontWeight: 700 }}>+ зелёным</span> — на складе остался запас</div>
                  <div style={{ marginBottom: 4 }}><span style={{ color: "#f87171", fontWeight: 700 }}>− красным</span> — склада не хватает, нужно дозаказать</div>
                  <div><span style={{ color: "var(--text-muted)", fontWeight: 700 }}>0</span> — отгружено ровно то, что есть</div>
                </div>
              )}
            </th>
            <th colSpan={3} style={{ ...headerBase, background: "rgba(129, 140, 248, 0.15)", color: "var(--accent)", minWidth: 200 }}>
              Отгружено
            </th>
          </tr>
          <tr>
            {regions.map(r => (
              <React.Fragment key={r.id}>
                <th style={{ ...headerBase, background: "var(--bg-card)", borderBottom: "2px solid var(--accent)", minWidth: 60 }}>Коробов</th>
                <th style={{ ...headerBase, background: "var(--bg-card)", borderBottom: "2px solid var(--accent)", minWidth: 60 }}>Штук</th>
              </React.Fragment>
            ))}
            <th style={{ ...headerBase, background: "var(--bg-card)", borderBottom: "2px solid var(--accent)", minWidth: 60 }}>Коробов</th>
            <th style={{ ...headerBase, background: "var(--bg-card)", borderBottom: "2px solid var(--accent)", minWidth: 60 }}>Штук</th>
            <th
              style={{ ...headerBase, background: "var(--bg-card)", borderBottom: "2px solid var(--accent)", minWidth: 40, cursor: "help", position: "relative" }}
              onMouseEnter={() => setDeltaTooltipOpen(true)}
              onMouseLeave={() => setDeltaTooltipOpen(false)}
            >
              Δ
              {deltaTooltipOpen && (
                <div
                  style={{
                    position: "absolute",
                    right: 0,
                    top: "100%",
                    marginTop: 6,
                    zIndex: 100,
                    width: 280,
                    padding: "12px 14px",
                    background: "var(--bg-card)",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
                    textAlign: "left",
                    textTransform: "none",
                    letterSpacing: 0,
                    fontWeight: 400,
                    fontSize: 13,
                    lineHeight: 1.55,
                    color: "var(--text)",
                  }}
                >
                  <div style={{ fontWeight: 700, marginBottom: 8, color: "var(--accent)" }}>Δ = Отгружено (штук) − Нужно</div>
                  <div style={{ color: "var(--text-muted)", marginBottom: 10 }}>Показывает расхождение с потребностью.</div>
                  <div style={{ marginBottom: 4 }}><span style={{ color: "var(--warning)", fontWeight: 700 }}>+ жёлтым</span> — перегруз склада</div>
                  <div style={{ marginBottom: 4 }}><span style={{ color: "#f87171", fontWeight: 700 }}>− красным</span> — потребность не покрыта</div>
                  <div><span style={{ color: "var(--success)", fontWeight: 700 }}>0 зелёным</span> — точное попадание</div>
                </div>
              )}
            </th>
          </tr>
        </thead>
        <tbody>
          {aggregated.map((art, artIdx) => {
            const color = ARTICLE_PALETTE[artIdx % ARTICLE_PALETTE.length];
            const rowSpan = art.sizes.length + 1;
            return (
              <React.Fragment key={art.articleWB}>
                {artIdx > 0 && (
                  <tr>
                    <td colSpan={totalCols} style={{ padding: 0, height: 10, background: "var(--bg)", border: "none" }}></td>
                  </tr>
                )}
                {art.sizes.map((sr, sizeIdx) => {
                  const perBox = sr.item.perBox;
                  const stockStr = stockByBarcode[sr.item.barcode] ?? "";
                  const stock = stockStr !== "" ? Number(stockStr) : null;
                  const meta = rowMeta?.[sr.item.barcode];
                  let rowShippedBoxes = 0;
                  let rowShippedUnits = 0;
                  const regionCells: React.ReactElement[] = [];
                  for (const region of regions) {
                    const qty = sr.qtyByRegion[region.id] || 0;
                    const autoBoxes = perBox > 0 ? Math.round((qty / perBox) * 2) / 2 : 0;
                    const key = `${sr.item.barcode}-${region.id}`;
                    const overrideStr = boxesByKey[key];
                    const hasOverride = overrideStr !== undefined && overrideStr !== "";
                    const parsedOverride = hasOverride ? Number((overrideStr as string).replace(",", ".")) : NaN;
                    const boxes = hasOverride ? (isNaN(parsedOverride) ? 0 : parsedOverride) : autoBoxes;
                    const units = boxes * perBox;
                    const isOverridden = hasOverride && parsedOverride !== autoBoxes;
                    rowShippedBoxes += boxes;
                    rowShippedUnits += units;
                    regionCells.push(
                      <td key={`${region.id}-b`} style={{ ...cellBase, padding: 0, background: isOverridden ? "rgba(129, 140, 248, 0.1)" : "transparent" }}>
                        <input type="text" inputMode="numeric" value={overrideStr ?? (autoBoxes > 0 ? String(autoBoxes) : "")} onChange={(e) => setBoxesByKey(prev => ({ ...prev, [key]: e.target.value }))} placeholder="—" style={{ width: "100%", padding: "6px 10px", background: "transparent", border: "none", outline: "none", textAlign: "center", color: isOverridden ? "var(--accent)" : "var(--text)", fontWeight: 600, fontVariantNumeric: "tabular-nums", fontSize: 12 }} />
                      </td>,
                      <td key={`${region.id}-u`} style={{ ...cellBase, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums", background: "rgba(255,255,255,0.02)" }}>
                        {units > 0 ? units : <span style={{ color: "var(--border)" }}>—</span>}
                      </td>
                    );
                  }
                  const sverka = stock !== null && !isNaN(stock) ? stock - rowShippedBoxes : null;
                  const sverkaColor = sverka === null ? "var(--text-muted)" : sverka > 0 ? "var(--success)" : sverka < 0 ? "#f87171" : "var(--text-muted)";
                  const sverkaBg = sverka !== null && sverka < 0 ? "rgba(248,113,113,0.08)" : "transparent";

                  return (
                    <tr key={sr.item.barcode}>
                      {sizeIdx === 0 && (
                        <td rowSpan={rowSpan} style={{ ...cellBase, textAlign: "center", padding: "10px 12px", verticalAlign: "middle", width: 180, minWidth: 160, maxWidth: 200, whiteSpace: "normal", wordBreak: "break-word", overflowWrap: "anywhere", background: color.bg, borderLeft: `3px solid ${color.accent}` }}>
                          <div style={{ fontSize: 13, fontWeight: 700, color: color.text, marginBottom: 6, lineHeight: 1.3 }}>{art.productName}</div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>Артикул WB:<br/><b style={{ color: "var(--text)", fontFamily: "SF Mono, Menlo, monospace" }}>{art.articleWB}</b></div>
                        </td>
                      )}
                      <td style={{ ...cellBase, textAlign: "left", paddingLeft: 12, fontFamily: "SF Mono, Menlo, monospace", color: "var(--text)", fontWeight: 500 }}>{sr.item.size}</td>
                      <td style={{ ...cellBase, fontVariantNumeric: "tabular-nums" }}>{perBox}</td>
                      <td style={{ ...cellBase, fontFamily: "SF Mono, Menlo, monospace", color: "var(--text-muted)" }}>{sr.item.barcode}</td>
                      <td style={{ ...cellBase, fontVariantNumeric: "tabular-nums", color: "var(--text)" }}>
                        {meta ? Math.round(meta.plan) : <span style={{ color: "var(--border)" }}>—</span>}
                      </td>
                      <td style={{ ...cellBase, fontVariantNumeric: "tabular-nums", color: "var(--text-muted)" }}>
                        {meta ? Math.round(meta.fact) : <span style={{ color: "var(--border)" }}>—</span>}
                      </td>
                      <td style={{ ...cellBase, fontVariantNumeric: "tabular-nums", color: "var(--text)", fontWeight: 600 }}>
                        {meta ? Math.round(meta.need) : <span style={{ color: "var(--border)" }}>—</span>}
                      </td>
                      <td style={{ ...cellBase, padding: 0, background: "rgba(129, 140, 248, 0.04)" }}>
                        <input type="text" value={stockStr} onChange={(e) => setStockByBarcode(prev => ({ ...prev, [sr.item.barcode]: e.target.value }))} style={{ width: "100%", padding: "6px 10px", background: "transparent", border: "none", outline: "none", textAlign: "center", color: "var(--text)", fontVariantNumeric: "tabular-nums", fontSize: 12 }} />
                      </td>
                      {regionCells}
                      <td style={{ ...cellBase, fontWeight: 700, color: sverkaColor, background: sverkaBg, fontVariantNumeric: "tabular-nums" }}>
                        {sverka !== null && !isNaN(sverka) ? (sverka > 0 ? `+${sverka}` : sverka) : "—"}
                      </td>
                      <td style={{ ...cellBase, fontWeight: 700, color: "var(--accent)", background: "rgba(129, 140, 248, 0.05)", fontVariantNumeric: "tabular-nums" }}>
                        {rowShippedBoxes}
                      </td>
                      <td style={{ ...cellBase, fontWeight: 700, color: "var(--accent)", background: "rgba(129, 140, 248, 0.05)", fontVariantNumeric: "tabular-nums" }}>
                        {rowShippedUnits}
                      </td>
                      {(() => {
                        if (!meta) return <td style={{ ...cellBase, color: "var(--border)" }}>—</td>;
                        const delta = Math.round(rowShippedUnits - meta.need);
                        const color = delta === 0 ? "var(--success)" : delta > 0 ? "var(--warning)" : "#f87171";
                        const bg = delta < 0 ? "rgba(248,113,113,0.08)" : delta > 0 ? "rgba(234,179,8,0.08)" : "transparent";
                        return (
                          <td style={{ ...cellBase, fontWeight: 700, color, background: bg, fontVariantNumeric: "tabular-nums" }}>
                            {delta > 0 ? `+${delta}` : delta}
                          </td>
                        );
                      })()}
                    </tr>
                  );
                })}
                {(() => {
                  let sampleShipped = 0;
                  const sampleCells: React.ReactElement[] = [];
                  for (const region of regions) {
                    const key = `${art.articleWB}-${region.id}`;
                    const v = sampleByKey[key] ?? "";
                    const n = v !== "" ? Number(v) : 0;
                    if (!isNaN(n)) sampleShipped += n;
                    sampleCells.push(
                      <td key={`s-${region.id}-b`} style={{ ...cellBase, padding: 0, background: "rgba(129, 140, 248, 0.04)" }}>
                        <input type="text" value={v} onChange={(e) => setSampleByKey(prev => ({ ...prev, [key]: e.target.value }))} style={{ width: "100%", padding: "6px 10px", background: "transparent", border: "none", outline: "none", textAlign: "center", color: "var(--text)", fontVariantNumeric: "tabular-nums", fontSize: 12 }} placeholder="" />
                      </td>,
                      <td key={`s-${region.id}-u`} style={{ ...cellBase, color: "var(--border)" }}>—</td>
                    );
                  }
                  return (
                    <tr style={{ background: "rgba(234, 179, 8, 0.03)" }}>
                      <td style={{ ...cellBase, textAlign: "left", paddingLeft: 12, color: "var(--warning)", fontStyle: "italic" }}>образец</td>
                      <td style={{ ...cellBase, color: "var(--border)" }}>—</td>
                      <td style={{ ...cellBase, color: "var(--border)" }}>—</td>
                      <td style={{ ...cellBase, color: "var(--border)" }}>—</td>
                      <td style={{ ...cellBase, color: "var(--border)" }}>—</td>
                      <td style={{ ...cellBase, color: "var(--border)" }}>—</td>
                      <td style={{ ...cellBase, color: "var(--border)" }}>—</td>
                      {sampleCells}
                      <td style={{ ...cellBase, color: "var(--border)" }}>—</td>
                      <td style={{ ...cellBase, fontWeight: 700, color: "var(--accent)", background: "rgba(129, 140, 248, 0.05)", fontVariantNumeric: "tabular-nums" }}>
                        {sampleShipped || "—"}
                      </td>
                      <td style={{ ...cellBase, color: "var(--border)" }}>—</td>
                      <td style={{ ...cellBase, color: "var(--border)" }}>—</td>
                    </tr>
                  );
                })()}
              </React.Fragment>
            );
          })}
          <tr>
            <td colSpan={4} style={{ ...cellBase, textAlign: "left", paddingLeft: 12, background: "rgba(34, 197, 94, 0.08)", color: "var(--success)", fontWeight: 700, textTransform: "uppercase", fontSize: 11, letterSpacing: 0.5, borderTop: "2px solid var(--success)" }}>ИТОГО</td>
            <td style={{ ...cellBase, fontWeight: 700, background: "rgba(34, 197, 94, 0.08)", borderTop: "2px solid var(--success)", fontVariantNumeric: "tabular-nums" }}>{Math.round(totalPlan) || "—"}</td>
            <td style={{ ...cellBase, fontWeight: 700, background: "rgba(34, 197, 94, 0.08)", borderTop: "2px solid var(--success)", fontVariantNumeric: "tabular-nums" }}>{Math.round(totalFact) || "—"}</td>
            <td style={{ ...cellBase, fontWeight: 700, background: "rgba(34, 197, 94, 0.08)", borderTop: "2px solid var(--success)", fontVariantNumeric: "tabular-nums" }}>{Math.round(totalNeed) || "—"}</td>
            <td style={{ ...cellBase, fontWeight: 700, background: "rgba(34, 197, 94, 0.08)", borderTop: "2px solid var(--success)", fontVariantNumeric: "tabular-nums" }}>{totalStock || "—"}</td>
            {regions.map(r => (
              <React.Fragment key={r.id}>
                <td style={{ ...cellBase, fontWeight: 700, background: "rgba(34, 197, 94, 0.08)", borderTop: "2px solid var(--success)", fontVariantNumeric: "tabular-nums" }}>{totalBoxesByRegion[r.id] || 0}</td>
                <td style={{ ...cellBase, fontWeight: 700, background: "rgba(34, 197, 94, 0.08)", borderTop: "2px solid var(--success)", fontVariantNumeric: "tabular-nums" }}>{totalUnitsByRegion[r.id] || 0}</td>
              </React.Fragment>
            ))}
            <td style={{ ...cellBase, fontWeight: 700, background: "rgba(34, 197, 94, 0.08)", borderTop: "2px solid var(--success)", color: totalSverka > 0 ? "var(--success)" : totalSverka < 0 ? "#f87171" : "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
              {totalSverka > 0 ? `+${totalSverka}` : totalSverka || "—"}
            </td>
            <td style={{ ...cellBase, fontWeight: 700, color: "var(--accent)", background: "rgba(129, 140, 248, 0.08)", borderTop: "2px solid var(--success)", fontVariantNumeric: "tabular-nums" }}>
              {totalShippedBoxes}
            </td>
            <td style={{ ...cellBase, fontWeight: 700, color: "var(--accent)", background: "rgba(129, 140, 248, 0.08)", borderTop: "2px solid var(--success)", fontVariantNumeric: "tabular-nums" }}>
              {totalShippedUnits}
            </td>
            {(() => {
              const delta = Math.round(totalShippedUnits - totalNeed);
              const color = totalNeed === 0 ? "var(--text-muted)" : delta === 0 ? "var(--success)" : delta > 0 ? "var(--warning)" : "#f87171";
              const bg = totalNeed === 0 ? "rgba(34, 197, 94, 0.08)" : delta < 0 ? "rgba(248,113,113,0.12)" : delta > 0 ? "rgba(234,179,8,0.12)" : "rgba(34, 197, 94, 0.08)";
              return (
                <td style={{ ...cellBase, fontWeight: 700, color, background: bg, borderTop: "2px solid var(--success)", fontVariantNumeric: "tabular-nums" }}>
                  {totalNeed === 0 ? "—" : (delta > 0 ? `+${delta}` : delta)}
                </td>
              );
            })()}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
