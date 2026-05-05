"use client";

import { Settings, Trash2, Plus } from "lucide-react";
import Link from "next/link";

interface Account {
  id: number;
  name: string;
  store_name: string | null;
  inn: string | null;
  has_api_key: boolean;
  has_wb_authorize_v3: boolean;
  has_wb_validation_key: boolean;
  auto_replies: number;
  auto_dialogs: number;
  auto_complaints: number;
}

interface ReviewAccountCardProps {
  account: Account;
  onDelete: (id: number) => void;
}

function StatusBadge({ label, active }: { label: string; active: boolean }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${active ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
      {label}
    </span>
  );
}

function StatusLine({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-[var(--text-muted)]">{label}</span>
      <span className={active ? "text-green-400" : "text-red-400"}>
        {active ? "✅" : "❌"}
      </span>
    </div>
  );
}

export function ReviewAccountCard({ account, onDelete }: ReviewAccountCardProps) {
  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5 flex flex-col gap-3 min-w-[280px]">
      {/* Header */}
      <div className="flex items-start justify-between">
        <h3 className="font-bold text-base">{account.name}</h3>
        <div className="flex items-center gap-2">
          <Link
            href={`/reviews/settings/${account.id}`}
            className="p-1.5 rounded hover:bg-[var(--bg-card-hover)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
          >
            <Settings size={16} />
          </Link>
          <button
            onClick={() => onDelete(account.id)}
            className="p-1.5 rounded hover:bg-red-500/10 text-[var(--text-muted)] hover:text-red-400 transition-colors"
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>

      {/* Info */}
      {account.store_name && (
        <p className="text-sm text-[var(--text-muted)]">{account.store_name}</p>
      )}
      {account.inn && (
        <p className="text-xs text-[var(--text-muted)]">ИНН: {account.inn}</p>
      )}

      {/* Statuses */}
      <div className="space-y-1.5 mt-1">
        <StatusLine label="API-ключ" active={account.has_api_key} />
        <StatusLine label="authorizev3" active={account.has_wb_authorize_v3} />
        <StatusLine label="wbx-validation-key" active={account.has_wb_validation_key} />
      </div>

      {/* Feature badges */}
      <div className="flex flex-wrap gap-1.5 mt-auto pt-2">
        <StatusBadge label="Автоответы" active={account.auto_replies === 1} />
        <StatusBadge label="Автодиалоги" active={account.auto_dialogs === 1} />
        <StatusBadge label="Автожалобы" active={account.auto_complaints === 1} />
      </div>
    </div>
  );
}

export function AddAccountCard({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="bg-[var(--bg-card)] rounded-xl border-2 border-dashed border-[var(--border)] p-5 flex flex-col items-center justify-center gap-3 min-w-[280px] min-h-[220px] hover:border-[var(--accent)] hover:bg-[var(--bg-card-hover)] transition-colors cursor-pointer"
    >
      <div className="w-12 h-12 rounded-full border-2 border-[var(--border)] flex items-center justify-center">
        <Plus size={24} className="text-[var(--text-muted)]" />
      </div>
      <div className="text-center">
        <p className="font-medium text-sm">Добавить аккаунт</p>
        <p className="text-xs text-[var(--text-muted)] mt-1">Подключите новый аккаунт Wildberries</p>
        <p className="text-xs text-[var(--text-muted)]">Нажмите для добавления</p>
      </div>
    </button>
  );
}
