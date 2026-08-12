"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ChevronRight,
  Loader2,
  Printer,
  QrCode,
  X,
} from "lucide-react";
import { getWbImageUrl } from "@/lib/wb-image";

type Example = "clean" | "pending" | "error";
type Stage = "assembly" | "marking";

const EXAMPLES: Record<Example, { title: string; accepted: number; pending: number; errors: number }> = {
  clean: { title: "Обычная работа", accepted: 14, pending: 0, errors: 0 },
  pending: { title: "Идёт проверка", accepted: 11, pending: 3, errors: 0 },
  error: { title: "Есть ошибка", accepted: 12, pending: 1, errors: 1 },
};

const PRODUCTS = [
  { nmId: 1267055950, title: "Рюкзак школьный с сеткой", vendor: "R-4058-black", count: 8, marking: false },
  { nmId: 398657691, title: "Трусы женские хлопковые, комплект", vendor: "sl-8338-mc-9", count: 10, marking: true },
];

function ProductRow({ product }: { product: (typeof PRODUCTS)[number] }) {
  return <div className="grid min-w-[980px] grid-cols-[100px_minmax(320px,1fr)_160px_210px_220px] items-center gap-4 border-t border-[var(--border)] p-4">
    <div className="flex justify-center">
      <div className="flex h-[112px] w-[84px] items-center justify-center overflow-hidden rounded-lg bg-white p-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={getWbImageUrl(product.nmId, "small")} alt="" className="h-full w-full object-contain" />
      </div>
    </div>
    <div className="min-w-0">
      <div className="font-semibold leading-snug">{product.title}</div>
      <div className="mt-1 text-sm text-[var(--text-muted)]">Артикул: {product.vendor} · WB {product.nmId}</div>
      <div className="mt-2 text-sm text-[var(--text-muted)]">{product.marking ? "Честный знак обязателен" : "Маркировка не требуется"}</div>
    </div>
    <button type="button" className="rounded-lg px-3 py-2 text-center transition hover:bg-[var(--accent)]/10">
      <div className="text-xl font-bold">{product.count}</div>
      <div className="text-sm text-[var(--accent)]">этикеток</div>
    </button>
    <div className="text-center font-mono text-sm">204 377 581 4661</div>
    <button type="button" className="flex min-h-[76px] flex-col items-center justify-center rounded-xl bg-[var(--accent)] px-5 text-white transition hover:brightness-110">
      <span className="flex items-center gap-2 font-semibold"><Printer size={20} /> Печать</span>
      <strong className="text-3xl leading-none">{product.count}</strong>
    </button>
  </div>;
}

