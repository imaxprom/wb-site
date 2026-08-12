"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

export type FbsPickSheetOrder = {
  order_id: number;
  nm_id: number;
  chrt_id: number;
  vendor_code: string;
  product_name: string;
  size_name: string;
  skus: string[];
  required_meta: string[];
  raw_json: Record<string, unknown>;
};

type PickCategory = "underwear" | "backpacks" | "other";
type PickRow = {
  key: string;
  category: PickCategory;
  article: string;
  productName: string;
  size: string;
  sku: string;
  nmId: number;
  quantity: number;
};

const CATEGORY_META: Record<PickCategory, { title: string; note: string }> = {
  underwear: { title: "Трусы", note: "" },
  backpacks: { title: "Рюкзаки", note: "Технический размер «0» не показывается" },
  other: { title: "Другие товары", note: "Товары, не относящиеся к трусам или рюкзакам" },
};

function visibleSize(value: string) {
  const size = String(value || "").trim();
  const normalized = size.toLowerCase();
  return normalized && normalized !== "0" && normalized !== "нулевой" ? size : "";
}

function rawText(raw: Record<string, unknown>, key: string) {
  const value = raw?.[key];
  return typeof value === "string" ? value : "";
}

function categoryFor(order: FbsPickSheetOrder): PickCategory {
  const text = [
    order.product_name,
    order.vendor_code,
    rawText(order.raw_json, "subject"),
    rawText(order.raw_json, "subjectName"),
    rawText(order.raw_json, "object"),
    rawText(order.raw_json, "objectName"),
  ].join(" ").toLowerCase();
  if (/трус|слип|боксер|underwear/.test(text)) return "underwear";
  if (/рюкзак|backpack/.test(text)) return "backpacks";
  if (visibleSize(order.size_name) && order.required_meta?.includes("sgtin")) return "underwear";
  if (!visibleSize(order.size_name)) return "backpacks";
  return "other";
}

function sizeNumber(value: string) {
  const match = value.match(/\d+/);
  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
}

function buildRows(orders: FbsPickSheetOrder[]) {
  const grouped = new Map<string, PickRow>();
  for (const order of orders) {
    const category = categoryFor(order);
    const size = category === "backpacks" ? "" : visibleSize(order.size_name);
    const sku = String(order.skus?.[0] || "").trim();
    const article = String(order.vendor_code || "").trim() || `WB ${order.nm_id}`;
    const key = `${category}:${order.nm_id}:${order.chrt_id}:${sku}:${size}`;
    const current = grouped.get(key);
    if (current) {
      current.quantity += 1;
      continue;
    }
    grouped.set(key, {
      key,
      category,
      article,
      productName: String(order.product_name || "").trim(),
      size,
      sku,
      nmId: Number(order.nm_id),
      quantity: 1,
    });
  }
  return Array.from(grouped.values()).sort((a, b) => {
    const articleCompare = a.article.localeCompare(b.article, "ru", { numeric: true });
    if (articleCompare) return articleCompare;
    const sizeCompare = sizeNumber(a.size) - sizeNumber(b.size);
    if (sizeCompare) return sizeCompare;
    return a.size.localeCompare(b.size, "ru", { numeric: true });
  });
}

