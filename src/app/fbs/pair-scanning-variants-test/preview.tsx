"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronDown, Printer, QrCode, ScanLine } from "lucide-react";
import { getWbImageUrl } from "@/lib/wb-image";

type Variant = "spacious" | "compact";
type DemoState = "waiting" | "product" | "error";

const LABEL = "56676777811";

function HighlightedLabel() {
  return <span className="inline-flex items-baseline whitespace-nowrap font-mono font-semibold tracking-wide"><span>{LABEL.slice(0, -4)}</span><span className="ml-2 text-xl font-extrabold text-[var(--accent)]">{LABEL.slice(-4)}</span></span>;
}

function Product({ compact = false }: { compact?: boolean }) {
  return <div className={`flex items-center gap-3 rounded-xl bg-[var(--bg-card)] ${compact ? "p-2.5" : "p-3"}`}>
    <div className={`flex shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white p-1 ${compact ? "h-[92px] w-[70px]" : "h-[120px] w-[90px]"}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={getWbImageUrl(398657691, "small")} alt="Трусы женские хлопковые" className="h-full w-full object-contain" />
    </div>
    <div className="min-w-0"><div className="mb-1 inline-flex rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-500">Этикетка WB найдена</div><div className="font-semibold leading-snug">Трусы женские хлопковые, комплект 8 шт.</div><div className="mt-1 text-sm text-[var(--text-muted)]">sl-8338-mc-9 · размер 46–48</div><div className="mt-1"><HighlightedLabel /></div></div>
  </div>;
}

function Counters({ compact = false, error = false, paired = 3 }: { compact?: boolean; error?: boolean; paired?: number }) {
  const rowClass = compact ? "min-h-[58px] px-3" : "min-h-[78px] px-4";
  return <div className="grid h-full grid-rows-3 gap-2">
    <button type="button" className={`flex items-center rounded-xl bg-emerald-500/10 text-left text-emerald-500 ${rowClass}`}><strong className="w-12 text-2xl tabular-nums">0</strong><span className="text-sm font-semibold">Принято WB</span></button>
    <button type="button" className={`flex items-center rounded-xl bg-amber-500/10 text-left text-amber-500 ${rowClass}`}><strong className="w-12 text-2xl tabular-nums">{paired}</strong><span className="text-sm font-semibold">Проверяется</span></button>
    <button type="button" className={`flex items-center rounded-xl bg-red-500/10 text-left text-red-500 ${rowClass}`}><strong className="w-12 text-2xl tabular-nums">{error ? 1 : 0}</strong><span className="text-sm font-semibold">Ошибки</span></button>
  </div>;
}

function ScannerForm({ product, compact = false }: { product: boolean; compact?: boolean }) {
  return <form onSubmit={(event) => event.preventDefault()} className="flex gap-2">
    <input className={`min-w-0 flex-1 rounded-lg border-2 border-[var(--accent)]/45 bg-[var(--bg-card)] px-4 font-mono text-lg outline-none ${compact ? "py-2.5" : "py-3"}`} placeholder={product ? "Отсканируйте «Честный знак»" : "Отсканируйте этикетку WB"} />
    <button type="submit" className="flex min-w-[145px] items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 font-medium text-white"><ScanLine size={19} />Сканировать</button>
    <button type="button" aria-hidden={!product} tabIndex={product ? 0 : -1} className={`shrink-0 rounded-lg border border-[var(--border)] px-4 text-sm font-medium ${product ? "visible" : "pointer-events-none invisible"}`}>Отменить пару</button>
  </form>;
}

function SpaciousVariant({ state, paired }: { state: DemoState; paired: number }) {
  const product = state !== "waiting";
  return <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
    <div className="mb-4 flex items-center gap-2 text-lg font-semibold"><QrCode className="text-amber-500" size={23} />Маркировка при сборке</div>
    <div className="mb-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_330px]">
      <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-4"><div className="flex items-center justify-between gap-3"><div><div className="font-semibold">Пачка: 10 одинаковых товаров</div><div className="text-sm text-[var(--text-muted)]">{product ? "Этикетка найдена — ожидается «Честный знак»" : "Ожидается этикетка WB"}</div></div><div className="text-3xl font-black tabular-nums text-amber-500">{paired}<span className="text-xl text-[var(--text-muted)]">/10</span></div></div><div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--bg-card)]"><div className="h-full rounded-full bg-amber-500" style={{ width: `${paired * 10}%` }} /></div><div className="mt-3 flex h-[48px] items-center rounded-lg bg-red-500/10 px-3 font-semibold text-red-500">{paired === 9 ? "Остался 1 товар — пачка не завершена" : <span className="invisible">Место под предупреждение</span>}</div></div>
      <div className="grid grid-cols-2 gap-2"><button className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm">Тест: этикетка WB</button><button className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm">Тест: Честный знак</button><button className="col-span-2 rounded-lg border border-red-500/35 px-3 py-2 text-sm text-red-500">Тест: неправильное сканирование</button></div>
    </div>
    <div className={`mb-3 flex h-[68px] items-center rounded-xl border px-4 text-sm font-semibold ${state === "error" ? "border-red-500/40 bg-red-500/10 text-red-500" : "invisible border-transparent"}`}>Отсканирована следующая этикетка WB. Сначала нужен «Честный знак» для {LABEL}</div>
    <div className="grid h-[330px] items-stretch gap-3 lg:grid-cols-[minmax(0,1fr)_210px]">
      <div className="flex h-full flex-col overflow-hidden rounded-xl border border-[var(--accent)]/45 bg-[var(--bg)] p-4"><div className={`h-[174px] shrink-0 ${product ? "visible" : "invisible"}`}><Product /></div><div className="mt-auto"><ScannerForm product={product} /></div></div>
      <Counters error={state === "error"} paired={paired} />
    </div>
  </section>;
}

function CompactVariant({ state, paired, testOpen, setTestOpen }: { state: DemoState; paired: number; testOpen: boolean; setTestOpen: (value: boolean) => void }) {
  const product = state !== "waiting";
  return <section className="relative rounded-xl border-2 border-amber-500/40 bg-amber-500/5 p-4">
    {state === "error" && <div className="pointer-events-none absolute right-4 top-4 z-20 flex max-w-[520px] items-center gap-3 rounded-xl border border-red-500/45 bg-[var(--bg-card)] px-4 py-3 text-red-500 shadow-2xl"><AlertTriangle className="shrink-0" size={22} /><div><div className="font-semibold">Неверная последовательность</div><div className="text-sm">Сначала отсканируйте «Честный знак» для этикетки {LABEL}</div></div></div>}

    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3"><QrCode className="shrink-0 text-amber-500" size={23} /><div className="min-w-0"><div className="flex flex-wrap items-baseline gap-x-3"><h2 className="text-lg font-semibold">Маркировка при сборке</h2><span className="text-sm text-[var(--text-muted)]">Трусы · 46–48 · 10 этикеток</span></div><div className="text-sm text-[var(--text-muted)]">{product ? "Этикетка найдена — ожидается «Честный знак»" : "Ожидается этикетка WB"}</div></div></div>
      <div className="flex items-center gap-3"><button type="button" onClick={() => setTestOpen(!testOpen)} className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-medium">Тест <ChevronDown size={17} className={testOpen ? "rotate-180" : ""} /></button><div className="text-3xl font-black tabular-nums text-amber-500">{paired}<span className="text-xl text-[var(--text-muted)]">/10</span></div></div>
    </div>
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--bg-card)]"><div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${paired * 10}%` }} /></div>

    {testOpen && <div className="absolute right-4 top-[78px] z-30 grid w-[340px] grid-cols-2 gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3 shadow-2xl"><button className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm">Этикетка WB</button><button className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm">Честный знак</button><button className="col-span-2 rounded-lg border border-red-500/35 px-3 py-2 text-sm text-red-500">Неправильное сканирование</button></div>}

    <div className="mt-3 grid h-[260px] items-stretch gap-3 lg:grid-cols-[minmax(0,1fr)_210px]">
      <div className="flex h-full flex-col overflow-hidden rounded-xl border border-[var(--accent)]/45 bg-[var(--bg)] p-3"><div className={`h-[126px] shrink-0 ${product ? "visible" : "invisible"}`}><Product compact /></div><div className="mt-auto"><ScannerForm product={product} compact /></div></div>
      <Counters compact error={state === "error"} paired={paired} />
    </div>

    <div className="mt-3 flex h-[54px] items-center justify-between gap-4 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4"><div className="flex min-w-0 items-center gap-3"><div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={getWbImageUrl(398657691, "small")} alt="" className="h-full w-full object-contain" /></div><div className="truncate text-sm"><strong>Трусы 46–48</strong><span className="text-[var(--text-muted)]"> · напечатано 10/10 · спарено {paired}/10</span></div></div><div className="shrink-0 font-semibold text-amber-500">Маркировка {paired}/10</div></div>
  </section>;
}

