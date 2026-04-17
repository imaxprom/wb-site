"use client";

import { useState } from "react";
import { ArrowUpDown, ExternalLink, ChevronLeft, ChevronRight } from "lucide-react";
import { StarRating } from "./StarRating";

interface ReviewRow {
  id: number;
  date: string;
  rating: number;
  product_name: string | null;
  product_article: string | null;
  brand: string | null;
  review_text: string | null;
  pros: string | null;
  cons: string | null;
  buyer_name: string | null;
  price: number | null;
  status: string;
  complaint_status: string | null;
  store_name: string | null;
  pickup_point: string | null;
  purchase_type: string | null;
  is_excluded_rating: number;
  bables: string | null;
}

interface ReviewsTableProps {
  rows: ReviewRow[];
  total: number;
  page: number;
  perPage: number;
  sortBy: string;
  sortDir: "asc" | "desc";
  onSort: (col: string) => void;
  onPageChange: (p: number) => void;
  onStatusChange: (id: number, status: string) => void;
  onComplaint?: (id: number) => void;
  complainingId?: number | null;
}

const STATUS_LABELS: Record<string, string> = {
  new: "Новый",
  replied: "Отвечен",
  processed: "Обработан",
};

function SortHeader({ label, col, sortBy, sortDir, onSort }: {
  label: string; col: string; sortBy: string; sortDir: string; onSort: (c: string) => void;
}) {
  return (
    <th
      className="cursor-pointer select-none"
      onClick={() => onSort(col)}
    >
      <div className="flex items-center gap-1">
        {label}
        <ArrowUpDown size={12} className={sortBy === col ? "text-[var(--accent)]" : "text-[var(--text-muted)] opacity-40"} />
      </div>
    </th>
  );
}

