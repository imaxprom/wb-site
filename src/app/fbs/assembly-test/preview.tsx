"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Printer, X, ZoomIn } from "lucide-react";
import { getWbImageUrl } from "@/lib/wb-image";
import styles from "./preview.module.css";

type Product = {
  name: string;
  article: string;
  nmId: number;
  size: string;
  barcode: string;
  taskIds: string[];
  printed: number;
  total: number;
};

const PRODUCTS: Product[] = [
  {
    name: "Школьный рюкзак, чёрно-бежевый, сетка",
    article: "0048",
    nmId: 1267055950,
    size: "0",
    barcode: "2040001234567",
    taskIds: Array.from({ length: 45 }, (_, index) => String(5443435001 + index * 37)),
    printed: 45,
    total: 45,
  },
  {
    name: "Трусы женские хлопковые, комплект",
    article: "sl-8338-mc-5",
    nmId: 580062620,
    size: "44",
    barcode: "2040007654321",
    taskIds: Array.from({ length: 5 }, (_, index) => String(5443821045 + index * 53)),
    printed: 2,
    total: 5,
  },
  {
    name: "Рюкзак школьный для подростков, голубая сетка",
    article: "0051",
    nmId: 1267015841,
    size: "",
    barcode: "2040009182736",
    taskIds: ["5443900184"],
    printed: 9,
    total: 9,
  },
];

const OPTIONS = [
  { id: "balanced", label: "Вариант 1", description: "Ровная рабочая сетка" },
  { id: "cards", label: "Вариант 2", description: "Акцент на товаре" },
  { id: "table", label: "Вариант 3", description: "Компактная таблица" },
] as const;

type OptionId = typeof OPTIONS[number]["id"];

function visibleSize(size: string) {
  const normalized = size.trim().toLowerCase();
  return normalized && normalized !== "0" && normalized !== "нулевой" ? size : "";
}

function ProductImage({ product, className, onOpen }: { product: Product; className: string; onOpen: (product: Product) => void }) {
  return <button type="button" onClick={() => onOpen(product)} className="group relative shrink-0 cursor-zoom-in overflow-hidden rounded-xl bg-white outline-none ring-[var(--accent)] focus-visible:ring-2" aria-label={`Увеличить фото: ${product.name}`}>
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={getWbImageUrl(product.nmId, "medium")} alt={product.name} className={`${className} object-contain`} />
    <span className="absolute bottom-1.5 right-1.5 rounded-full bg-black/65 p-1.5 text-white opacity-0 transition group-hover:opacity-100"><ZoomIn size={14} /></span>
  </button>;
}

function SupplyLine() {
  return <div className="mb-5">
    <div className="w-full max-w-[470px]"><label className="mb-1 block text-xs text-[var(--text-muted)]">Рабочая поставка</label><select className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm" defaultValue="demo"><option value="demo">Домодедово — FBS — 07.08.2026 · 24 шт.</option></select></div>
  </div>;
}

function ModeHeader({ title }: { title: string }) {
  return <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">2. Сборка товара</h2><p className="text-sm text-[var(--text-muted)]">{title}</p></div><div className="flex gap-2"><button type="button" className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm">Штучно</button><button type="button" className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white">Пачками</button></div></div>;
}

function Article({ product }: { product: Product }) {
  return <div className="mt-2 text-xs text-[var(--text-muted)]">Артикул: <span className="font-semibold text-[var(--text)]">{product.article}</span>{visibleSize(product.size) && <span> · Размер: <strong className="text-[var(--text)]">{product.size}</strong></span>}</div>;
}

function Action({ product }: { product: Product }) {
  const complete = product.printed === product.total;
  return <div className="flex w-[190px] shrink-0 items-center justify-end">{complete ? <div className="flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 font-medium text-emerald-500"><CheckCircle2 size={18} />Готово</div> : <button type="button" className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2.5 font-medium text-white"><Printer size={18} />Напечатать все {product.total - product.printed}</button>}</div>;
}

function Tasks({ product, compact = false, onOpen }: { product: Product; compact?: boolean; onOpen: (product: Product) => void }) {
  return <div className="min-w-0"><button type="button" onClick={() => onOpen(product)} className="-m-2 rounded-lg p-2 text-left transition hover:bg-[var(--accent)]/10" aria-label={`Открыть ${product.total} этикеток WB`}><div className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">Этикеток WB</div><div className={compact ? "font-semibold" : "text-xl font-semibold"}>{product.total}</div><div className="mt-1 text-xs font-medium text-[var(--accent)]">Открыть список →</div></button><div className="mt-3 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]">ШК товара</div><div className="font-mono text-sm">{product.barcode}</div></div>;
}

