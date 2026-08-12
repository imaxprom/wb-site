"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, Printer, X } from "lucide-react";
import { getWbImageUrl } from "@/lib/wb-image";

type Panel = "accepted" | "pending" | "errors" | null;

const PRODUCTS = [
  {
    nmId: 1267055950,
    title: "Рюкзак школьный с сеткой",
    vendor: "R-4058-black",
    barcode: "204 377 581 4661",
    count: 8,
    marking: "Маркировка не требуется",
  },
  {
    nmId: 398657691,
    title: "Трусы женские хлопковые, комплект 8 шт.",
    vendor: "sl-8338-mc-9 · размер 46–48",
    barcode: "205 345 790 1787",
    count: 10,
    marking: "Честный знак обязателен",
  },
];

const STATUS_CONFIG = {
  accepted: { count: 14, label: "Принято WB", icon: CheckCircle2, color: "text-emerald-500", bg: "bg-emerald-500/10 hover:bg-emerald-500/20", border: "border-emerald-500/25" },
  pending: { count: 3, label: "Проверяется", icon: Loader2, color: "text-amber-500", bg: "bg-amber-500/10 hover:bg-amber-500/20", border: "border-amber-500/25" },
  errors: { count: 1, label: "Ошибки", icon: AlertTriangle, color: "text-red-500", bg: "bg-red-500/10 hover:bg-red-500/20", border: "border-red-500/25" },
} as const;

function StatusButton({ kind, onClick }: { kind: Exclude<Panel, null>; onClick: () => void }) {
  const item = STATUS_CONFIG[kind];
  const Icon = item.icon;
  return <button
    type="button"
    onClick={onClick}
    className={`flex h-[48px] min-w-0 items-center rounded-lg border px-3 text-left transition ${item.color} ${item.bg} ${item.border}`}
  >
    <span className="w-9 shrink-0 text-xl font-black tabular-nums">{item.count}</span>
    <span className="min-w-0 flex-1 whitespace-nowrap text-sm font-semibold text-[var(--text)]">{item.label}</span>
    <Icon size={16} className={`ml-2 shrink-0 ${kind === "pending" ? "animate-spin" : ""}`} />
  </button>;
}

