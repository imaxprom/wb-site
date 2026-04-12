"use client";

import { useMemo } from "react";
import type { OrderRecord } from "@/types";
import { ALL_DISTRICTS } from "@/modules/shipment/lib/engine";

// Mapping: warehouse name → federal district where the warehouse is physically located
const WAREHOUSE_DISTRICT: Record<string, string> = {
  // ЦФО
  "Коледино": "Центральный федеральный округ",
  "Подольск": "Центральный федеральный округ",
  "Подольск МП": "Центральный федеральный округ",
  "Электросталь": "Центральный федеральный округ",
  "Котовск": "Центральный федеральный округ",
  "Тула": "Центральный федеральный округ",
  "Тула Щегловская": "Центральный федеральный округ",
  "Владимир": "Центральный федеральный округ",
  "Воронеж": "Центральный федеральный округ",
  "Белая дача": "Центральный федеральный округ",
  "Истра": "Центральный федеральный округ",
  "Ногинск": "Центральный федеральный округ",
  "Чашниково": "Центральный федеральный округ",
  "Вёшки": "Центральный федеральный округ",
  "Рязань (Тюшевское)": "Центральный федеральный округ",
  "Домодедово Промышленная": "Центральный федеральный округ",
  "Новоколедино": "Центральный федеральный округ",
  "Щеглово(Холмогоры)": "Центральный федеральный округ",
  "Пушкино": "Центральный федеральный округ",
  "Видное": "Центральный федеральный округ",
  "Виртуальный Москва Сынково": "Центральный федеральный округ",
  "СЦ Внуково": "Центральный федеральный округ",
  "СЦ Софьино": "Центральный федеральный округ",
  "СЦ Ярославль Громова": "Центральный федеральный округ",
  "СЦ Курск": "Центральный федеральный округ",
  "Санкт-Петербург Уткина Заводь": "Центральный федеральный округ",
  // СЗФО
  "СПБ Шушары": "Северо-Западный федеральный округ",
  "СЦ Шушары": "Северо-Западный федеральный округ",
  "СПБ Московское шоссе 177": "Северо-Западный федеральный округ",
  "Калининград": "Северо-Западный федеральный округ",
  // ЮФО
  "Краснодар": "Южный федеральный округ",
  "Волгоград": "Южный федеральный округ",
  "Волгоград DNS": "Южный федеральный округ",
  "СЦ Адыгея": "Южный федеральный округ",
  // СКФО
  "Невинномысск": "Северо-Кавказский федеральный округ",
  // ПФО
  "Казань": "Приволжский федеральный округ",
  "Самара (Новосемейкино)": "Приволжский федеральный округ",
  "Самара": "Приволжский федеральный округ",
  "Сарапул": "Приволжский федеральный округ",
  "Пенза": "Приволжский федеральный округ",
  "Нижнекамск": "Приволжский федеральный округ",
  "Уфа Зубово": "Приволжский федеральный округ",
  "СЦ Кузнецк": "Приволжский федеральный округ",
  "СЦ Ижевск": "Приволжский федеральный округ",
  "Ульяновск Инженерный": "Приволжский федеральный округ",
  "Пермь 3": "Приволжский федеральный округ",
  "СЦ Оренбург Центральная": "Приволжский федеральный округ",
  // УФО
  "Екатеринбург - Испытателей 14г": "Уральский федеральный округ",
  "Екатеринбург - Перспективный 12": "Уральский федеральный округ",
  "Екатеринбург - Перспективная 14": "Уральский федеральный округ",
  "Екатеринбург Черняховского": "Уральский федеральный округ",
  "Сургут": "Уральский федеральный округ",
  "СЦ Тюмень": "Уральский федеральный округ",
  "СЦ Челябинск 2": "Уральский федеральный округ",
  // СФО
  "Новосибирск": "Сибирский федеральный округ",
  "СЦ Барнаул": "Сибирский федеральный округ",
  "Красноярск Старцево": "Сибирский федеральный округ",
  "СЦ Кемерово": "Сибирский федеральный округ",
  "СЦ Омск": "Сибирский федеральный округ",
  "Бийск": "Сибирский федеральный округ",
  "СЦ Томск": "Сибирский федеральный округ",
  "СЦ Новокузнецк": "Сибирский федеральный округ",
  "СЦ Абакан 2": "Сибирский федеральный округ",
  // ДФО
  "Владивосток": "Дальневосточный федеральный округ",
  "СЦ Хабаровск": "Дальневосточный федеральный округ",
  "СЦ Иркутск": "Дальневосточный федеральный округ",
  // Казахстан / СНГ → ближайшие ФО
  "Астана Карагандинское шоссе": "Уральский федеральный округ",
  "Актобе": "Уральский федеральный округ",
  "Атакент": "Сибирский федеральный округ",
  "Ташкент 2": "Сибирский федеральный округ",
  "Минск Привольный": "Центральный федеральный округ",
  "Минск": "Центральный федеральный округ",
  "СЦ Брест": "Центральный федеральный округ",
  "Орша": "Центральный федеральный округ",
  "СЦ Ереван": "Южный федеральный округ",
  "СЦ Гродно": "Центральный федеральный округ",
};