function HighlightedTaskId({ value, large = false }: { value: string; large?: boolean }) {
  const prefix = value.slice(0, -4);
  const suffix = value.slice(-4);
  return <span className={`inline-flex items-baseline whitespace-nowrap font-mono font-semibold tracking-wide ${large ? "text-xl" : "text-lg"}`}><span>{prefix}</span><span className={`ml-2 font-extrabold text-[var(--accent)] ${large ? "text-2xl" : "text-xl"}`}>{suffix}</span></span>;
}

function Balanced({ onOpen, onOpenTasks }: { onOpen: (product: Product) => void; onOpenTasks: (product: Product) => void }) {
  return <><ModeHeader title="Фиксированные колонки и одинаковое положение разделителя и кнопок." /><SupplyLine /><div className="space-y-3">{PRODUCTS.map((product) => <div key={product.article} className="grid grid-cols-[92px_minmax(220px,1fr)_1px_250px_190px] items-stretch gap-4 rounded-xl border border-[var(--border)] p-4">
    <ProductImage product={product} onOpen={onOpen} className="h-[116px] w-[86px]" />
    <div className="flex min-w-0 flex-col justify-center"><div className="font-semibold leading-snug">{product.name}</div><Article product={product} /><div className="mt-3 text-sm">Напечатано <strong>{product.printed} из {product.total}</strong></div></div>
    <div className="h-full w-px bg-[var(--border)]" />
    <div className="flex items-center"><Tasks product={product} onOpen={onOpenTasks} /></div>
    <Action product={product} />
  </div>)}</div></>;
}

function Cards({ onOpen, onOpenTasks }: { onOpen: (product: Product) => void; onOpenTasks: (product: Product) => void }) {
  return <><ModeHeader title="Более крупный товарный блок и спокойная служебная колонка." /><SupplyLine /><div className="grid gap-4 xl:grid-cols-2">{PRODUCTS.map((product) => <div key={product.article} className="grid grid-cols-[108px_minmax(0,1fr)_1px_210px] grid-rows-[1fr_auto] gap-x-4 gap-y-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
    <ProductImage product={product} onOpen={onOpen} className="h-[136px] w-[102px]" />
    <div className="flex min-w-0 flex-col justify-center"><div className="text-base font-semibold leading-snug">{product.name}</div><Article product={product} /><div className="mt-3 text-sm">Этикетки: <strong>{product.printed}/{product.total}</strong></div></div>
    <div className="row-span-2 h-full w-px bg-[var(--border)]" />
    <div className="flex items-center"><Tasks product={product} compact onOpen={onOpenTasks} /></div>
    <div className="col-span-2"><Action product={product} /></div>
  </div>)}</div></>;
}

function Table({ onOpen, onOpenTasks }: { onOpen: (product: Product) => void; onOpenTasks: (product: Product) => void }) {
  return <><ModeHeader title="Максимум товаров на экране, но фотографии всё равно крупнее текущих." /><SupplyLine /><div className="overflow-hidden rounded-xl border border-[var(--border)]"><div className="grid grid-cols-[88px_minmax(260px,1fr)_1px_160px_210px_190px] items-center gap-4 bg-[var(--bg)] px-4 py-2 text-center text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)]"><span>Фото</span><span>Товар</span><span /><span>Этикетки WB</span><span>ШК товара</span><span>Действие</span></div>{PRODUCTS.map((product) => <div key={product.article} className="grid grid-cols-[88px_minmax(260px,1fr)_1px_160px_210px_190px] items-center gap-4 border-t border-[var(--border)] p-4 text-center">
    <div className="flex justify-center"><ProductImage product={product} onOpen={onOpen} className="h-[108px] w-[80px]" /></div>
    <div className="min-w-0 text-left"><div className="font-semibold leading-snug">{product.name}</div><Article product={product} /><div className="mt-2 text-xs text-[var(--text-muted)]">Напечатано {product.printed}/{product.total}</div></div>
    <div className="h-full w-px bg-[var(--border)]" />
    <button type="button" onClick={() => onOpenTasks(product)} className="w-full rounded-lg p-2 text-center transition hover:bg-[var(--accent)]/10" aria-label={`Открыть ${product.total} этикеток WB`}><div className="text-lg font-semibold">{product.total}</div><div className="text-xs font-medium text-[var(--accent)]">Открыть список →</div></button>
    <div className="text-center font-mono text-sm">{product.barcode}</div>
    <Action product={product} />
  </div>)}</div></>;
}