function formatCreatedAt(value: number) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export default function FbsPickSheet({ orders, createdAt }: { orders: FbsPickSheetOrder[]; createdAt: number }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const rows = useMemo(() => buildRows(orders), [orders]);
  const sections = useMemo(() => (["underwear", "backpacks", "other"] as PickCategory[])
    .map((category) => ({ category, rows: rows.filter((row) => row.category === category) }))
    .filter((section) => section.rows.length > 0), [rows]);
  let rowNumber = 0;
  if (!mounted) return null;

  return createPortal(<div className="fbs-pick-sheet-print" aria-hidden="true">
    <style>{`
      @media screen { .fbs-pick-sheet-print { display: none !important; } }
      @media print {
        @page { size: A4 landscape; margin: 10mm 11mm 9mm; }
        html.fbs-pick-sheet-printing body > *:not(.fbs-pick-sheet-print) { display: none !important; }
        html.fbs-pick-sheet-printing body * { visibility: hidden !important; }
        html.fbs-pick-sheet-printing .fbs-pick-sheet-print,
        html.fbs-pick-sheet-printing .fbs-pick-sheet-print * { visibility: visible !important; }
        html.fbs-pick-sheet-printing .fbs-pick-sheet-print {
          display: block !important;
          position: absolute;
          left: 0;
          top: 0;
          width: 100%;
          margin: 0;
          padding: 0;
          color: #172033;
          background: #fff;
          font-family: "Segoe UI", Arial, sans-serif;
          font-size: 10.5pt;
          line-height: 1.2;
          print-color-adjust: exact;
          -webkit-print-color-adjust: exact;
        }
        .fbs-pick-header {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 14mm;
          align-items: start;
          padding-bottom: 3mm;
          border-bottom: 3px solid #4f46e5;
        }
        .fbs-pick-title { margin: 0; color: #111827; font-size: 23pt; line-height: 1.05; }
        .fbs-pick-summary {
          display: grid;
          grid-template-columns: repeat(2, auto);
          overflow: hidden;
          border: 1px solid #cbd5e1;
          border-radius: 8px;
          background: #f8fafc;
        }
        .fbs-pick-summary > div { min-width: 34mm; padding: 2mm 4mm; border-left: 1px solid #dbe1ea; }
        .fbs-pick-summary > div:first-child { border-left: 0; }
        .fbs-pick-summary span { display: block; color: #64748b; font-size: 8.5pt; }
        .fbs-pick-summary strong { display: block; margin-top: .5mm; color: #312e81; font-size: 16pt; }
        .fbs-pick-section { margin-top: 3mm; }
        .fbs-pick-section + .fbs-pick-section { break-before: page; margin-top: 0; }
        .fbs-pick-section-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 1.5mm; }
        .fbs-pick-section h2 { margin: 0; color: #111827; font-size: 16pt; }
        .fbs-pick-note { color: #64748b; font-size: 9pt; }
        .fbs-pick-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        .fbs-pick-table thead { display: table-header-group; }
        .fbs-pick-table tr { break-inside: avoid; }
        .fbs-pick-table th {
          height: 6.5mm;
          padding: 1mm 2mm;
          border: 1px solid #94a3b8;
          color: #1e293b;
          background: #e7eafe;
          font-size: 8.7pt;
          font-weight: 800;
          text-align: left;
          text-transform: uppercase;
          letter-spacing: .02em;
        }
        .fbs-pick-table td {
          min-height: 5.4mm;
          padding: .55mm 2mm;
          border: 1px solid #cbd5e1;
          vertical-align: middle;
          background: #fff;
        }
        .fbs-pick-table tbody tr:nth-child(even) td { background: #f8fafc; }
        .fbs-pick-no { width: 4.5%; text-align: center !important; }
        .fbs-pick-article { width: 28.5%; font-weight: 750; }
        .fbs-pick-size { width: 13%; }
        .fbs-pick-sku { width: 19%; text-align: center !important; }
        .fbs-pick-wb { width: 13%; text-align: center !important; }
        .fbs-pick-qty { width: 8%; text-align: center !important; }
        .fbs-pick-done { width: 14%; text-align: center !important; }
        .fbs-pick-article-start td { border-top: 3px solid #475569; }
        .fbs-pick-mono { font-family: "SFMono-Regular", Consolas, monospace; font-variant-numeric: tabular-nums; }
        .fbs-pick-quantity { color: #111827; font-size: 13pt; font-weight: 850; text-align: center; }
        .fbs-pick-check { text-align: center; }
        .fbs-pick-checkbox { display: inline-block; width: 5.5mm; height: 5.5mm; border: 1.6px solid #334155; border-radius: 1px; vertical-align: middle; }
        .fbs-pick-total td { color: #14532d; background: #dcfce7 !important; font-weight: 850; }
      }
    `}</style>
    <header className="fbs-pick-header">
      <div>
        <h1 className="fbs-pick-title">Лист подбора FBS · {formatCreatedAt(createdAt)}</h1>
      </div>
      <div className="fbs-pick-summary">
        <div><span>Позиций</span><strong>{rows.length}</strong></div>
        <div><span>Товаров</span><strong>{orders.length}</strong></div>
      </div>
    </header>
    {sections.map((section) => {
      const total = section.rows.reduce((sum, row) => sum + row.quantity, 0);
      return <section key={section.category} className="fbs-pick-section">
        <div className="fbs-pick-section-head">
          <h2>{CATEGORY_META[section.category].title} · {total} шт.</h2>
          {CATEGORY_META[section.category].note && <div className="fbs-pick-note">{CATEGORY_META[section.category].note}</div>}
        </div>
        <table className="fbs-pick-table">
          <thead><tr><th className="fbs-pick-no">№</th><th className="fbs-pick-article">Артикул продавца</th><th className="fbs-pick-sku">ШК товара</th><th className="fbs-pick-wb">Артикул WB</th><th className="fbs-pick-size">Размер</th><th className="fbs-pick-qty">Нужно</th><th className="fbs-pick-done">Собрано</th></tr></thead>
          <tbody>
            {section.rows.map((row, index) => {
              rowNumber += 1;
              const previousRow = section.rows[index - 1];
              const startsUnderwearArticle = section.category === "underwear"
                && index > 0
                && (previousRow.article !== row.article || previousRow.nmId !== row.nmId);
              return <tr key={row.key} className={startsUnderwearArticle ? "fbs-pick-article-start" : undefined}>
                <td className="fbs-pick-no">{rowNumber}</td>
                <td className="fbs-pick-article">{row.article}</td>
                <td className="fbs-pick-sku fbs-pick-mono">{row.sku || "—"}</td>
                <td className="fbs-pick-wb fbs-pick-mono">{row.nmId}</td>
                <td className="fbs-pick-size">{row.size || "—"}</td>
                <td className="fbs-pick-quantity">{row.quantity}</td>
                <td className="fbs-pick-check"><span className="fbs-pick-checkbox" /></td>
              </tr>;
            })}
            <tr className="fbs-pick-total"><td colSpan={5}>Итого по разделу</td><td className="fbs-pick-quantity">{total}</td><td></td></tr>
          </tbody>
        </table>
      </section>;
    })}
  </div>, document.body);
}
