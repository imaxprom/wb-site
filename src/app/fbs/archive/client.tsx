"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Archive,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  Search,
  Truck,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type {
  FbsArchiveBucket,
  FbsArchiveOrderDetail,
  FbsArchiveOverview,
  FbsArchiveSupplySummary,
} from "@/lib/fbs-archive";
import { cn } from "@/lib/utils";

type SupplyDetails = { supply: FbsArchiveSupplySummary | null; orders: FbsArchiveOrderDetail[] };

const EMPTY: FbsArchiveOverview = {
  supplies: [],
  days: [],
  totals: {
    orders: 0,
    supplies: 0,
    assembly: 0,
    transit: 0,
    pickup: 0,
    sold: 0,
    early_cancel: 0,
    refused: 0,
    returned: 0,
    issue: 0,
    unknown: 0,
  },
  unknownStatuses: [],
  sync: [],
};

const BUCKETS: Array<{ key: FbsArchiveBucket; label: string; color: string; pill: string }> = [
  { key: "assembly", label: "На сборке", color: "#60a5fa", pill: "border-blue-500/30 bg-blue-500/10 text-blue-300" },
  { key: "transit", label: "В пути", color: "#818cf8", pill: "border-indigo-500/30 bg-indigo-500/10 text-indigo-300" },
  { key: "pickup", label: "На ПВЗ", color: "#fbbf24", pill: "border-amber-500/30 bg-amber-500/10 text-amber-300" },
  { key: "sold", label: "Выкуплен", color: "#34d399", pill: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" },
  { key: "early_cancel", label: "Отмена в первый час", color: "#94a3b8", pill: "border-slate-500/30 bg-slate-500/10 text-slate-300" },
  { key: "refused", label: "Отказ на ПВЗ", color: "#fb923c", pill: "border-orange-500/30 bg-orange-500/10 text-orange-300" },
  { key: "returned", label: "Возврат после выкупа", color: "#e879f9", pill: "border-fuchsia-500/30 bg-fuchsia-500/10 text-fuchsia-300" },
  { key: "issue", label: "Брак / отмена", color: "#f87171", pill: "border-red-500/30 bg-red-500/10 text-red-300" },
  { key: "unknown", label: "Другой статус WB", color: "#64748b", pill: "border-slate-500/30 bg-slate-500/10 text-slate-300" },
];

const BUCKET_BY_KEY = new Map(BUCKETS.map((bucket) => [bucket.key, bucket]));

const EXACT_STATUS_LABELS: Record<string, string> = {
  "new/waiting": "Новое задание",
  "confirm/waiting": "На сборке",
  "complete/waiting": "В пути",
  "complete/sorted": "Отсортирован",
  "complete/postponed_delivery": "Доставка перенесена",
  "complete/accepted_by_carrier": "Принят перевозчиком",
  "complete/sent_to_carrier": "Передан перевозчику",
  "complete/ready_for_pickup": "Готов к получению",
  "complete/sold": "Выкуплен",
  "new/declined_by_client": "Отменён до отгрузки",
  "confirm/declined_by_client": "Отменён до отгрузки",
  "complete/declined_by_client": "Отменён до отгрузки",
  "new/canceled_by_client": "Отказ покупателя",
  "confirm/canceled_by_client": "Отказ покупателя",
  "complete/canceled_by_client": "Отказ покупателя в ПВЗ",
  "complete/defect": "Брак",
  "new/canceled": "Отменён",
  "confirm/canceled": "Отменён",
  "complete/canceled": "Отменён",
  "cancel/canceled": "Отменён продавцом",
};

const SUPPLIER_STATUS_LABELS: Record<string, string> = {
  new: "Новое задание",
  confirm: "На сборке",
  complete: "Передан в доставку",
  cancel: "Отменён продавцом",
};

const WB_STATUS_LABELS: Record<string, string> = {
  waiting: "Ожидает обработки",
  sorted: "Отсортирован",
  postponed_delivery: "Доставка перенесена",
  accepted_by_carrier: "Принят перевозчиком",
  sent_to_carrier: "Передан перевозчику",
  ready_for_pickup: "Готов к получению",
  sold: "Выкуплен",
  declined_by_client: "Отменён до отгрузки",
  canceled_by_client: "Отказ покупателя",
  defect: "Брак",
  canceled: "Отменён",
};

function localizedOrderStatus(supplierStatus: string, wbStatus: string): string {
  const exact = EXACT_STATUS_LABELS[`${supplierStatus}/${wbStatus}`];
  if (exact) return exact;
  const supplier = SUPPLIER_STATUS_LABELS[supplierStatus];
  const wb = WB_STATUS_LABELS[wbStatus];
  if (supplier && wb && supplier !== wb) return `${supplier} · ${wb}`;
  return wb || supplier || "Статус уточняется";
}

function errorText(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "error" in payload) {
    return String((payload as { error?: unknown }).error || fallback);
  }
  return fallback;
}