export function AssemblyDesignPreview() {
  const [option, setOption] = useState<OptionId>("table");
  const [fontMode, setFontMode] = useState<"current" | "accessible">("accessible");
  const [preview, setPreview] = useState<Product | null>(null);
  const [taskProduct, setTaskProduct] = useState<Product | null>(null);
  const [printConfirmation, setPrintConfirmation] = useState<{ product: Product; taskId: string; alreadyPrinted: boolean } | null>(null);
  const [reprintedTaskIds, setReprintedTaskIds] = useState<Set<string>>(new Set());
  const [printNotice, setPrintNotice] = useState("");
  useEffect(() => {
    const className = styles.accessibleFont;
    document.documentElement.classList.toggle(className, fontMode === "accessible");
    return () => document.documentElement.classList.remove(className);
  }, [fontMode]);
  useEffect(() => {
    if (!taskProduct) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setTaskProduct(null); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [taskProduct]);
  useEffect(() => {
    if (!printNotice) return;
    const timer = window.setTimeout(() => setPrintNotice(""), 3_500);
    return () => window.clearTimeout(timer);
  }, [printNotice]);

  function confirmSinglePrint() {
    if (!printConfirmation) return;
    setReprintedTaskIds((current) => new Set(current).add(printConfirmation.taskId));
    setPrintNotice(`Этикетка ${printConfirmation.taskId} отправлена на печать.`);
    setPrintConfirmation(null);
  }

  return <div className="mx-auto max-w-[1500px] space-y-5 pb-12">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="mb-2 inline-flex rounded-full bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-500">Только localhost · тестовые данные</div><h1 className="text-2xl font-bold">Три варианта этапа «Сборка»</h1><p className="mt-1 text-sm text-[var(--text-muted)]">Выберите компоновку и сравните размер текста. Никакие действия не отправляются в WB или на принтер.</p></div><Link href="/fbs" className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm">Вернуться в FBS</Link></div>
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4"><div><div className="font-semibold">Размер шрифта во всём интерфейсе</div><div className="text-sm text-[var(--text-muted)]">Увеличенный режим поднимает основной текст и доводит самые мелкие подписи примерно до 13–14 px.</div></div><div className="flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-1"><button type="button" onClick={() => setFontMode("current")} className={`rounded-md px-4 py-2 text-sm font-medium transition ${fontMode === "current" ? "bg-[var(--bg-card)] shadow-sm" : "text-[var(--text-muted)]"}`}>Текущий</button><button type="button" onClick={() => setFontMode("accessible")} className={`rounded-md px-4 py-2 text-sm font-medium transition ${fontMode === "accessible" ? "bg-[var(--accent)] text-white shadow-sm" : "text-[var(--text-muted)]"}`}>Увеличенный</button></div></div>
    <div className="grid gap-3 md:grid-cols-3">{OPTIONS.map((item) => <button key={item.id} type="button" onClick={() => setOption(item.id)} className={`rounded-xl border p-4 text-left transition ${option === item.id ? "border-[var(--accent)] bg-[var(--accent)]/10" : "border-[var(--border)] hover:bg-[var(--bg-card-hover)]"}`}><div className="font-semibold">{item.label}</div><div className="text-sm text-[var(--text-muted)]">{item.description}</div></button>)}</div>
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4 md:p-5">{option === "balanced" ? <Balanced onOpen={setPreview} onOpenTasks={setTaskProduct} /> : option === "cards" ? <Cards onOpen={setPreview} onOpenTasks={setTaskProduct} /> : <Table onOpen={setPreview} onOpenTasks={setTaskProduct} />}</section>
    {taskProduct && <div className="fixed inset-0 z-[110] bg-black/55" onClick={() => setTaskProduct(null)} role="presentation"><aside className="absolute inset-y-0 right-0 flex w-full max-w-[520px] flex-col border-l border-[var(--border)] bg-[var(--bg-card)] shadow-2xl" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Этикетки WB: ${taskProduct.total}`}>
      <div className="border-b border-[var(--border)] p-5"><div className="mb-4 flex items-start justify-between gap-4"><div><div className="text-sm font-medium text-[var(--accent)]">Этикетки WB</div><div className="mt-1 text-3xl font-bold">{taskProduct.total}</div></div><button type="button" onClick={() => setTaskProduct(null)} className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] transition hover:bg-[var(--bg-card-hover)]" aria-label="Закрыть этикетки WB"><X size={21} /></button></div><div className="flex items-center gap-4"><ProductImage product={taskProduct} onOpen={setPreview} className="h-[104px] w-[78px]" /><div className="min-w-0"><div className="font-semibold leading-snug">{taskProduct.name}</div><Article product={taskProduct} /><div className="mt-2 text-sm text-[var(--text-muted)]">Полные номера физических этикеток</div></div></div></div>
      <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"><span>Номер этикетки</span><span>{taskProduct.taskIds.length} шт.</span></div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4"><div className="space-y-2">{taskProduct.taskIds.map((id, index) => {
        const alreadyPrinted = index < taskProduct.printed;
        const reprinted = reprintedTaskIds.has(id);
        return <div key={id} className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 py-3"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/10 text-sm font-semibold text-[var(--accent)]">{index + 1}</span><span className="min-w-0 flex-1"><HighlightedTaskId value={id} /></span><div className="flex shrink-0 flex-col items-end gap-1"><span className={`text-xs ${reprinted ? "font-medium text-emerald-500" : "text-[var(--text-muted)]"}`}>{reprinted ? "Повторно отправлено" : alreadyPrinted ? "Напечатано" : "Не печаталось"}</span><button type="button" onClick={() => setPrintConfirmation({ product: taskProduct, taskId: id, alreadyPrinted })} className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-medium transition hover:border-[var(--accent)] hover:bg-[var(--accent)]/10 hover:text-[var(--accent)]" aria-label={`${alreadyPrinted ? "Повторить" : "Напечатать"} этикетку ${id}`}><Printer size={15} />{alreadyPrinted ? "Повторить" : "Печать"}</button></div></div>;
      })}</div></div>
      <div className="border-t border-[var(--border)] p-4"><button type="button" onClick={() => setTaskProduct(null)} className="w-full rounded-lg bg-[var(--accent)] px-4 py-3 font-medium text-white">Закрыть список</button></div>
    </aside></div>}
    {printConfirmation && <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/65 p-4" onClick={() => setPrintConfirmation(null)} role="presentation"><div className="w-full max-w-[440px] rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-2xl" onClick={(event) => event.stopPropagation()} role="alertdialog" aria-modal="true" aria-label="Подтверждение печати этикетки"><div className="mb-4 flex items-start justify-between gap-3"><div><div className="text-lg font-semibold">{printConfirmation.alreadyPrinted ? "Повторно напечатать этикетку?" : "Напечатать одну этикетку?"}</div><div className="mt-1 text-sm text-[var(--text-muted)]">Будет отправлена одна копия на Zebra.</div></div><button type="button" onClick={() => setPrintConfirmation(null)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border)]" aria-label="Закрыть подтверждение"><X size={19} /></button></div><div className="mb-5 rounded-xl bg-[var(--bg)] p-4"><div className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Номер этикетки</div><div className="mt-1"><HighlightedTaskId value={printConfirmation.taskId} large /></div><div className="mt-2 text-sm text-[var(--text-muted)]">{printConfirmation.product.name} · артикул {printConfirmation.product.article}</div></div><div className="grid grid-cols-2 gap-3"><button type="button" onClick={() => setPrintConfirmation(null)} className="rounded-lg border border-[var(--border)] px-4 py-3 font-medium">Отмена</button><button type="button" onClick={confirmSinglePrint} className="flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-3 font-medium text-white"><Printer size={18} />Напечатать одну</button></div></div></div>}
    {printNotice && <div className="fixed left-1/2 top-4 z-[140] -translate-x-1/2 rounded-xl border border-emerald-500/30 bg-emerald-950 px-5 py-3 text-sm font-medium text-emerald-300 shadow-2xl">{printNotice}</div>}
    {preview && <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4" onClick={() => setPreview(null)} role="dialog" aria-modal="true" aria-label="Увеличенная фотография"><div className="relative rounded-2xl bg-white p-3" onClick={(event) => event.stopPropagation()}><button type="button" onClick={() => setPreview(null)} className="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-black/70 text-white" aria-label="Закрыть"><X size={22} /></button>{/* eslint-disable-next-line @next/next/no-img-element */}<img src={getWbImageUrl(preview.nmId, "medium")} alt={preview.name} className="max-h-[86vh] max-w-[86vw] object-contain" /></div></div>}
  </div>;
}
