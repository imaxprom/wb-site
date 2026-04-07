"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Search, RefreshCw } from "lucide-react";

export interface ReviewFilterValues {
  date_from: string;
  date_to: string;
  account_id: string;
  search_product: string;
  search_article: string;
  search_text: string;
  wb_review_id: string;
  rating: string;
  is_updated: string;
  is_hidden: string;
  search_buyer: string;
  buyer_chat_id: string;
  status: string;
  complaint_status: string;
  is_excluded_rating: string;
  purchase_type: string;
  search_comment: string;
}

const emptyFilters: ReviewFilterValues = {
  date_from: "",
  date_to: "",
  account_id: "",
  search_product: "",
  search_article: "",
  search_text: "",
  wb_review_id: "",
  rating: "1,2,3",
  is_updated: "",
  is_hidden: "",
  search_buyer: "",
  buyer_chat_id: "",
  status: "",
  complaint_status: "",
  is_excluded_rating: "",
  purchase_type: "",
  search_comment: "",
};

interface ReviewsFiltersProps {
  filters: ReviewFilterValues;
  onChange: (f: ReviewFilterValues) => void;
  onApply: () => void;
  onRefresh: () => void;
}

function FilterInput({ label, value, onChange, icon, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; icon?: boolean; placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-[var(--text-muted)]">{label}</label>
      <div className="relative">
        {icon && <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />}
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={`w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg py-2 text-sm text-[var(--text)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] ${icon ? "pl-8 pr-3" : "px-3"}`}
        />
      </div>
    </div>
  );
}

function FilterSelect({ label, value, onChange, options }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-[var(--text-muted)]">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

export function ReviewsFilters({ filters, onChange, onApply, onRefresh }: ReviewsFiltersProps) {
  const [collapsed, setCollapsed] = useState(true);

  const set = (key: keyof ReviewFilterValues) => (v: string) => onChange({ ...filters, [key]: v });

  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
      {/* Header */}
      <div className="flex items-center justify-end gap-2">
        <button
          onClick={onRefresh}
          className="flex items-center gap-1.5 text-sm text-[var(--text-muted)] hover:text-[var(--text)] px-3 py-1.5 border border-[var(--border)] rounded-lg transition-colors"
        >
          <RefreshCw size={14} />
          Обновить
        </button>
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex items-center gap-1 text-sm text-[var(--text-muted)] hover:text-[var(--text)] px-3 py-1.5 border border-[var(--border)] rounded-lg transition-colors"
        >
          {collapsed ? "Показать" : "Скрыть"}
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </button>
      </div>

      {!collapsed && (
        <div className="space-y-4">
          {/* Период + Магазин */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <FilterInput label="Период от" value={filters.date_from} onChange={set("date_from")} placeholder="YYYY-MM-DD" />
            <FilterInput label="Период до" value={filters.date_to} onChange={set("date_to")} placeholder="YYYY-MM-DD" />
            <FilterSelect label="Магазин" value={filters.account_id} onChange={set("account_id")} options={[
              { value: "", label: "Все магазины" },
            ]} />
          </div>

          {/* Товар */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FilterInput label="Название товара" value={filters.search_product} onChange={set("search_product")} icon placeholder="Поиск по названию..." />
            <FilterInput label="Артикул" value={filters.search_article} onChange={set("search_article")} placeholder="Артикул товара" />
          </div>

          {/* Отзыв */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <FilterInput label="Текст отзыва" value={filters.search_text} onChange={set("search_text")} icon placeholder="Поиск в отзывах..." />
            <FilterInput label="ID отзыва" value={filters.wb_review_id} onChange={set("wb_review_id")} placeholder="WB-..." />
            <div>
              <label className="text-xs text-[var(--text-muted)] mb-1 block">Оценка</label>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((r) => {
                  const selected = filters.rating.split(",").filter(Boolean).map(Number);
                  const isActive = selected.includes(r);
                  return (
                    <button
                      key={r}
                      onClick={() => {
                        const next = isActive ? selected.filter((x) => x !== r) : [...selected, r].sort();
                        set("rating")(next.join(","));
                      }}
                      className={`w-9 h-9 rounded-lg border text-xs font-medium transition-colors ${
                        isActive
                          ? "bg-[var(--accent)] border-[var(--accent)] text-white"
                          : "bg-[var(--bg)] border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)]"
                      }`}
                    >
                      {r}★
                    </button>
                  );
                })}
              </div>
            </div>
            <FilterSelect label="Отзыв дополнен" value={filters.is_updated} onChange={set("is_updated")} options={[
              { value: "", label: "Все" },
              { value: "1", label: "Да" },
              { value: "0", label: "Нет" },
            ]} />
          </div>

          {/* Покупатель */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <FilterInput label="Имя покупателя" value={filters.search_buyer} onChange={set("search_buyer")} placeholder="Имя" />
            <FilterInput label="ID чата" value={filters.buyer_chat_id} onChange={set("buyer_chat_id")} placeholder="CHAT-..." />
            <FilterSelect label="Отзыв скрыт" value={filters.is_hidden} onChange={set("is_hidden")} options={[
              { value: "", label: "Все" },
              { value: "1", label: "Да" },
              { value: "0", label: "Нет" },
            ]} />
          </div>

          {/* Статус */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <FilterSelect label="Статус отзыва" value={filters.status} onChange={set("status")} options={[
              { value: "", label: "Любой" },
              { value: "new", label: "Новый" },
              { value: "replied", label: "Отвечен" },
              { value: "processed", label: "Обработан" },
            ]} />
            <FilterSelect label="Статус жалобы" value={filters.complaint_status} onChange={set("complaint_status")} options={[
              { value: "", label: "Все" },
              { value: "submitted", label: "Подана" },
              { value: "approved", label: "Одобрена" },
              { value: "rejected", label: "Отклонена" },
            ]} />
            <FilterSelect label="Исключение из рейтинга" value={filters.is_excluded_rating} onChange={set("is_excluded_rating")} options={[
              { value: "", label: "Все" },
              { value: "1", label: "Да" },
              { value: "0", label: "Нет" },
            ]} />
            <FilterSelect label="Тип" value={filters.purchase_type} onChange={set("purchase_type")} options={[
              { value: "", label: "Все" },
              { value: "buyout", label: "Выкуплен" },
              { value: "rejected", label: "Отказ" },
              { value: "returned", label: "Возврат" },
            ]} />
          </div>

          {/* Комментарий */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FilterInput label="Поиск в комментариях" value={filters.search_comment} onChange={set("search_comment")} icon placeholder="Поиск..." />
          </div>

          {/* Apply */}
          <div className="flex justify-end">
            <button
              onClick={onApply}
              className="bg-amber-500 hover:bg-amber-600 text-black font-medium px-6 py-2.5 rounded-lg transition-colors text-sm"
            >
              Применить фильтры
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