export function PairScanningVariantsPreview() {
  const [variant, setVariant] = useState<Variant>("compact");
  const [state, setState] = useState<DemoState>("product");
  const [paired, setPaired] = useState(3);
  const [testOpen, setTestOpen] = useState(false);

  useEffect(() => {
    const existed = document.documentElement.classList.contains("fbs-readable-ui");
    document.documentElement.classList.add("fbs-readable-ui");
    return () => { if (!existed) document.documentElement.classList.remove("fbs-readable-ui"); };
  }, []);

  return <main className="mx-auto max-w-[1500px] space-y-5 pb-12">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><div className="mb-2 inline-flex rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-500">Только localhost · данные учебные</div><h1 className="text-2xl font-bold">Варианты попарного сканирования</h1><p className="mt-1 text-sm text-[var(--text-muted)]">Сравнение текущего и компактного рабочего окна. Production не изменяется.</p></div><Link href="/fbs/assembly-datamatrix-test" className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm">Полная эмуляция</Link></header>

    <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3"><div className="flex rounded-xl bg-[var(--bg)] p-1"><button type="button" onClick={() => setVariant("spacious")} className={`rounded-lg border px-5 py-2 font-medium ${variant === "spacious" ? "border-transparent bg-[var(--accent)] text-white" : "border-transparent text-[var(--text-muted)]"}`}>Вариант 1 — текущий</button><button type="button" onClick={() => setVariant("compact")} className={`rounded-lg border px-5 py-2 font-medium ${variant === "compact" ? "border-transparent bg-[var(--accent)] text-white" : "border-transparent text-[var(--text-muted)]"}`}>Вариант 2 — компактный</button></div><div className="flex flex-wrap gap-2"><button type="button" onClick={() => setState("waiting")} className={`rounded-lg border px-3 py-2 text-sm ${state === "waiting" ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--border)]"}`}>До сканирования</button><button type="button" onClick={() => setState("product")} className={`rounded-lg border px-3 py-2 text-sm ${state === "product" ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--border)]"}`}>Товар найден</button><button type="button" onClick={() => setState("error")} className={`rounded-lg border px-3 py-2 text-sm ${state === "error" ? "border-red-500 text-red-500" : "border-[var(--border)]"}`}>Показать ошибку</button><button type="button" onClick={() => setPaired((value) => value === 9 ? 0 : value + 1)} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm">Счётчик: {paired}/10</button></div></section>

    {variant === "spacious" ? <SpaciousVariant state={state} paired={paired} /> : <CompactVariant state={state} paired={paired} testOpen={testOpen} setTestOpen={setTestOpen} />}

    <section className="grid gap-3 md:grid-cols-3"><div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4"><Printer className="mb-2 text-[var(--accent)]" size={22} /><div className="font-semibold">Печать завершена</div><div className="text-sm text-[var(--text-muted)]">10 из 10 этикеток</div></div><div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4"><ScanLine className="mb-2 text-amber-500" size={22} /><div className="font-semibold">Попарно отсканировано</div><div className="text-sm text-[var(--text-muted)]">{paired} из 10 товаров</div></div><div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4"><CheckCircle2 className="mb-2 text-emerald-500" size={22} /><div className="font-semibold">Завершение</div><div className="text-sm text-[var(--text-muted)]">Доступно только после 10/10</div></div></section>
  </main>;
}