function formatDate(value: string | null | undefined, withTime = true): string {
  if (!value) return "—";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

function shortDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day}.${month}`;
}

function supplyStatus(supply: FbsArchiveSupplySummary) {
  if (!supply.done) return { label: "Активная", className: "border-blue-500/30 bg-blue-500/10 text-blue-300" };
  if (supply.scan_at_wb) return { label: "Принята WB", className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" };
  return { label: "Передана в доставку", className: "border-indigo-500/30 bg-indigo-500/10 text-indigo-300" };
}

function BucketPill({ bucket }: { bucket: FbsArchiveBucket }) {
  const config = BUCKET_BY_KEY.get(bucket) || BUCKET_BY_KEY.get("unknown")!;
  return <span className={cn("inline-flex rounded-lg border px-2.5 py-1 text-sm font-semibold", config.pill)}>{config.label}</span>;
}

function MetricCard({ label, value, icon, tone }: { label: string; value: number; icon: React.ReactNode; tone: string }) {
  return <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
    <div className="flex items-center justify-between gap-3 text-[var(--text-muted)]"><span>{label}</span><span className={tone}>{icon}</span></div>
    <div className="mt-2 text-3xl font-bold tabular-nums">{value.toLocaleString("ru-RU")}</div>
  </div>;
}

function OrderTable({ orders }: { orders: FbsArchiveOrderDetail[] }) {
  if (!orders.length) return <div className="p-5 text-[var(--text-muted)]">Состав поставки ещё не восстановлен.</div>;
  return <div className="overflow-x-auto border-t border-[var(--border)]">
    <table className="w-full min-w-[1180px] border-collapse text-sm">
      <thead className="bg-black/20 text-[var(--text-muted)]">
        <tr>
          <th className="px-4 py-3 text-left font-semibold">Товар</th>
          <th className="px-4 py-3 text-left font-semibold">Этикетка WB</th>
          <th className="px-4 py-3 text-left font-semibold">Заказ</th>
          <th className="px-4 py-3 text-left font-semibold">Дата</th>
          <th className="px-4 py-3 text-left font-semibold">Статус</th>
        </tr>
      </thead>
      <tbody>
        {orders.map((order) => {
          const sticker = order.sticker_number || "Номер не сохранён";
          return <tr key={order.order_id} className="border-t border-[var(--border)] align-middle hover:bg-[var(--bg-card-hover)]">
            <td className="px-4 py-3">
              <div className="flex min-w-[360px] items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/fbs/photo?orderId=${order.order_id}`} alt="" className="h-20 w-16 shrink-0 rounded-xl border border-[var(--border)] bg-black/20 object-cover" />
                <div className="min-w-0">
                  <div className="max-w-[420px] font-semibold leading-snug">{order.product_name || order.vendor_code || `Артикул ${order.nm_id}`}</div>
                  <div className="mt-1 text-[var(--text-muted)]">WB {order.nm_id} · {order.vendor_code || "без артикула"}</div>
                  {order.size_name && order.size_name !== "0" && <div className="text-[var(--text-muted)]">Размер {order.size_name}</div>}
                  {order.skus?.[0] && <div className="font-mono text-[var(--text-muted)]">ШК {order.skus[0]}</div>}
                </div>
              </div>
            </td>
            <td className="px-4 py-3 font-mono font-bold tabular-nums">{sticker}</td>
            <td className="px-4 py-3">
              <div className="font-mono font-semibold tabular-nums">{order.order_id}</div>
              {order.rid && <div className="mt-1 max-w-[260px] break-all text-[var(--text-muted)]">{order.rid}</div>}
            </td>
            <td className="px-4 py-3 tabular-nums">{formatDate(order.created_at_wb)}</td>
            <td className="px-4 py-3">
              <BucketPill bucket={order.bucket} />
              {order.return_at && <div className="mt-1 text-fuchsia-300">Возврат: {formatDate(order.return_at)}</div>}
              <div className="mt-1 text-[var(--text-muted)]">{localizedOrderStatus(order.supplier_status, order.wb_status)}</div>
              {order.status_history.length > 1 && <details className="mt-2">
                <summary className="cursor-pointer text-[var(--accent)]">История статусов</summary>
                <div className="mt-2 space-y-1 border-l border-[var(--border)] pl-3">
                  {order.status_history.map((event, index) => <div key={`${event.supplier_status}-${event.wb_status}-${index}`}>
                    <span>{localizedOrderStatus(event.supplier_status, event.wb_status)}</span>
                    <span className="ml-2 text-[var(--text-muted)]">с {formatDate(event.first_observed_at)}</span>
                  </div>)}
                </div>
              </details>}
            </td>
          </tr>;
        })}
      </tbody>
    </table>
  </div>;
}

