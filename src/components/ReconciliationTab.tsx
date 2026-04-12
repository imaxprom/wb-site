"use client";

import { useState, useEffect } from "react";

interface WeekMetrics {
  salesQty: number;
  returnsQty: number;
  sales: number;
  returns: number;
  ppvz: number;
  ppvzReturns: number;
  logistics: number;
  deliveryCount: number;
  returnCount: number;
  storage: number;
  penalties: number;
  acceptance: number;
  deductions: number;
  rebill: number;
  acquiring: number;
  compensation: number;
  corrections: number;
}

interface WeekData {
  dateFrom: string;
  dateTo: string;
  status: "final" | "preliminary";
  apiWeekly: WeekMetrics;
  excelLk: WeekMetrics;
  hasExcel: boolean;
}

interface ReconciliationResponse {
  weeks: WeekData[];
  totalApi: WeekMetrics;
  totalExcel: WeekMetrics;
}

const RUB = (n: number) =>
  n.toLocaleString("ru-RU", { maximumFractionDigits: 0 }) + " ₽";
const QTY = (n: number) => n.toLocaleString("ru-RU");
const fmtDate = (d: string) => (d ? `${d.slice(8)}.${d.slice(5, 7)}` : "");

function DiffBadge({ a, b, isQty }: { a: number; b: number; isQty?: boolean }) {
  if (b === 0 && a === 0) return <span className="text-[var(--text-muted)]">—</span>;
  if (b === 0) return <span className="text-[var(--text-muted)]">н/д</span>;
  const diff = a - b;
  const pct = Math.abs(b) > 0 ? ((diff / Math.abs(b)) * 100) : 0;
  const ok = Math.abs(pct) < 1;
  const fmt = isQty ? String(diff) : (diff >= 0 ? "+" : "") + RUB(diff);
  return (
    <span className={`text-xs font-medium ${ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>
      {Math.abs(diff) <= 1 ? "✅" : `${fmt} (${pct.toFixed(1)}%)`}
    </span>
  );
}

const metrics: { key: keyof WeekMetrics; label: string; isQty?: boolean }[] = [
  { key: "salesQty", label: "Кол-во продаж", isQty: true },
  { key: "returnsQty", label: "Кол-во возвратов", isQty: true },
  { key: "sales", label: "Цена розничная с учётом согласованной скидки (продажи)" },
  { key: "returns", label: "Цена розничная с учётом согласованной скидки (возвраты)" },
  { key: "ppvz", label: "К перечислению Продавцу за реализованный Товар (продажи)" },
  { key: "ppvzReturns", label: "К перечислению Продавцу за реализованный Товар (возвраты)" },
  { key: "logistics", label: "Услуги по доставке товара покупателю" },
  { key: "deliveryCount", label: "Количество доставок", isQty: true },
  { key: "returnCount", label: "Количество возвратов (доставка)", isQty: true },
  { key: "storage", label: "Хранение" },
  { key: "penalties", label: "Общая сумма штрафов" },
  { key: "acceptance", label: "Операции на приёмке" },
  { key: "deductions", label: "Удержания (WB Продвижение)" },
  { key: "rebill", label: "Возмещение издержек по перевозке" },
  { key: "acquiring", label: "Эквайринг / Комиссии за организацию платежей" },
  { key: "compensation", label: "Компенсация скидки по программе лояльности" },
  { key: "corrections", label: "Корректировки (прочие статьи)" },
];

function TotalRow({ label, api, excel, hasExcel }: { label: string; api: WeekMetrics; excel: WeekMetrics; hasExcel: boolean }) {
  const moneyMetrics = metrics.filter((m) => !m.isQty);
  const totalApi = moneyMetrics.reduce((sum, m) => sum + api[m.key], 0);
  const totalExcel = moneyMetrics.reduce((sum, m) => sum + excel[m.key], 0);
  const diff = totalApi - totalExcel;
  const pct = Math.abs(totalExcel) > 0 ? (Math.abs(diff) / Math.abs(totalExcel)) * 100 : 0;
  const diffColor = pct < 1 ? "text-[var(--success)]" : pct < 5 ? "text-[var(--warning)]" : "text-[var(--danger)]";

  return (
    <tr style={{ borderTop: "2px solid var(--border)" }} className="font-bold bg-orange-500/15">
      <td className="text-sm py-3 text-orange-400">{label}</td>
      <td className="num py-3">{RUB(totalApi)}</td>
      <td className="num py-3">
        {hasExcel ? RUB(totalExcel) : <span className="text-[var(--text-muted)]">—</span>}
      </td>
      <td className="num py-3">
        {hasExcel ? (
          <span className={`text-xs font-bold ${diffColor}`}>
            {Math.abs(diff) <= 1 ? "✅" : `${diff >= 0 ? "+" : ""}${RUB(diff)} (${pct.toFixed(1)}%)`}
          </span>
        ) : (
          <span className="text-[var(--text-muted)]">—</span>
        )}
      </td>
    </tr>
  );
}

export default function ReconciliationTab() {
  const [weeks, setWeeks] = useState<WeekData[]>([]);
  const [totalApi, setTotalApi] = useState<WeekMetrics | null>(null);
  const [totalExcel, setTotalExcel] = useState<WeekMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedWeek, setSelectedWeek] = useState<WeekData | null>(null);

  useEffect(() => {
    fetch("/api/finance/reconciliation")
      .then((r) => r.json())
      .then((data: ReconciliationResponse) => {
        setWeeks(data.weeks);
        setTotalApi(data.totalApi);
        setTotalExcel(data.totalExcel);
        const firstFinal = data.weeks.find((w) => w.status === "final");
        if (firstFinal) setSelectedWeek(firstFinal);
        else if (data.weeks.length > 0) setSelectedWeek(data.weeks[0]);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="text-center py-12 text-[var(--text-muted)]">
        Загрузка данных сверки...
      </div>
    );
  }

  if (weeks.length === 0) {
    return (
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-8 text-center">
        <p className="text-xl font-medium">Нет данных для сверки</p>
        <p className="text-sm text-[var(--text-muted)] mt-2">
          Финальные еженедельные отчёты WB загрузятся автоматически
        </p>
      </div>
    );
  }

  const w = selectedWeek;
  const hasAnyExcel = weeks.some((wk) => wk.hasExcel);

  return (
    <div className="space-y-6">
      {/* Description */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] px-4 py-3">
        <p className="text-xs text-[var(--text-muted)]">
          Сверка сравнивает два источника данных WB: <strong className="text-[var(--text)]">API</strong> (weekly_final из finance.db) и <strong className="text-[var(--text)]">Excel</strong> (еженедельные отчёты из ЛК WB). Расхождение &lt;1% — норма.
        </p>
      </div>

      {/* Total summary across all weeks — collapsible, closed by default */}
      {totalApi && totalExcel && hasAnyExcel && (() => {
        const mm = metrics.filter(m => !m.isQty);
        const sumApi = mm.reduce((s, m) => s + totalApi[m.key], 0);
        const sumExcel = mm.reduce((s, m) => s + totalExcel[m.key], 0);
        const diff = sumApi - sumExcel;
        const pct = Math.abs(sumExcel) > 0 ? (Math.abs(diff) / Math.abs(sumExcel)) * 100 : 0;
        const color = pct < 1 ? "text-[var(--success)]" : pct < 5 ? "text-[var(--warning)]" : "text-[var(--danger)]";
        return (
        <details className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] overflow-auto">
          <summary className="p-4 cursor-pointer hover:bg-[var(--bg-card-hover)] transition-colors">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold inline">Итог по всем неделям</h3>
                <span className="text-xs text-[var(--text-muted)] ml-2">{weeks.filter(wk => wk.status === "final").length} недель</span>
              </div>
              <div className="flex items-center gap-6 text-sm">
                <div><span className="text-[var(--text-muted)] text-xs mr-1">API</span><span className="font-bold">{RUB(sumApi)}</span></div>
                <div><span className="text-[var(--text-muted)] text-xs mr-1">Excel</span><span className="font-bold">{RUB(sumExcel)}</span></div>
                <span className={`font-bold ${color}`}>{Math.abs(diff) <= 1 ? "✅" : `${diff >= 0 ? "+" : ""}${RUB(diff)} (${pct.toFixed(1)}%)`}</span>
              </div>
            </div>
          </summary>
          <table className="data-table">
            <thead>
              <tr>
                <th>Метрика</th>
                <th className="num">API</th>
                <th className="num">Excel</th>
                <th className="num">Разница</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => {
                const fmt = m.isQty ? QTY : RUB;
                const api = totalApi[m.key];
                const excel = totalExcel[m.key];
                return (
                  <tr key={m.key}>
                    <td className="font-medium text-sm">{m.label}</td>
                    <td className="num">{api ? fmt(api) : <span className="text-[var(--text-muted)]">—</span>}</td>
                    <td className="num">{excel ? fmt(excel) : <span className="text-[var(--text-muted)]">—</span>}</td>
                    <td className="num">
                      {api || excel ? <DiffBadge a={api} b={excel} isQty={m.isQty} /> : <span className="text-[var(--text-muted)]">—</span>}
                    </td>
                  </tr>
                );
              })}
              <TotalRow label="Итого" api={totalApi} excel={totalExcel} hasExcel={true} />
            </tbody>
          </table>
        </details>
        );
      })()}

      {/* Week selector */}
      <div className="flex flex-wrap gap-2">
        {weeks.map((wk) => {
          const isSelected = w?.dateFrom === wk.dateFrom;
          const isFinal = wk.status === "final";
          return (
            <button
              key={wk.dateFrom}
              onClick={() => setSelectedWeek(wk)}
              className={`px-4 py-2 rounded-lg text-sm font-medium border transition-colors ${
                isSelected
                  ? "bg-[var(--accent)]/20 text-[var(--accent)] border-[var(--accent)]"
                  : "bg-[var(--bg-card)] text-[var(--text-muted)] border-[var(--border)] hover:text-white"
              }`}
            >
              {fmtDate(wk.dateFrom)} – {fmtDate(wk.dateTo)}
              <span
                className={`ml-2 text-xs ${isFinal ? "text-[var(--success)]" : "text-[var(--warning)]"}`}
              >
                {isFinal ? "✅" : "⏳"}
              </span>
            </button>
          );
        })}
      </div>

      {/* Detail table for selected week */}
      {w && (
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] overflow-auto">
          <div className="p-4 border-b border-[var(--border)]">
            <h3 className="text-lg font-bold">
              Сверка за {fmtDate(w.dateFrom)} – {fmtDate(w.dateTo)}
            </h3>
            <div className="flex gap-4 mt-2 text-xs text-[var(--text-muted)]">
              <span>
                API:{" "}
                <span className={w.status === "final" ? "text-[var(--success)]" : "text-[var(--warning)]"}>
                  {w.status === "final" ? "✅ загружен" : "⏳ нет"}
                </span>
              </span>
              <span>
                Excel:{" "}
                <span className={w.hasExcel ? "text-[var(--success)]" : "text-[var(--text-muted)]"}>
                  {w.hasExcel ? "✅ загружен" : "— нет"}
                </span>
              </span>
            </div>
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th>Метрика</th>
                <th className="num">API</th>
                <th className="num">Excel</th>
                <th className="num">Разница</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => {
                const fmt = m.isQty ? QTY : RUB;
                const api = w.apiWeekly[m.key];
                const excel = w.excelLk[m.key];

                return (
                  <tr key={m.key}>
                    <td className="font-medium text-sm">{m.label}</td>
                    <td className="num">{api ? fmt(api) : <span className="text-[var(--text-muted)]">—</span>}</td>
                    <td className="num">
                      {w.hasExcel ? fmt(excel) : <span className="text-[var(--text-muted)]">—</span>}
                    </td>
                    <td className="num">
                      {w.hasExcel && api ? (
                        <DiffBadge a={api} b={excel} isQty={m.isQty} />
                      ) : (
                        <span className="text-[var(--text-muted)]">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              <TotalRow label="Итого (все статьи)" api={w.apiWeekly} excel={w.excelLk} hasExcel={w.hasExcel} />
            </tbody>
          </table>

          {/* Overall status */}
          {w.status === "final" && w.hasExcel && (
            <div className="p-4 border-t border-[var(--border)]">
              {(() => {
                const diffs = metrics
                  .filter((m) => !m.isQty)
                  .map((m) => ({
                    diff: Math.abs(w.apiWeekly[m.key] - w.excelLk[m.key]),
                    base: Math.abs(w.excelLk[m.key]),
                  }));
                const totalDiff = diffs.reduce((s, d) => s + d.diff, 0);
                const totalBase = diffs.reduce((s, d) => s + d.base, 0);
                const pct = totalBase > 0 ? (totalDiff / totalBase) * 100 : 0;
                const ok = pct < 1;
                return (
                  <p className={`text-sm font-medium ${ok ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>
                    API vs Excel: {ok ? "✅ Сходится" : "⚠️ Расхождение"} — общая разница{" "}
                    {pct.toFixed(2)}%
                  </p>
                );
              })()}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
