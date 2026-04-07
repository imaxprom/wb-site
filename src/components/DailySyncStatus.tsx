"use client";

import { useState, useEffect, useCallback } from "react";

interface SyncHistoryEntry {
  date: string;
  timestamp: string;
  rows: number;
  ok: boolean;
  error?: string;
}

interface SyncStatus {
  lastRun: string | null;
  lastSuccess: string | null;
  lastError: string | null;
  lastDate: string | null;
  nextRun: string | null;
  running: boolean;
  history: SyncHistoryEntry[];
}

export function DailySyncStatus() {
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [manualDate, setManualDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [message, setMessage] = useState("");

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/wb/daily-sync");
      const data = await res.json();
      setStatus(data);
    } catch {}
  }, []);

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 30000); // refresh every 30s
    return () => clearInterval(interval);
  }, [loadStatus]);

  async function handleSync(date?: string) {
    setSyncing(true);
    setMessage("");
    try {
      const res = await fetch("/api/wb/daily-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(date ? { date } : {}),
      });
      const result = await res.json();
      if (result.ok) {
        setMessage(`Импортировано ${result.rows} строк за ${result.date}`);
      } else {
        setMessage(result.error || "Ошибка синхронизации");
      }
      loadStatus();
    } catch {
      setMessage("Ошибка соединения");
    } finally {
      setSyncing(false);
    }
  }

  function formatDate(iso: string | null): string {
    if (!iso) return "—";
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  }

  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-medium">Автозагрузка ежедневных отчётов</h3>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Каждый день в 08:00 скачивает финансовый отчёт за вчера
          </p>
        </div>

        {status?.running ? (
          <span className="flex items-center gap-2 text-sm text-[var(--accent)]">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Синхронизация...
          </span>
        ) : (
          <div className="flex items-center gap-1.5">
            {status?.lastSuccess && (
              <span className="w-2 h-2 rounded-full bg-[var(--success)]" />
            )}
            {status?.lastError && !status?.lastSuccess && (
              <span className="w-2 h-2 rounded-full bg-[var(--danger)]" />
            )}
          </div>
        )}
      </div>

      {/* Status info */}
      {status && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 text-sm">
          <div>
            <span className="text-[var(--text-muted)] text-xs block">Последний запуск</span>
            <span>{formatDate(status.lastRun)}</span>
          </div>
          <div>
            <span className="text-[var(--text-muted)] text-xs block">Последний успех</span>
            <span className="text-[var(--success)]">{formatDate(status.lastSuccess)}</span>
          </div>
          <div>
            <span className="text-[var(--text-muted)] text-xs block">Следующий запуск</span>
            <span>{formatDate(status.nextRun)}</span>
          </div>
          <div>
            <span className="text-[var(--text-muted)] text-xs block">Последняя дата</span>
            <span>{status.lastDate || "—"}</span>
          </div>
        </div>
      )}

      {/* Error */}
      {status?.lastError && (
        <div className="mb-4 rounded-lg p-3 text-sm bg-[var(--danger)]/10 text-[var(--danger)] border border-[var(--danger)]/20">
          {status.lastError}
        </div>
      )}

      {/* Message */}
      {message && (
        <div className={`mb-4 rounded-lg p-3 text-sm border ${
          message.includes("Ошибка")
            ? "bg-[var(--danger)]/10 text-[var(--danger)] border-[var(--danger)]/20"
            : "bg-[var(--success)]/10 text-[var(--success)] border-[var(--success)]/20"
        }`}>
          {message}
        </div>
      )}

      {/* Manual sync controls */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1.5">Дата отчёта</label>
          <input
            type="date"
            value={manualDate}
            onChange={(e) => setManualDate(e.target.value)}
            className="bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[var(--accent)]"
          />
        </div>
        <button
          onClick={() => handleSync(manualDate)}
          disabled={syncing}
          className="px-4 py-2 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-50"
        >
          {syncing ? "Загрузка..." : "Загрузить за дату"}
        </button>
        <button
          onClick={() => handleSync()}
          disabled={syncing}
          className="px-4 py-2 border border-[var(--border)] text-[var(--text-muted)] text-sm rounded-lg font-medium hover:bg-[var(--bg-card-hover)] transition-colors disabled:opacity-50"
        >
          Загрузить за вчера
        </button>
      </div>

      {/* History */}
      {status?.history && status.history.length > 0 && (
        <div>
          <h4 className="text-xs text-[var(--text-muted)] uppercase tracking-wide mb-2">
            История загрузок
          </h4>
          <div className="space-y-1">
            {status.history.slice(0, 10).map((entry, i) => (
              <div
                key={i}
                className="flex items-center gap-3 px-3 py-1.5 rounded-lg bg-[var(--bg)] text-sm"
              >
                <span className={`w-1.5 h-1.5 rounded-full ${entry.ok ? "bg-[var(--success)]" : "bg-[var(--danger)]"}`} />
                <span className="font-mono text-xs w-24">{entry.date}</span>
                <span className="text-[var(--text-muted)] text-xs">
                  {entry.rows} строк
                </span>
                {entry.error && (
                  <span className="text-[var(--danger)] text-xs truncate flex-1">{entry.error}</span>
                )}
                <span className="text-[var(--text-muted)] text-xs ml-auto">
                  {new Date(entry.timestamp).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