function ComplaintCell({ reviewId, complaintStatus, complainingId, onComplaint }: {
  reviewId: number;
  complaintStatus: string | null;
  complainingId?: number | null;
  onComplaint?: (id: number) => void;
}) {
  const [showConfirm, setShowConfirm] = useState(false);

  // Pending — спиннер "Генерация..."
  if (complaintStatus === "pending" || complainingId === reviewId) {
    return (
      <span className="text-[10px] px-2 py-1 rounded border border-[var(--accent)] text-[var(--accent)] whitespace-nowrap flex items-center gap-1.5">
        <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
        Генерация...
      </span>
    );
  }

  if (complaintStatus) {
    const info = COMPLAINT_LABELS[complaintStatus];
    return (
      <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${info?.cls || "bg-[var(--border)] text-[var(--text-muted)]"}`}>
        {info?.label || complaintStatus}
      </span>
    );
  }

  if (!onComplaint) return null;

  return (
    <>
      <button
        onClick={() => setShowConfirm(true)}
        className="text-[10px] px-2 py-1 rounded border border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors whitespace-nowrap"
      >
        Жалоба
      </button>
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setShowConfirm(false)}>
          <div
            className="rounded-xl p-4"
            style={{ backgroundColor: "var(--bg-card)", border: "1px solid var(--accent)", boxShadow: "0 0 30px rgba(99, 102, 241, 0.2)", width: "320px", maxWidth: "90vw" }}
            onClick={(e) => e.stopPropagation()}
          >
            <p style={{ fontSize: "13px", fontWeight: 500, marginBottom: "8px" }}>Подать жалобу?</p>
            <p style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "12px", lineHeight: 1.5, wordWrap: "break-word", whiteSpace: "normal" }}>
              ИИ сгенерирует текст обращения и отправит жалобу в Wildberries.
            </p>
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={() => { setShowConfirm(false); onComplaint(reviewId); }}
                className="text-[10px] px-2.5 py-1 rounded-lg bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] transition-colors"
              >
                Да, подать
              </button>
              <button
                onClick={() => setShowConfirm(false)}
                className="text-[10px] px-2.5 py-1 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const COMPLAINT_LABELS: Record<string, { label: string; cls: string }> = {
  submitted: { label: "Подана", cls: "bg-blue-500/20 text-blue-400" },
  approved: { label: "Одобрена", cls: "bg-green-500/20 text-green-400" },
  rejected: { label: "Отклонена", cls: "bg-red-500/20 text-red-400" },
  error: { label: "Ошибка", cls: "bg-amber-500/20 text-amber-400" },
};

export function ReviewsTable({ rows, total, page, perPage, sortBy, sortDir, onSort, onPageChange, onStatusChange, onComplaint, complainingId }: ReviewsTableProps) {
  const totalPages = Math.max(1, Math.ceil(total / perPage));


  function formatDate(d: string) {
    if (!d) return "—";
    const date = new Date(d);
    return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
  }

  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)]">
      <div className="data-table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <SortHeader label="Дата" col="date" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
              <SortHeader label="Оценка" col="rating" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
              <th>Товар</th>
              <th>Отзыв</th>
              <SortHeader label="Покупатель" col="buyer_name" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
              <SortHeader label="Цена" col="price" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
              <SortHeader label="Статус" col="status" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
              <SortHeader label="Пункт выдачи" col="pickup_point" sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
              <th>Жалоба</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center py-8 text-[var(--text-muted)]">
                  Нет отзывов
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap">{formatDate(r.date)}</td>
                <td><StarRating rating={r.rating} size={14} /></td>
                <td className="max-w-[200px]">
                  <div className="space-y-0.5">
                    <div className="font-medium text-sm truncate">{r.product_name || "—"}</div>
                    {r.brand && <div className="text-xs text-[var(--text-muted)]">{r.brand}</div>}
                    {r.product_article && (
                      <a
                        href={`https://www.wildberries.ru/catalog/${r.product_article}/detail.aspx`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-[var(--accent)] hover:underline flex items-center gap-0.5"
                      >
                        {r.product_article} <ExternalLink size={10} />
                      </a>
                    )}
                  </div>
                </td>
                <td className="max-w-[320px]">
                  <div className="space-y-1.5">
                    {/* Status badges */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {r.purchase_type === "buyout" && (
                        <span className="text-[10px] bg-green-500/20 text-green-400 px-1.5 py-0.5 rounded font-medium">Выкуплен</span>
                      )}
                      {r.purchase_type === "rejected" && (
                        <span className="text-[10px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded font-medium">Отказ</span>
                      )}
                      {r.purchase_type === "returned" && (
                        <span className="text-[10px] bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded font-medium">Возврат</span>
                      )}
                      {r.is_excluded_rating === 1 && (
                        <span className="text-[10px] bg-[var(--border)] text-[var(--text-muted)] px-1.5 py-0.5 rounded font-medium">Исключён из рейтинга</span>
                      )}
                    </div>
                    {/* Review text */}
                    {r.review_text && (
                      <div className="text-sm whitespace-normal line-clamp-2">{r.review_text}</div>
                    )}
                    {/* Pros */}
                    {r.pros && (
                      <div className="text-xs whitespace-normal">
                        <span className="text-green-400 font-medium">+</span> <span className="text-[var(--text-muted)]">{r.pros}</span>
                      </div>
                    )}
                    {/* Cons */}
                    {r.cons && (
                      <div className="text-xs whitespace-normal">
                        <span className="text-red-400 font-medium">−</span> <span className="text-[var(--text-muted)]">{r.cons}</span>
                      </div>
                    )}
                    {/* Bables (tags) */}
                    {r.bables && (() => {
                      try {
                        const tags: string[] = JSON.parse(r.bables);
                        if (!tags.length) return null;
                        return (
                          <div className="flex flex-wrap gap-1">
                            {tags.map((tag, i) => (
                              <span key={i} className="text-[10px] bg-green-500/10 text-green-400 px-1.5 py-0.5 rounded">{tag}</span>
                            ))}
                          </div>
                        );
                      } catch { return null; }
                    })()}
                    {/* No content */}
                    {!r.review_text && !r.pros && !r.cons && !r.bables && (
                      <span className="text-sm text-[var(--text-muted)]">—</span>
                    )}
                  </div>
                </td>
                <td className="text-sm">{r.buyer_name || "—"}</td>
                <td className="num text-sm whitespace-nowrap">
                  {r.price ? `${r.price.toLocaleString("ru-RU")} ₽` : "—"}
                </td>
                <td>
                  <select
                    value={r.status}
                    onChange={(e) => onStatusChange(r.id, e.target.value)}
                    className="bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1 text-xs text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                  >
                    {Object.entries(STATUS_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </td>
                <td className="text-sm max-w-[140px] truncate">{r.pickup_point || "—"}</td>
                <td>
                  <ComplaintCell
                    reviewId={r.id}
                    complaintStatus={r.complaint_status}
                    complainingId={complainingId}
                    onComplaint={onComplaint}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {total > perPage && (
        <div className="flex items-center justify-between px-5 py-3 border-t border-[var(--border)]">
          <span className="text-sm text-[var(--text-muted)]">
            {((page - 1) * perPage) + 1}–{Math.min(page * perPage, total)} из {total}
          </span>
          <div className="flex items-center gap-2">
            <button
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              className="p-1.5 rounded hover:bg-[var(--bg-card-hover)] disabled:opacity-30 transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-sm">
              {page} / {totalPages}
            </span>
            <button
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              className="p-1.5 rounded hover:bg-[var(--bg-card-hover)] disabled:opacity-30 transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
