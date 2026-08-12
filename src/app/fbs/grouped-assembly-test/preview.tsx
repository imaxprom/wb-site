"use client";

import { useEffect, useMemo } from "react";
import Link from "next/link";
import { Backpack, CheckCircle2, Package, Printer, QrCode } from "lucide-react";
import { getWbImageUrl } from "@/lib/wb-image";
import { REAL_NEW_ORDERS_SNAPSHOT, type RealSnapshotProduct } from "./real-snapshot";

type Category = "backpack" | "underwear" | "other";
type Product = RealSnapshotProduct;

function sizeNumber(size: string) {
  const match = size.match(/\d+/);
  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
}

function formatArticle(value: string) {
  if (!/^\d{13}$/.test(value)) return value;
  return `${value.slice(0, 3)} ${value.slice(3, 6)} ${value.slice(6, 9)} ${value.slice(9, 11)} ${value.slice(11)}`;
}

function ProductImage({ product }: { product: Product }) {
  return <div className="flex justify-center rounded-lg bg-white p-1">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={getWbImageUrl(product.nmId, "medium")} alt={product.name} className="h-[104px] w-[78px] object-contain" />
  </div>;
}

function Action({ product }: { product: Product }) {
  if (product.printed === product.total) return <div className="flex min-h-[82px] w-full items-center justify-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 font-semibold text-emerald-500"><CheckCircle2 size={19} />Готово</div>;
  return <button type="button" className="group flex min-h-[82px] w-full flex-col items-center justify-center gap-1 rounded-xl bg-[var(--accent)] px-5 py-2 text-white transition hover:brightness-110"><span className="flex items-center gap-2 font-semibold"><Printer size={21} />Печать</span><span className="text-3xl font-black leading-none">{product.total - product.printed}</span></button>;
}

function TableHeader() {
  return <div className="grid grid-cols-[88px_minmax(290px,1fr)_1px_150px_220px_210px] items-center gap-4 bg-[var(--bg)] px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"><span>Фото</span><span>Товар</span><span /><span>Этикетки</span><span>ШК товара</span><span>Действие</span></div>;
}

function ProductRow({ product }: { product: Product }) {
  const visibleSize = product.size && product.size !== "0" ? product.size : "";
  return <div className="grid grid-cols-[88px_minmax(290px,1fr)_1px_150px_220px_210px] items-center gap-4 border-t border-[var(--border)] px-4 py-3 text-center">
    <ProductImage product={product} />
    <div className="min-w-0 text-left"><div className="font-semibold leading-snug">{product.name}</div><div className="mt-2 text-sm text-[var(--text-muted)]">Артикул: <strong className="text-[var(--text)]">{formatArticle(product.article)}</strong>{visibleSize && <span> · Размер: <strong className="text-[var(--text)]">{visibleSize}</strong></span>}</div><div className="mt-1 text-xs text-[var(--text-muted)]">Напечатано {product.printed}/{product.total}</div></div>
    <div className="h-full w-px bg-[var(--border)]" />
    <button type="button" className="rounded-lg p-2 transition hover:bg-[var(--accent)]/10"><div className="text-xl font-bold">{product.total}</div><div className="text-xs font-medium text-[var(--accent)]">Открыть список →</div></button>
    <div className="font-mono text-sm">{product.barcode || "не получен"}</div>
    <Action product={product} />
  </div>;
}

function CategoryHeader({ type, count }: { type: Category; count: number }) {
  const config = type === "backpack"
    ? { title: "Рюкзаки", subtitle: "Маркировка не требуется", color: "sky", icon: <Backpack size={24} /> }
    : type === "underwear"
      ? { title: "Трусы", subtitle: "Честный знак обязателен", color: "amber", icon: <QrCode size={24} /> }
      : { title: "Другие товары", subtitle: "Категория определяется отдельно", color: "slate", icon: <Package size={24} /> };
  const headerColor = config.color === "sky" ? "bg-sky-500/10 text-sky-500" : config.color === "amber" ? "bg-amber-500/10 text-amber-500" : "bg-slate-500/10 text-slate-400";
  return <div className={`flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-4 ${headerColor}`}><div className="flex items-center gap-3">{config.icon}<div><div className="text-lg font-bold text-[var(--text)]">{config.title}</div><div className="text-sm text-[var(--text-muted)]">{config.subtitle}</div></div></div><div className="rounded-full bg-current/10 px-3 py-1 text-sm font-semibold">{count} заказов</div></div>;
}

export function GroupedAssemblyPreview() {
  useEffect(() => {
    const existed = document.documentElement.classList.contains("fbs-readable-ui");
    document.documentElement.classList.add("fbs-readable-ui");
    return () => { if (!existed) document.documentElement.classList.remove("fbs-readable-ui"); };
  }, []);

  const products = REAL_NEW_ORDERS_SNAPSHOT.products;
  const categories = useMemo(() => (["backpack", "underwear", "other"] as Category[]).map((category) => {
    const rows = products.filter((product) => product.category === category);
    const articleGroups = new Map<number, Product[]>();
    for (const product of rows) articleGroups.set(product.nmId, [...(articleGroups.get(product.nmId) || []), product]);
    return {
      category,
      count: rows.reduce((sum, product) => sum + product.total, 0),
      articles: [...articleGroups.entries()]
        .sort(([left], [right]) => left - right)
        .map(([wbArticle, articleProducts]) => ({ wbArticle, products: articleProducts.sort((a, b) => sizeNumber(a.size) - sizeNumber(b.size)) })),
    };
  }).filter((group) => group.count > 0), [products]);

  const timestamp = new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(REAL_NEW_ORDERS_SNAPSHOT.fetchedAt));

  return <main className="mx-auto max-w-[1500px] space-y-5 pb-12">
    <header className="flex flex-wrap items-start justify-between gap-4"><div><div className="mb-2 inline-flex rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-500">Только localhost · реальный снимок основного юрлица</div><h1 className="text-2xl font-bold">Группировка текущих новых заказов</h1><p className="mt-1 text-sm text-[var(--text-muted)]">Снимок на {timestamp}. Запросы в WB и изменения заказов не выполняются.</p></div><Link href="/fbs/assembly-test" className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm">Предыдущий макет</Link></header>

    <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">2. Сборка товара</h2><p className="text-sm text-[var(--text-muted)]">Новые заказы: {REAL_NEW_ORDERS_SNAPSHOT.orderCount}. Одинаковые товары уже объединены в пачки.</p></div><div className="flex gap-2"><button type="button" disabled className="cursor-not-allowed rounded-lg border border-[var(--border)] px-4 py-2 text-sm opacity-40">Штучно</button><button type="button" className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white">Пачками</button></div></div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]"><div className="min-w-[1120px]">
        <TableHeader />
        {categories.map((group) => <div key={group.category}>
          <CategoryHeader type={group.category} count={group.count} />
          {group.articles.map((articleGroup) => <div key={articleGroup.wbArticle}>
            {(group.category === "underwear" || articleGroup.products.length > 1) && <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--bg)]/65 px-5 py-3"><div><span className="text-sm text-[var(--text-muted)]">Артикул WB</span> <strong>{articleGroup.wbArticle}</strong></div><div className="text-sm text-[var(--text-muted)]">{articleGroup.products.length} размеров · {articleGroup.products.reduce((sum, product) => sum + product.total, 0)} этикеток</div></div>}
            {articleGroup.products.map((product) => <ProductRow key={`${product.article}:${product.nmId}:${product.size}:${product.barcode}`} product={product} />)}
          </div>)}
        </div>)}
      </div></div>
    </section>
  </main>;
}
