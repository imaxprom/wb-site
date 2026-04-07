"use client";

import { useState, useEffect } from "react";

interface ReportInfo {
  name: string;
  size: number;
  date: string;
}

export function ReportDownload() {
  const [reportType, setReportType] = useState<"daily" | "weekly">("daily");
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [reports, setReports] = useState<ReportInfo[]>([]);

  useEffect(() => {
    loadReports();
  }, []);

  async function loadReports() {
    try {
      const res = await fetch("/api/wb/reports");
      const data = await res.json();
      if (data.ok) {
        setReports(data.reports || []);
      }
    } catch {
      // ignore
    }
  }

  async function handleDownload() {
    setLoading(true);
    setError("");
    setSuccess("");

    try {
      const res = await fetch("/api/wb/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: reportType, dateFrom, dateTo }),
      });
      const data = await res.json();

      if (data.ok) {
        setSuccess(`Отчёт скачан: ${data.fileName}`);
        loadReports();
      } else {
        setError(data.error || "Ошибка скачивания");
      }
    } catch {
      setError("Ошибка соединения");
    } finally {
      setLoading(false);
    }
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + " Б";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " КБ";
    return (bytes / (1024 * 1024)).toFixed(1) + " МБ";
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
      <h3 className="font-medium mb-1">Скачивание отчётов</h3>
      <p className="text-sm text-[var(--text-muted)] mb-4">
        Финансовые отчёты из кабинета продавца WB
      </p>

      {error && (
        <div className="mb-4 rounded-lg p-3 text-sm bg-[var(--danger)]/10 text-[var(--danger)]">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 rounded-lg p-3 text-sm bg-[var(--success)]/10 text-[var(--success)]">
          {success}
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-wrap items-end gap-3 mb-5">
        {/* Report type */}
        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1.5">Тип отчёта</label>
          <select
            value={reportType}
            onChange={(e) => setReportType(e.target.value as "daily" | "weekly")}
            className="bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--accent)]"
          >
            <option value="daily">Ежедневный</option>
            <option value="weekly">Еженедельный</option>
          </select>
        </div>

        {/* Date from */}
        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1.5">Дата с</label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--accent)]"
          />
        </div>

        {/* Date to */}
        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1.5">Дата по</label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[var(--accent)]"
          />
        </div>

        {/* Download button */}
        <button
          onClick={handleDownload}
          disabled={loading}
          className="px-5 py-2.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-50"
        >
          {loading ? "Скачивание..." : "Скачать отчёт"}
        </button>
      </div>

      {/* Downloaded reports list */}
      {reports.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-[var(--text-muted)] mb-2">
            Скачанные отчёты ({reports.length})
          </h4>
          <div className="space-y-1.5">
            {reports.map((r) => (
              <div
                key={r.name}
                className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm"
              >
                <span className="flex-1 font-mono text-xs truncate">{r.name}</span>
                <span className="text-[var(--text-muted)] text-xs">{formatSize(r.size)}</span>
                <span className="text-[var(--text-muted)] text-xs">{formatDate(r.date)}</span>
                <a
                  href={`/api/wb/reports?file=${encodeURIComponent(r.name)}`}
                  download
                  className="text-[var(--accent)] hover:text-[var(--accent-hover)] text-xs font-medium"
                >
                  Скачать
                </a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