// Zones: merged districts
const ZONES = [
  { id: "cfo", short: "ЦФО", full: "Центральный федеральный округ", districts: ["Центральный федеральный округ"] },
  { id: "szfo", short: "СЗФО", full: "Северо-Западный федеральный округ", districts: ["Северо-Западный федеральный округ"] },
  { id: "pfo", short: "ПФО", full: "Приволжский федеральный округ", districts: ["Приволжский федеральный округ"] },
  { id: "ufo", short: "УФО", full: "Уральский федеральный округ", districts: ["Уральский федеральный округ"] },
  { id: "yufo-skfo", short: "ЮФО+СКФО", full: "Южный + Северо-Кавказский федеральный округ", districts: ["Южный федеральный округ", "Северо-Кавказский федеральный округ"] },
  { id: "sfo-dfo", short: "СФО+ДФО", full: "Сибирский + Дальневосточный федеральный округ", districts: ["Сибирский федеральный округ", "Дальневосточный федеральный округ"] },
];

function districtToZone(district: string): string | null {
  for (const z of ZONES) {
    if (z.districts.includes(district)) return z.id;
  }
  return null;
}

function getWarehouseDistrict(warehouse: string): string | null {
  if (WAREHOUSE_DISTRICT[warehouse]) return WAREHOUSE_DISTRICT[warehouse];
  // Fuzzy match by city name
  const lower = warehouse.toLowerCase();
  if (lower.includes("москв") || lower.includes("подольск") || lower.includes("коледино")) return "Центральный федеральный округ";
  if (lower.includes("петербург") || lower.includes("спб") || lower.includes("калининград")) return "Северо-Западный федеральный округ";
  if (lower.includes("краснодар") || lower.includes("волгоград") || lower.includes("ростов")) return "Южный федеральный округ";
  if (lower.includes("невинномысск") || lower.includes("пятигорск")) return "Северо-Кавказский федеральный округ";
  if (lower.includes("казань") || lower.includes("самар") || lower.includes("уфа") || lower.includes("пенз") || lower.includes("пермь")) return "Приволжский федеральный округ";
  if (lower.includes("екатеринбург") || lower.includes("челябинск") || lower.includes("тюмень") || lower.includes("сургут")) return "Уральский федеральный округ";
  if (lower.includes("новосибирск") || lower.includes("красноярск") || lower.includes("омск") || lower.includes("барнаул") || lower.includes("кемеров")) return "Сибирский федеральный округ";
  if (lower.includes("владивосток") || lower.includes("хабаровск") || lower.includes("иркутск")) return "Дальневосточный федеральный округ";
  return null;
}

interface RegionalMatrixProps {
  orders: OrderRecord[];
}

