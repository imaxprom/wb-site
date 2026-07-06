"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { AccountSettings, type AccountSettingsTab } from "@/components/AccountSettings";
import { ReviewsSectionNav } from "@/components/ReviewsSectionNav";

interface Account {
  id: number;
  name: string;
  store_name: string | null;
  inn: string | null;
  supplier_id: string | null;
  has_api_key: boolean;
  cookie_status: string;
  api_status: string;
  auto_replies: number;
  auto_dialogs: number;
  auto_complaints: number;
  use_auto_proxy: number;
  settings_json: string | null;
  has_wb_authorize_v3: boolean;
  has_wb_validation_key: boolean;
  wb_cookie_updated_at: string | null;
}

interface ReviewSettingsWorkspaceProps {
  tab: AccountSettingsTab;
  title: string;
  description: string;
}

interface ComplaintPauseState {
  paused: boolean;
  pause: {
    paused_until: string;
    reason: string | null;
    stats_json: Record<string, unknown> | null;
  } | null;
  stats: {
    pause: boolean;
    rejected: number;
    approved: number;
    total: number;
    windowHours: number;
  };
  threshold: {
    last_n: number;
    window_hours: number;
    pause_hours: number;
  };
}

export function ReviewSettingsWorkspace({ tab, title, description }: ReviewSettingsWorkspaceProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [saved, setSaved] = useState(false);
  const [pauseState, setPauseState] = useState<ComplaintPauseState | null>(null);
  const [pauseLoading, setPauseLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/reviews/accounts")
      .then((r) => r.json())
      .then((data: Account[]) => {
        if (cancelled) return;
        const list = Array.isArray(data) ? data : [];
        setAccounts(list);
        const fromUrl = Number(searchParams.get("account_id"));
        const selected = list.find((a) => a.id === fromUrl)?.id ?? list[0]?.id ?? null;
        setSelectedId(selected);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [searchParams]);

  const selectedAccount = useMemo(
    () => accounts.find((account) => account.id === selectedId) || null,
    [accounts, selectedId]
  );

  useEffect(() => {
    if (tab !== "auto-complaints" || !selectedId) {
      setPauseState(null);
      return;
    }
    let cancelled = false;
    setPauseLoading(true);
    fetch(`/api/reviews/complaints?pause=true&account_id=${selectedId}`)
      .then((r) => r.json())
      .then((data: ComplaintPauseState) => {
        if (!cancelled) setPauseState(data);
      })
      .catch(() => {
        if (!cancelled) setPauseState(null);
      })
      .finally(() => {
        if (!cancelled) setPauseLoading(false);
      });
    return () => { cancelled = true; };
  }, [tab, selectedId]);

  function handleAccountChange(id: number) {
    setSelectedId(id);
    const params = new URLSearchParams(searchParams.toString());
    params.set("account_id", String(id));
    router.replace(`${pathname}?${params.toString()}`);
  }

  async function handleSave(data: Partial<Account> & { settings_json?: string }) {
    if (!selectedId) return;
    const res = await fetch(`/api/reviews/accounts/${selectedId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error || "Не удалось сохранить настройки");
      return;
    }
    const updated = await res.json();
    if (updated) {
      setAccounts((prev) => prev.map((account) => (account.id === selectedId ? updated : account)));
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  }

  async function handleClearPause() {
    if (!selectedId) return;
    const res = await fetch(`/api/reviews/complaints?pause=true&account_id=${selectedId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      alert(body.error || "Не удалось снять паузу автожалоб");
      return;
    }
    const fresh = await fetch(`/api/reviews/complaints?pause=true&account_id=${selectedId}`).then((r) => r.json());
    setPauseState(fresh);
  }

  function formatPauseUntil(value?: string) {
    if (!value) return "";
    return new Date(value).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Отзывы</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">Единый раздел управления отзывами Wildberries</p>
      </div>

      <ReviewsSectionNav />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h3 className="text-lg font-semibold">{title}</h3>
          <p className="text-sm text-[var(--text-muted)] mt-1">{description}</p>
        </div>
        <label className="flex flex-col gap-1 min-w-[280px]">
          <span className="text-xs text-[var(--text-muted)]">Аккаунт WB</span>
          <select
            value={selectedId ?? ""}
            onChange={(event) => handleAccountChange(Number(event.target.value))}
            disabled={loading || accounts.length === 0}
            className="bg-[var(--bg-card)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
          >
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}{account.store_name ? ` — ${account.store_name}` : ""}
              </option>
            ))}
          </select>
        </label>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16 text-[var(--text-muted)]">Загрузка...</div>
      )}

      {!loading && !selectedAccount && (
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-6 text-sm text-[var(--text-muted)]">
          Аккаунты WB не добавлены.
        </div>
      )}

      {selectedAccount && tab === "auto-complaints" && (
        <div className={`rounded-xl border p-4 ${
          pauseState?.paused
            ? "bg-amber-500/10 border-amber-500/40"
            : "bg-[var(--bg-card)] border-[var(--border)]"
        }`}>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className={`text-sm font-semibold ${pauseState?.paused ? "text-amber-300" : "text-[var(--text)]"}`}>
                {pauseLoading ? "Проверяю паузу автожалоб..." : pauseState?.paused ? "Автожалобы на паузе" : "Автожалобы без активной паузы"}
              </div>
              <div className="mt-1 text-xs text-[var(--text-muted)]">
                {pauseState?.paused
                  ? `До ${formatPauseUntil(pauseState.pause?.paused_until)}. ${pauseState.pause?.reason || ""}`
                  : `Стоп включается только если свежие последние ${pauseState?.threshold?.last_n || 5} обработанных жалоб за ${pauseState?.threshold?.window_hours || 24} ч все отклонены WB.`}
              </div>
              {pauseState?.stats && (
                <div className="mt-2 text-xs text-[var(--text-muted)]">
                  За {pauseState.stats.windowHours} ч: одобрено {pauseState.stats.approved}, отклонено {pauseState.stats.rejected}, всего {pauseState.stats.total}
                </div>
              )}
            </div>
            {pauseState?.paused && (
              <button
                onClick={handleClearPause}
                className="px-3 py-2 rounded-lg border border-amber-500/50 text-amber-200 text-sm hover:bg-amber-500/10 transition-colors"
              >
                Снять паузу
              </button>
            )}
          </div>
        </div>
      )}

      {selectedAccount && (
        <AccountSettings
          key={`${selectedAccount.id}-${tab}`}
          account={selectedAccount}
          onSave={handleSave}
          saved={saved}
          initialTab={tab}
          showHeader={false}
          showInternalTabs={false}
        />
      )}
    </div>
  );
}