export function AssemblyStatusSupplyRowPreview() {
  const [panel, setPanel] = useState<Panel>(null);

  useEffect(() => {
    const existed = document.documentElement.classList.contains("fbs-readable-ui");
    document.documentElement.classList.add("fbs-readable-ui");
    return () => { if (!existed) document.documentElement.classList.remove("fbs-readable-ui"); };
  }, []);

  return <main className="mx-auto max-w-[1500px] space-y-5 pb-12">
    <header>
      <div className="mb-2 inline-flex rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-500">Только localhost · данные учебные</div>
      <h1 className="text-2xl font-bold">Статусы в строке поставки</h1>
      <p className="mt-1 text-sm text-[var(--text-muted)]">Новый отдельный макет. Продакшен не изменён.</p>
    </header>

    <section className="grid gap-2 md:grid-cols-4">
      {[
        ["1. Новые заказы", "0 новых"],
        ["2. Сборка", "18 товаров"],
        ["3. Маркировка", "14/18"],
        ["4. Отгрузка", "ожидает"],
      ].map(([title, value], index) => <button key={title} type="button" className={`rounded-xl border px-4 py-3 text-left ${index === 1 ? "border-[var(--accent)] bg-[var(--accent)]/10" : "border-[var(--border)] bg-[var(--bg-card)]"}`}><div className="font-semibold">{title}</div><div className="text-sm text-[var(--text-muted)]">{value}</div></button>)}
    </section>

    <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3">
      <div className="grid items-center gap-2 xl:grid-cols-[auto_minmax(330px,1fr)_150px_150px_150px]">
        <label className="shrink-0 text-sm font-medium text-[var(--text-muted)]">Поставка</label>
        <select className="h-[48px] min-w-0 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3" defaultValue="demo">
          <option value="demo">Домодедово — FBS — 12.08.2026 · 18 шт.</option>
          <option>Подольск — FBS — 12.08.2026 · 11 шт.</option>
          <option>Екатеринбург — FBS — 12.08.2026 · 7 шт.</option>
        </select>
        <StatusButton kind="accepted" onClick={() => setPanel("accepted")} />
        <StatusButton kind="pending" onClick={() => setPanel("pending")} />
        <StatusButton kind="errors" onClick={() => setPanel("errors")} />
      </div>
    </section>

    <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-card)]">
      <div className="flex min-h-[52px] items-center justify-between px-4 py-2"><h2 className="text-lg font-semibold">2. Сборка товара</h2><div className="flex gap-2"><button type="button" disabled className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm opacity-35">Штучно</button><button type="button" className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white">Пачками</button></div></div>
      <div className="overflow-x-auto border-t border-[var(--border)]">
        <div className="min-w-[1000px]">
          <div className="grid grid-cols-[100px_minmax(330px,1fr)_160px_210px_220px] items-center gap-4 bg-[var(--bg)] px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"><span>Фото</span><span className="text-left">Товар</span><span>Этикетки</span><span>ШК товара</span><span>Действие</span></div>
          {PRODUCTS.map((product) => <div key={product.nmId} className="grid grid-cols-[100px_minmax(330px,1fr)_160px_210px_220px] items-center gap-4 border-t border-[var(--border)] p-4">
            <div className="flex justify-center"><div className="flex h-[112px] w-[84px] items-center justify-center overflow-hidden rounded-lg bg-white p-1">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={getWbImageUrl(product.nmId, "small")} alt="" className="h-full w-full object-contain" /></div></div>
            <div><div className="font-semibold">{product.title}</div><div className="mt-1 text-sm text-[var(--text-muted)]">{product.vendor} · WB {product.nmId}</div><div className="mt-2 text-sm text-[var(--text-muted)]">{product.marking}</div></div>
            <button type="button" className="rounded-lg py-2 text-center hover:bg-[var(--accent)]/10"><div className="text-xl font-bold">{product.count}</div><div className="text-sm text-[var(--accent)]">этикеток</div></button>
            <div className="text-center font-mono text-sm">{product.barcode}</div>
            <button type="button" className="flex min-h-[76px] flex-col items-center justify-center rounded-xl bg-[var(--accent)] px-5 text-white hover:brightness-110"><span className="flex items-center gap-2 font-semibold"><Printer size={20} />Печать</span><strong className="text-3xl leading-none">{product.count}</strong></button>
          </div>)}
        </div>
      </div>
    </section>

    {panel && <div className="fixed inset-0 z-50 flex justify-end bg-black/55" onClick={() => setPanel(null)}>
      <aside className="h-full w-full max-w-[520px] overflow-auto border-l border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3"><div><h2 className="text-xl font-bold">{STATUS_CONFIG[panel].label}</h2><p className="mt-1 text-sm text-[var(--text-muted)]">Подробности открываются только по нажатию.</p></div><button type="button" onClick={() => setPanel(null)} className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] hover:bg-[var(--bg-card-hover)]"><X size={20} /></button></div>
        <div className={`mt-5 rounded-xl border p-4 ${STATUS_CONFIG[panel].border} ${STATUS_CONFIG[panel].bg}`}><div className="font-semibold">Этикетка 566 767 77 <strong>811</strong></div><div className="mt-1 text-sm text-[var(--text-muted)]">Трусы женские · размер 46–48</div><div className="mt-3 text-sm">{panel === "accepted" ? "Код принят Wildberries." : panel === "pending" ? "Код проверяется в фоне, действий не требуется." : "WB отклонил код — товар нужно пересканировать."}</div></div>
      </aside>
    </div>}
  </main>;
}