export function RegionalMatrix({ orders }: RegionalMatrixProps) {
  const { matrix, rowTotals, colTotals, grandTotal, localCount, nonLocalCount, totalOrders } = useMemo(() => {
    const m: Record<string, Record<string, number>> = {};
    const rt: Record<string, number> = {};
    const ct: Record<string, number> = {};
    let gt = 0;

    for (const z of ZONES) {
      m[z.id] = {};
      rt[z.id] = 0;
      ct[z.id] = 0;
      for (const z2 of ZONES) {
        m[z.id][z2.id] = 0;
      }
    }

    let unmappedCount = 0;
    for (const o of orders) {
      const orderZone = districtToZone(o.federalDistrict);
      const whDistrict = getWarehouseDistrict(o.warehouse);
      const whZone = whDistrict ? districtToZone(whDistrict) : null;
      if (!orderZone || !whZone) { unmappedCount++; continue; }

      m[orderZone][whZone]++;
      rt[orderZone]++;
      ct[whZone]++;
      gt++;
    }

    // Count local (diagonal) vs non-local
    // Unmapped orders count as non-local
    let local = 0;
    for (const z of ZONES) local += m[z.id][z.id];

    const totalWithUnmapped = gt + unmappedCount;
    return { matrix: m, rowTotals: rt, colTotals: ct, grandTotal: gt, localCount: local, nonLocalCount: totalWithUnmapped - local, totalOrders: totalWithUnmapped };
  }, [orders]);

  if (grandTotal === 0) return null;

  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5 h-full">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-medium text-[var(--text-muted)] uppercase tracking-wide">
          Региональное распределение
        </h3>
        <div className="flex items-center gap-1.5 text-xs" style={{ fontVariantNumeric: "tabular-nums" }}>
          <span className="text-green-400 font-medium">Локально: {totalOrders > 0 ? Math.round((localCount / totalOrders) * 100) : 0}%</span>
          <span className="text-[var(--text)] opacity-60">({localCount.toLocaleString("ru-RU")})</span>
          <span className="text-[var(--text-muted)] opacity-30 mx-1">·</span>
          <span className="text-purple-400 font-medium">Нелокально: {totalOrders > 0 ? Math.round((nonLocalCount / totalOrders) * 100) : 0}%</span>
          <span className="text-[var(--text)] opacity-60">({nonLocalCount.toLocaleString("ru-RU")})</span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr>
              <th className="p-2 text-left border-b border-[var(--border)]" rowSpan={2}>
                <span className="text-[var(--text-muted)]">ЗАКАЗ</span>
              </th>
              <th
                className="p-2 text-center border-b border-[var(--border)] text-[var(--text-muted)] uppercase tracking-wider"
                colSpan={ZONES.length}
              >
                Отправка
              </th>
            </tr>
            <tr>
              {ZONES.map((z) => (
                <th
                  key={z.id}
                  className="p-1.5 text-center border-b border-[var(--border)] text-[10px] text-[var(--text-muted)] font-medium leading-tight min-w-[70px]"
                >
                  {z.full}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ZONES.map((rowZ) => {
              const rowTotal = rowTotals[rowZ.id];
              return (
                <tr key={rowZ.id}>
                  <td className="p-2 text-[10px] font-medium text-[var(--text-muted)] border-b border-[var(--border)] leading-tight min-w-[90px]">
                    {rowZ.short}
                  </td>
                  {ZONES.map((colZ) => {
                    const count = matrix[rowZ.id][colZ.id];
                    const pct = rowTotal > 0 ? (count / rowTotal) * 100 : 0;
                    const isDiagonal = rowZ.id === colZ.id;
                    const opacity = Math.min(pct / 100, 1);

                    return (
                      <td
                        key={colZ.id}
                        className="p-1.5 text-center border-b border-[var(--border)] font-medium tabular-nums"
                        style={{
                          backgroundColor: isDiagonal
                            ? "rgba(139, 92, 246, 0.45)"
                            : pct > 0
                            ? `rgba(220, 80, 80, ${Math.min(pct / 50, 0.4)})`
                            : undefined,
                          color: isDiagonal
                            ? "white"
                            : pct > 10
                            ? "rgba(255, 200, 200, 1)"
                            : pct > 0
                            ? "var(--text)"
                            : "var(--text-muted)",
                        }}
                      >
                        {pct > 0 ? `${Math.round(pct)}%` : "0%"}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {/* Totals row */}
            <tr className="font-medium" style={{ borderTop: "2px solid var(--border)" }}>
              <td className="p-2 text-[10px] text-[var(--text)] uppercase" style={{ backgroundColor: "rgba(255,255,255,0.03)" }}>Итого</td>
              {ZONES.map((z) => {
                const pct = grandTotal > 0 ? (colTotals[z.id] / grandTotal) * 100 : 0;
                return (
                  <td
                    key={z.id}
                    className="p-1.5 text-center text-[var(--text)] tabular-nums"
                    style={{ backgroundColor: "rgba(255,255,255,0.03)" }}
                  >
                    {pct > 0 ? `${Math.round(pct)}%` : "0%"}
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