export function AssemblyStatusCompactPreview() {
  const [example, setExample] = useState<Example>("pending");
  const [stage, setStage] = useState<Stage>("assembly");
  const [panel, setPanel] = useState<"pending" | "errors" | null>(null);
  const status = EXAMPLES[example];

  useEffect(() => {
    const existed = document.documentElement.classList.contains("fbs-readable-ui");
    document.documentElement.classList.add("fbs-readable-ui");
    return () => { if (!existed) document.documentElement.classList.remove("fbs-readable-ui"); };
  }, []);

  useEffect(() => setPanel(null), [example, stage]);

  const stageCounts = useMemo(() => ({ accepted: status.accepted, total: status.accepted + status.pending + status.errors }), [status]);

  return <main className="mx-auto max-w-[1500px] space-y-5 pb-12">
    <header>
      <div className="mb-2 inline-flex rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-500">Только localhost · данные учебные</div>
      <h1 className="text-2xl font-bold">Компактные статусы проверки</h1>
      <p className="mt-1 text-sm text-[var(--text-muted)]">На прод ничего не изменено. Переключайте примеры и этапы, чтобы сравнить интерфейс.</p>
    </header>

    <section className="grid gap-2 sm:grid-cols-3">
      {(Object.entries(EXAMPLES) as Array<[Example, (typeof EXAMPLES)[Example]]>).map(([key, item]) => <button
        key={key}
        type="button"
        onClick={() => { setExample(key); setStage("assembly"); }}
        className={`rounded-xl border px-4 py-3 text-left transition ${example === key ? "border-[var(--accent)] bg-[var(--accent)]/10" : "border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)]"}`}
      >
        <div className="font-semibold">{item.title}</div>
        <div className="mt-1 text-sm text-[var(--text-muted)]">Принято {item.accepted} · проверяется {item.pending} · ошибок {item.errors}</div>
      </button>)}
    </section>

    <section className="grid gap-2 md:grid-cols-4">
      <button type="button" className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 text-left"><div className="font-semibold">1. Новые заказы</div><div className="text-sm text-[var(--text-muted)]">0 новых</div></button>
      <button type="button" onClick={() => setStage("assembly")} className={`rounded-xl border px-4 py-3 text-left transition ${stage === "assembly" ? "border-[var(--accent)] bg-[var(--accent)]/10" : "border-[var(--border)] bg-[var(--bg-card)]"}`}><div className="font-semibold">2. Сборка</div><div className="text-sm text-[var(--text-muted)]">18 товаров</div></button>
      <button type="button" onClick={() => setStage("marking")} className={`rounded-xl border px-4 py-3 text-left transition ${stage === "marking" ? "border-[var(--accent)] bg-[var(--accent)]/10" : "border-[var(--border)] bg-[var(--bg-card)]"}`}><div className="font-semibold">3. Маркировка</div><div className="text-sm text-[var(--text-muted)]">{stageCounts.accepted}/{stageCounts.total} принято WB</div></button>
      <button type="button" className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 text-left"><div className="font-semibold">4. Отгрузка</div><div className="text-sm text-[var(--text-muted)]">ожидает</div></button>
    </section>

    <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <div className="flex w-full max-w-[760px] items-center gap-3"><label className="shrink-0 text-sm text-[var(--text-muted)]">Поставка</label><select className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2" defaultValue="demo"><option value="demo">Домодедово — FBS — 12.08.2026 · 18 шт.</option></select></div>
    </section>

    {stage === "assembly" ? <section className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-card)]">
      <div className="flex min-h-[52px] flex-wrap items-center justify-between gap-2 px-4 py-2">
        <h2 className="text-lg font-semibold">2. Сборка товара</h2>
        <div className="flex items-center gap-2">
          {status.pending > 0 && <button type="button" onClick={() => setPanel("pending")} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-amber-500/10 px-2.5 text-sm font-semibold text-amber-500 transition hover:bg-amber-500/20"><Loader2 size={15} className="animate-spin" />Проверяется: {status.pending}</button>}
          {status.errors > 0 && <button type="button" onClick={() => setPanel("errors")} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-red-500/10 px-2.5 text-sm font-semibold text-red-500 transition hover:bg-red-500/20"><AlertTriangle size={15} />Ошибка: {status.errors}</button>}
        </div>
      </div>

      <div className="overflow-x-auto border-t border-[var(--border)]">
        <div className="min-w-[980px]"><div className="grid grid-cols-[100px_minmax(320px,1fr)_160px_210px_220px] gap-4 bg-[var(--bg)] px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"><span>Фото</span><span className="text-left">Товар</span><span>Этикетки</span><span>ШК товара</span><span>Действие</span></div>{PRODUCTS.map((product) => <ProductRow key={product.nmId} product={product} />)}</div>
      </div>
    </section> : <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <div><h2 className="text-lg font-semibold">3. Маркировка</h2><p className="mt-1 text-sm text-[var(--text-muted)]">Здесь хранится полная сводка проверки — она не мешает сборке.</p></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <button type="button" className="flex min-h-[78px] items-center rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 text-left"><strong className="w-16 text-3xl text-emerald-500">{status.accepted}</strong><span className="font-semibold">Принято WB</span></button>
        <button type="button" onClick={() => setPanel("pending")} className="flex min-h-[78px] items-center rounded-xl border border-amber-500/25 bg-amber-500/10 px-4 text-left"><strong className="w-16 text-3xl text-amber-500">{status.pending}</strong><span className="font-semibold">Проверяется</span></button>
        <button type="button" onClick={() => setPanel("errors")} className="flex min-h-[78px] items-center rounded-xl border border-red-500/25 bg-red-500/10 px-4 text-left"><strong className="w-16 text-3xl text-red-500">{status.errors}</strong><span className="font-semibold">Ошибки</span></button>
      </div>
      <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4"><div className="flex items-center gap-3"><QrCode className="text-[var(--accent)]" /><div><div className="font-semibold">Проверка маркировки поставки</div><div className="text-sm text-[var(--text-muted)]">Перед отгрузкой система не пропустит товар с ошибкой или незавершённой проверкой.</div></div></div></div>
    </section>}

    {panel && <div className="fixed inset-0 z-50 flex justify-end bg-black/55" onClick={() => setPanel(null)}>
      <aside className="h-full w-full max-w-[520px] overflow-auto border-l border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-3"><div><h3 className="text-xl font-bold">{panel === "errors" ? "Ошибка проверки" : "Проверяется WB"}</h3><p className="mt-1 text-sm text-[var(--text-muted)]">Только позиции, относящиеся к выбранному статусу.</p></div><button type="button" onClick={() => setPanel(null)} className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] hover:bg-[var(--bg-card-hover)]"><X size={20} /></button></div>
        <div className={`mt-5 rounded-xl border p-4 ${panel === "errors" ? "border-red-500/35 bg-red-500/10" : "border-amber-500/35 bg-amber-500/10"}`}>
          <div className="flex items-center gap-3">{panel === "errors" ? <AlertTriangle className="text-red-500" /> : <Loader2 className="animate-spin text-amber-500" />}<div><div className="font-semibold">Этикетка 566 767 77 <strong>811</strong></div><div className="mt-1 text-sm text-[var(--text-muted)]">Трусы женские · размер 46–48</div></div></div>
          <div className="mt-3 text-sm">{panel === "errors" ? "WB отклонил код. Найдите товар и пересканируйте Честный знак." : "Код отправлен в WB. Сотруднику ничего делать не нужно."}</div>
        </div>
        {panel === "errors" && <button type="button" className="mt-4 flex w-full items-center justify-between rounded-lg bg-red-500 px-4 py-3 font-semibold text-white">Перейти к исправлению <ChevronRight size={19} /></button>}
      </aside>
    </div>}
  </main>;
}