export function FbsSupplyArchiveClient() {
  const [overview, setOverview] = useState<FbsArchiveOverview>(EMPTY);
  const [tab, setTab] = useState<"supplies" | "stats">("supplies");
  const [days, setDays] = useState(90);
  const [draftQuery, setDraftQuery] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [detailLoading, setDetailLoading] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<Map<string, SupplyDetails>>(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ days: String(days) });
      if (query) params.set("query", query);
      const response = await fetch(`/api/fbs/archive?${params.toString()}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorText(payload, "Не удалось загрузить архив поставок"));
      setOverview((payload as { overview?: FbsArchiveOverview }).overview || EMPTY);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [days, query]);

  useEffect(() => { void load(); }, [load]);

  async function loadDetails(supplyId: string, force = false) {
    if (!force && details.has(supplyId)) return;
    setDetailLoading((current) => new Set(current).add(supplyId));
    try {
      const response = await fetch(`/api/fbs/archive?supplyId=${encodeURIComponent(supplyId)}`, { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorText(payload, "Не удалось загрузить состав поставки"));
      setDetails((current) => new Map(current).set(supplyId, payload as SupplyDetails));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setDetailLoading((current) => {
        const next = new Set(current);
        next.delete(supplyId);
        return next;
      });
    }
  }

  function toggleSupply(supplyId: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(supplyId)) next.delete(supplyId);
      else {
        next.add(supplyId);
        void loadDetails(supplyId);
      }
      return next;
    });
  }

  async function synchronize() {
    if (syncing) return;
    setSyncing(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/fbs/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorText(payload, "Не удалось обновить архив"));
      const result = (payload as { result?: { orders?: number; archivedOrders?: number; warnings?: string[] } }).result;
      setNotice(`Архив обновлён: ${Number(result?.orders || 0).toLocaleString("ru-RU")} заказов${result?.archivedOrders ? `, архивных ${result.archivedOrders.toLocaleString("ru-RU")}` : ""}.`);
      setDetails(new Map());
      await load();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : String(syncError));
    } finally {
      setSyncing(false);
    }
  }

  const lastSync = useMemo(() => overview.sync
    .map((row) => row.last_success_at)
    .filter(Boolean)
    .map((value) => new Date(value as string))
    .sort((left, right) => right.getTime() - left.getTime())[0], [overview.sync]);

  return <div className="fbs-portal-content space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="flex items-center gap-3 text-2xl font-bold"><Archive className="text-[var(--accent)]" />Архив поставок</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Состав поставок и актуальный результат каждого FBS-заказа.</p>
        {lastSync && <p className="mt-1 text-sm text-[var(--text-muted)]">Обновлено {formatDate(lastSync.toISOString())}</p>}
      </div>
      <button type="button" onClick={() => void synchronize()} disabled={syncing} className="inline-flex min-h-12 items-center gap-2 rounded-xl bg-[var(--accent)] px-5 font-semibold text-white disabled:opacity-60">
        <RefreshCw size={20} className={syncing ? "animate-spin" : ""} />{syncing ? "Обновляем…" : "Обновить архив"}
      </button>
    </header>

    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
      <MetricCard label="Заказов" value={overview.totals.orders} icon={<Archive size={22} />} tone="text-[var(--accent)]" />
      <MetricCard label="В пути" value={overview.totals.transit} icon={<Truck size={22} />} tone="text-indigo-400" />
      <MetricCard label="Выкуплено" value={overview.totals.sold} icon={<PackageCheck size={22} />} tone="text-emerald-400" />
      <MetricCard label="Отказы на ПВЗ" value={overview.totals.refused} icon={<RotateCcw size={22} />} tone="text-orange-400" />
      <MetricCard label="Возвраты после выкупа" value={overview.totals.returned} icon={<RotateCcw size={22} />} tone="text-fuchsia-400" />
    </div>

    {(error || notice) && <div className={cn("rounded-xl border px-4 py-3", error ? "border-red-500/30 bg-red-500/10 text-red-300" : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300")}>{error || notice}</div>}

    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-3">
      <div className="flex gap-2">
        <button type="button" onClick={() => setTab("supplies")} className={cn("rounded-xl px-4 py-2.5 font-semibold", tab === "supplies" ? "bg-[var(--accent)] text-white" : "bg-[var(--bg)] text-[var(--text-muted)]")}>Поставки</button>
        <button type="button" onClick={() => setTab("stats")} className={cn("rounded-xl px-4 py-2.5 font-semibold", tab === "stats" ? "bg-[var(--accent)] text-white" : "bg-[var(--bg)] text-[var(--text-muted)]")}><span className="inline-flex items-center gap-2"><BarChart3 size={19} />Статистика</span></button>
      </div>
      <div className="flex flex-wrap gap-2">
        {[7, 30, 90, 0].map((value) => <button key={value} type="button" onClick={() => setDays(value)} className={cn("rounded-lg px-3 py-2 font-semibold", days === value ? "bg-white/15 text-white" : "text-[var(--text-muted)] hover:bg-white/5")}>{value ? `${value} дней` : "Всё время"}</button>)}
      </div>
    </div>

    {tab === "supplies" ? <>
      <form onSubmit={(event) => { event.preventDefault(); setQuery(draftQuery.trim()); }} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={20} />
          <input value={draftQuery} onChange={(event) => setDraftQuery(event.target.value)} placeholder="Поставка, заказ, этикетка или артикул" className="min-h-12 w-full rounded-xl border border-[var(--border)] bg-[var(--bg-card)] pl-12 pr-4 outline-none focus:border-[var(--accent)]" />
        </div>
        <button type="submit" className="rounded-xl bg-white/10 px-5 font-semibold">Найти</button>
      </form>

      <div className="space-y-3">
        {loading ? <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-8 text-center text-[var(--text-muted)]">Загружаем архив…</div> : overview.supplies.length === 0 ? <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-8 text-center text-[var(--text-muted)]">Поставки за выбранный период не найдены.</div> : overview.supplies.map((supply) => {
          const opened = expanded.has(supply.supply_id);
          const status = supplyStatus(supply);
          const detail = details.get(supply.supply_id);
          return <section key={supply.supply_id} className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
            <button type="button" onClick={() => toggleSupply(supply.supply_id)} className="flex w-full items-center gap-4 p-4 text-left">
              {opened ? <ChevronDown className="shrink-0 text-[var(--accent)]" /> : <ChevronRight className="shrink-0 text-[var(--text-muted)]" />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{supply.name}</span>
                  <span className={cn("rounded-lg border px-2 py-1 text-sm font-semibold", status.className)}>{status.label}</span>
                  {supply.mismatch && <span className="inline-flex items-center gap-1 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1 text-sm font-semibold text-red-300"><AlertTriangle size={16} />Требуется сверка</span>}
                </div>
                <div className="mt-1 break-all font-mono text-sm text-[var(--text-muted)]">{supply.supply_id}</div>
                <div className="mt-1 text-sm text-[var(--text-muted)]">{supply.destination_name || (supply.destination_office_id ? `Офис WB №${supply.destination_office_id}` : "Склад назначения не указан")} · создана {formatDate(supply.created_at_wb)}</div>
              </div>
              <div className="hidden shrink-0 flex-wrap justify-end gap-2 xl:flex">
                {BUCKETS.filter((bucket) => Number(supply[bucket.key]) > 0).map((bucket) => <span key={bucket.key} className={cn("rounded-lg border px-2.5 py-1 text-sm font-semibold tabular-nums", bucket.pill)}>{supply[bucket.key]} {bucket.label.toLowerCase()}</span>)}
              </div>
              <div className="min-w-20 shrink-0 text-right"><div className="text-2xl font-bold tabular-nums">{supply.actual_order_count}</div><div className="text-sm text-[var(--text-muted)]">заказов</div></div>
            </button>
            {opened && <div>
              <div className="flex flex-wrap gap-x-6 gap-y-2 border-t border-[var(--border)] bg-black/10 px-5 py-3 text-sm text-[var(--text-muted)]">
                <span>Закрыта: {formatDate(supply.closed_at_wb)}</span>
                <span>Принята WB: {formatDate(supply.scan_at_wb)}</span>
                <span>Состав WB: {supply.verified_order_count ?? "ещё не сверялся"}</span>
                <span>Сверка: {formatDate(supply.composition_checked_at)}</span>
              </div>
              {detailLoading.has(supply.supply_id) ? <div className="p-6 text-center text-[var(--text-muted)]"><RefreshCw className="mr-2 inline animate-spin" size={19} />Загружаем состав…</div> : <OrderTable orders={detail?.orders || []} />}
            </div>}
          </section>;
        })}
      </div>
    </> : <div className="space-y-4">
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div><h2 className="text-xl font-bold">Заказы по дням</h2><p className="text-sm text-[var(--text-muted)]">Каждый заказ относится к одному текущему результату и учитывается по дате заказа.</p></div>
        </div>
        <div className="h-[430px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={overview.days.map((day) => ({ ...day, label: shortDate(day.date) }))} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
              <CartesianGrid stroke="#2a2a3a" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" stroke="#8888a0" minTickGap={24} />
              <YAxis stroke="#8888a0" allowDecimals={false} />
              <Tooltip contentStyle={{ background: "#12121a", border: "1px solid #2a2a3a", borderRadius: 12 }} labelStyle={{ color: "#e4e4ef" }} />
              <Legend />
              {BUCKETS.map((bucket) => <Bar key={bucket.key} dataKey={bucket.key} name={bucket.label} stackId="orders" fill={bucket.color} radius={bucket.key === "unknown" ? [3, 3, 0, 0] : undefined} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {overview.unknownStatuses.length > 0 && <section className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-200">
        <h3 className="flex items-center gap-2 font-bold"><AlertTriangle size={20} />Новые статусы WB требуют проверки</h3>
        <div className="mt-2 flex flex-wrap gap-2">{overview.unknownStatuses.map((row) => <span key={`${row.supplier_status}-${row.wb_status}`} className="rounded-lg bg-black/20 px-3 py-1.5 font-mono text-sm">{row.supplier_status}/{row.wb_status}: {row.count}</span>)}</div>
      </section>}

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
        <h3 className="font-bold">Как считаются статусы</h3>
        <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
          {BUCKETS.map((bucket) => <div key={bucket.key} className="flex items-center justify-between gap-3 rounded-xl bg-black/15 px-3 py-2"><span className="flex items-center gap-2"><span className="h-3 w-3 rounded-sm" style={{ background: bucket.color }} />{bucket.label}</span><strong className="tabular-nums">{overview.totals[bucket.key]}</strong></div>)}
        </div>
      </section>
    </div>}

    {overview.sync.some((row) => row.last_error) && <section className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-200">
      <h3 className="flex items-center gap-2 font-bold"><Clock3 size={20} />Последняя синхронизация завершилась с предупреждением</h3>
      {overview.sync.filter((row) => row.last_error).map((row) => <p key={row.source} className="mt-1 text-sm">{row.source}: {row.last_error}</p>)}
    </section>}
  </div>;
}
