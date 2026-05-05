"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { ReviewAccountCard, AddAccountCard } from "@/components/ReviewAccountCard";
import { ReviewsDynamicsChart, ComplaintsDynamicsChart } from "@/components/ReviewsChart";

const TABS = [
  { href: "/reviews", label: "Отзывы" },
  { href: "/reviews/accounts", label: "Аккаунты WB" },
];

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

interface StatPoint {
  date: string;
  total_reviews: number;
  negative_reviews: number;
  complaints: number;
}

interface ComplaintStatPoint {
  date: string;
  submitted: number;
  approved: number;
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [stats, setStats] = useState<StatPoint[]>([]);
  const [complaintStats, setComplaintStats] = useState<ComplaintStatPoint[]>([]);
  const [period, setPeriod] = useState("month");
  const [showAddModal, setShowAddModal] = useState(false);
  const [newName, setNewName] = useState("");
  const [newApiKey, setNewApiKey] = useState("");

  const fetchAccounts = useCallback(async () => {
    const res = await fetch("/api/reviews/accounts");
    const data = await res.json();
    setAccounts(data);
  }, []);

  const fetchStats = useCallback(async () => {
    const res = await fetch(`/api/reviews/stats?period=${period}`);
    const data = await res.json();
    setStats(data.stats || []);
    setComplaintStats(data.complaint_stats || []);
  }, [period]);

  useEffect(() => { fetchAccounts(); }, [fetchAccounts]);
  useEffect(() => { fetchStats(); }, [fetchStats]);

  async function handleDelete(id: number) {
    if (!confirm("Удалить аккаунт? Все отзывы будут удалены.")) return;
    await fetch(`/api/reviews/accounts/${id}`, { method: "DELETE" });
    fetchAccounts();
  }

  async function handleAdd() {
    if (!newName || !newApiKey) return;
    await fetch("/api/reviews/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, api_key: newApiKey }),
    });
    setNewName("");
    setNewApiKey("");
    setShowAddModal(false);
    fetchAccounts();
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Отзывы</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">Управление аккаунтами Wildberries</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[var(--bg-card)] rounded-lg p-1 border border-[var(--border)] w-fit">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "px-4 py-2 rounded-md text-sm font-medium transition-colors",
              tab.href === "/reviews/accounts"
                ? "bg-[var(--accent)] text-white"
                : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-card-hover)]"
            )}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {/* Account cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {accounts.map((acc) => (
          <ReviewAccountCard key={acc.id} account={acc} onDelete={handleDelete} />
        ))}
        <AddAccountCard onClick={() => setShowAddModal(true)} />
      </div>

      {/* Charts */}
      <ReviewsDynamicsChart data={stats} currentPeriod={period} onPeriodChange={setPeriod} />
      <ComplaintsDynamicsChart data={complaintStats} currentPeriod={period} onPeriodChange={setPeriod} />

      {/* Add modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowAddModal(false)}>
          <div
            className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-6 w-full max-w-md space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-bold">Добавить аккаунт</h3>
            <div>
              <label className="text-xs text-[var(--text-muted)]">Название аккаунта</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="w-full mt-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                placeholder="Мой магазин"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--text-muted)]">API-ключ WB</label>
              <textarea
                value={newApiKey}
                onChange={(e) => setNewApiKey(e.target.value)}
                rows={3}
                className="w-full mt-1 bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)] resize-none font-mono"
                placeholder="Вставьте API-ключ..."
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowAddModal(false)}
                className="px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
              >
                Отмена
              </button>
              <button
                onClick={handleAdd}
                disabled={!newName || !newApiKey}
                className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white px-5 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50"
              >
                Добавить
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
