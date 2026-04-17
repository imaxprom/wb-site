"use client";

import { useEffect, useState } from "react";

interface Summary {
  overall: "ok" | "warn" | "crit";
  sync: {
    lastRun: string | null;
    lastRunHoursAgo: number | null;
    today: {
      date: string;
      complete: boolean;
      reportValue: number;
      advertisingValue: number;
      ordersValue: number;
    } | null;
    dataLagDays: number | null;
  };
  auth: {
    api: "ok" | "dead" | null;
    lk: "ok" | "dead" | null;
    apiReason: string | null;
    lkReason: string | null;
    checkedAt: string | null;
  };
  alertsRecent: string[];
}

const OVERALL_STYLE: Record<Summary["overall"], { bg: string; label: string; icon: string }> = {
  ok: { bg: "var(--success)", label: "Всё работает", icon: "✓" },
  warn: { bg: "var(--warning)", label: "Есть задержки", icon: "⚠" },
  crit: { bg: "var(--danger)", label: "Требуется вмешательство", icon: "✕" },
};

export function SummaryStatusCard() {
  const [data, setData] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = () => {
      fetch("/api/monitor/summary")
        .then(r => r.json())
        .then(d => setData(d))
        .catch(() => {})
        .finally(() => setLoading(false));
    };
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  if (loading || !data) return null;
  const style = OVERALL_STYLE[data.overall];

  const fmtValue = (n: number) => n.toLocaleString("ru-RU");
  const fmtDate = (iso: string | null) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
  };

  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
      <div className="flex items-center gap-3 mb-4">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold text-white"
          style={{ background: style.bg }}
        >
          {style.icon}
        </div>
        <div>
          <h3 className="font-semibold text-white">{style.label}</h3>
          <p className="text-xs text-[var(--text-muted)]">Сводный статус сервиса</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {/* Sync status */}
        <div className="bg-[var(--bg)] rounded-lg px-3 py-2">
          <p className="text-[10px] uppercase text-[var(--text-muted)]">Последний sync</p>
          <p className="text-sm font-medium mt-0.5">
            {data.sync.lastRunHoursAgo !== null
              ? `${data.sync.lastRunHoursAgo} ч назад`
              : "—"}
          </p>
          <p className="text-[11px] text-[var(--text-muted)]">
            {fmtDate(data.sync.lastRun)}
          </p>
        </div>

        {/* Today's data */}
        <div className="bg-[var(--bg)] rounded-lg px-3 py-2">
          <p className="text-[10px] uppercase text-[var(--text-muted)]">
            За {data.sync.today?.date || "—"}
          </p>
          {data.sync.today ? (
            <>
              <p className="text-sm font-medium mt-0.5">
                {data.sync.today.complete ? (
                  <span className="text-[var(--success)]">✓ Готово</span>
                ) : (
                  <span className="text-[var(--warning)]">в процессе</span>
                )}
              </p>
              <p className="text-[11px] text-[var(--text-muted)]">
                заказы {fmtValue(data.sync.today.ordersValue)} · реклама {fmtValue(data.sync.today.advertisingValue)}
              </p>
            </>
          ) : (
            <p className="text-sm text-[var(--text-muted)]">—</p>
          )}
        </div>

        {/* Auth */}
        <div className="bg-[var(--bg)] rounded-lg px-3 py-2">
          <p className="text-[10px] uppercase text-[var(--text-muted)]">Подключение к WB</p>
          <p className="text-sm font-medium mt-0.5 flex items-center gap-2">
            <span className={data.auth.api === "dead" ? "text-[var(--danger)]" : data.auth.api === "ok" ? "text-[var(--success)]" : "text-[var(--text-muted)]"}>
              API {data.auth.api === "dead" ? "✕" : data.auth.api === "ok" ? "✓" : "—"}
            </span>
            <span className={data.auth.lk === "dead" ? "text-[var(--danger)]" : data.auth.lk === "ok" ? "text-[var(--success)]" : "text-[var(--text-muted)]"}>
              ЛК {data.auth.lk === "dead" ? "✕" : data.auth.lk === "ok" ? "✓" : "—"}
            </span>
          </p>
          <p className="text-[11px] text-[var(--text-muted)]">
            {data.auth.checkedAt ? `проверено ${fmtDate(data.auth.checkedAt)}` : "не проверялось"}
          </p>
        </div>

        {/* Alerts */}
        <div className="bg-[var(--bg)] rounded-lg px-3 py-2">
          <p className="text-[10px] uppercase text-[var(--text-muted)]">Алерты в Telegram</p>
          <p className="text-sm font-medium mt-0.5">
            {data.alertsRecent.length > 0 ? (
              <span className="text-[var(--text)]">{data.alertsRecent.length} за последний цикл</span>
            ) : (
              <span className="text-[var(--success)]">✓ тишина</span>
            )}
          </p>
          <p className="text-[11px] text-[var(--text-muted)] truncate">
            {data.alertsRecent.length > 0
              ? data.alertsRecent[data.alertsRecent.length - 1].slice(0, 50)
              : "нет событий"}
          </p>
        </div>
      </div>
    </div>
  );
}
