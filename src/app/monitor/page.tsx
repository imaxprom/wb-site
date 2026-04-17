"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { StatCard } from "@/components/StatCard";
import { DataHealthCard } from "@/components/DataHealthCard";

// ─── InfoTip ──────────────────────────────────────────────────

function InfoTip({ text }: { text: string }) {
  const [show, setShow] = useState(false);
  return (
    <span
      className="ml-1 cursor-help text-[var(--text-muted)] text-xs relative inline-block"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      ⓘ
      {show && (
        <span
          className="absolute left-0 top-6 z-50 border rounded-lg px-3 py-2 shadow-xl whitespace-normal"
          style={{ background: "#1a1a2e", borderColor: "var(--border)", color: "#e4e4ef", fontSize: 13, fontWeight: 400, width: 280, lineHeight: 1.5 }}
        >
          {text}
        </span>
      )}
    </span>
  );
}

// ─── Types ───────────────────────────────────────────────────

interface Schedule {
  type: string;
  intervalMin?: number;
  description?: string;
}

interface ServiceError {
  time: string;
  message: string;
}

interface Service {
  id: string;
  name: string;
  nameRu?: string;
  description: string;
  project: string;
  type: string;
  scriptPath?: string | null;
  plistLabel: string;
  logPath?: string | null;
  status: string;
  pid?: number | null;
  uptime: string;
  uptimeSeconds: number;
  lastRun?: string | null;
  nextRun?: string | null;
  schedule: Schedule;
  runsToday: number;
  runsTotal: number;
  errorsLast24h: number;
  lastErrors: ServiceError[];
  fileHash?: string | null;
  lastModified?: string | null;
  lifecycle: string;
}

interface StatusData {
  timestamp: string;
  machine: string;
  services: Service[];
}

interface Change {
  time: string;
  scriptId: string;
  type: string;
  details?: string;
  oldHash?: string;
  newHash?: string;
}

// ─── Helpers ────────────────────────────────────────────────

const TYPE_BADGES: Record<string, { label: string; color: string }> = {
  python: { label: "Python", color: "var(--accent)" },
  node: { label: "Node", color: "var(--success)" },
  bash: { label: "Bash", color: "var(--warning)" },
  system: { label: "System", color: "var(--text-muted)" },
  unknown: { label: "???", color: "var(--text-muted)" },
};

function statusColor(status: string) {
  if (status === "running") return "var(--success)";
  if (status === "idle") return "#42A5F5"; // синий — ожидает следующего запуска
  if (status === "error") return "var(--danger)";
  if (status === "stopped") return "var(--warning)";
  return "var(--text-muted)";
}

function statusLabel(status: string) {
  if (status === "idle") return "Ожидает";
  return status;
}

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff} сек назад`;
  if (diff < 3600) return `${Math.floor(diff / 60)} мин назад`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} ч назад`;
  return `${Math.floor(diff / 86400)} д назад`;
}

function timeUntil(iso: string | null | undefined): string {
  if (!iso) return "";
  const diff = Math.floor((new Date(iso).getTime() - Date.now()) / 1000);
  if (diff <= 0) return "сейчас";
  if (diff < 60) return `через ${diff} сек`;
  if (diff < 3600) return `через ${Math.floor(diff / 60)} мин`;
  return `через ${Math.floor(diff / 3600)} ч`;
}

// ─── Log Modal ──────────────────────────────────────────────

function LogModal({ service, onClose }: { service: Service; onClose: () => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [lineCount, setLineCount] = useState(50);
  const [errorsOnly, setErrorsOnly] = useState(false);

  const fetchLogs = useCallback(async (count: number, errors: boolean) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ id: service.id, lines: String(count) });
      if (errors) params.set("errors", "1");
      const res = await fetch(`/api/monitor/logs?${params}`);
      const data = await res.json();
      setLines(data.lines || []);
    } catch {
      setLines(["Ошибка загрузки логов"]);
    }
    setLoading(false);
  }, [service.id]);

  useEffect(() => {
    fetchLogs(lineCount, errorsOnly);
  }, [lineCount, errorsOnly, fetchLogs]);

  const colorLine = (line: string) => {
    if (/ERROR|CRITICAL/i.test(line)) return "text-[var(--danger)]";
    if (/WARNING/i.test(line)) return "text-[var(--warning)]";
    return "text-[var(--text-muted)]";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl w-full max-w-3xl max-h-[80vh] flex flex-col m-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
          <h3 className="text-lg font-bold text-white">{service.name} — Логи</h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-white text-xl">✕</button>
        </div>

        <div className="flex gap-2 p-3 border-b border-[var(--border)]">
          {[50, 100, 200].map((n) => (
            <button
              key={n}
              onClick={() => { setLineCount(n); setErrorsOnly(false); }}
              className={`px-3 py-1 rounded-lg text-sm border transition-colors ${
                lineCount === n && !errorsOnly
                  ? "border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/10"
                  : "border-[var(--border)] text-[var(--text-muted)] hover:text-white"
              }`}
            >
              {n} строк
            </button>
          ))}
          <button
            onClick={() => setErrorsOnly(true)}
            className={`px-3 py-1 rounded-lg text-sm border transition-colors ${
              errorsOnly
                ? "border-[var(--danger)] text-[var(--danger)] bg-[var(--danger)]/10"
                : "border-[var(--border)] text-[var(--text-muted)] hover:text-white"
            }`}
          >
            Только ошибки
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <p className="text-[var(--text-muted)] text-center py-8">Загрузка...</p>
          ) : lines.length === 0 ? (
            <p className="text-[var(--text-muted)] text-center py-8">Нет записей</p>
          ) : (
            <pre className="text-xs leading-relaxed font-mono whitespace-pre-wrap break-all">
              {lines.map((line, i) => (
                <div key={i} className={colorLine(line)}>{line}</div>
              ))}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Service Card ───────────────────────────────────────────

function ServiceCard({
  service,
  onShowLogs,
  onAction,
  onRun,
  recentChanges,
}: {
  service: Service;
  onShowLogs: (s: Service) => void;
  onAction: (id: string, action: string) => void;
  onRun: (id: string) => void;
  recentChanges: Change[];
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const badge = TYPE_BADGES[service.type] || TYPE_BADGES.unknown;
  const isStale = service.lifecycle === "stale";
  const isDeleted = service.lifecycle === "deleted";
  const isArchived = service.lifecycle === "archived";

  const wasModified = recentChanges.some(
    (c) => c.scriptId === service.id && c.type === "modified" &&
      (Date.now() - new Date(c.time).getTime()) < 86400_000
  );

  if (isArchived) return null; // rendered in archive section

  return (
    <div
      className={`bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-3 relative transition-opacity ${
        isStale || isDeleted ? "opacity-60" : ""
      }`}
    >
      {/* Status dot */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 rounded-l-xl"
        style={{ background: isDeleted ? "var(--text-muted)" : statusColor(service.status) }}
      />

      <div className="pl-3">
        {/* Header */}
        <div className="flex items-start justify-between gap-1">
          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
            <h4 className="text-white font-semibold text-sm flex items-center gap-1 min-w-0">
              <span className="truncate">
                {service.name}
                {service.nameRu && <span className="text-[var(--text-muted)] font-normal"> ({service.nameRu})</span>}
              </span>
              {service.description && <InfoTip text={service.description} />}
            </h4>
            <span
              className="text-[9px] px-1.5 py-0.5 rounded-full font-medium uppercase tracking-wider shrink-0"
              style={{ color: badge.color, background: `color-mix(in srgb, ${badge.color} 15%, transparent)` }}
            >
              {badge.label}
            </span>
            {isStale && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--text-muted)]/10 text-[var(--text-muted)]">
                Устарел
              </span>
            )}
            {isDeleted && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--text-muted)]/10 text-[var(--text-muted)]">
                Удалён
              </span>
            )}
            {wasModified && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)]">
                Изменён
              </span>
            )}
            {service.errorsLast24h > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--danger)]/10 text-[var(--danger)]">
                {service.errorsLast24h} ошиб.
              </span>
            )}
          </div>
          {/* Menu */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="text-[var(--text-muted)] hover:text-white p-1"
            >
              ⋮
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 top-8 z-20 bg-[var(--bg)] border border-[var(--border)] rounded-lg shadow-xl py-1 min-w-[160px]">
                  {!isDeleted && !isArchived && service.status === "running" && (
                    <button
                      onClick={() => { onAction(service.id, "stop"); setMenuOpen(false); }}
                      className="w-full text-left px-4 py-2 text-sm text-[var(--warning)] hover:bg-[var(--bg-card-hover)]"
                    >
                      ⏹ Остановить
                    </button>
                  )}
                  {!isDeleted && !isArchived && (
                    <button
                      onClick={() => { onAction(service.id, "restart"); setMenuOpen(false); }}
                      className="w-full text-left px-4 py-2 text-sm text-[var(--accent)] hover:bg-[var(--bg-card-hover)]"
                    >
                      🔄 Перезапустить
                    </button>
                  )}
                  {!isDeleted && !isArchived && (
                    <button
                      onClick={() => { onAction(service.id, "archive"); setMenuOpen(false); }}
                      className="w-full text-left px-4 py-2 text-sm text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-card-hover)]"
                    >
                      📦 Архивировать
                    </button>
                  )}
                  <button
                    onClick={() => { onAction(service.id, "delete"); setMenuOpen(false); }}
                    className="w-full text-left px-4 py-2 text-sm text-[var(--danger)] hover:bg-[var(--bg-card-hover)]"
                  >
                    🗑 Удалить
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Schedule & runs */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px] text-[var(--text-muted)]">
          {service.schedule?.description && (
            <span>⏰ {service.schedule.description}</span>
          )}
          {service.uptime && service.status === "running" && (
            <span>Аптайм: {service.uptime}</span>
          )}
          {service.status === "idle" && service.lastRun && (
            <span>Последний: {timeAgo(service.lastRun)}</span>
          )}
          {service.pid && (
            <span>PID: {service.pid}</span>
          )}
        </div>

        {/* Next/last run */}
        {(service.lastRun || service.nextRun) && (
          <div className="flex gap-3 mt-1.5 text-[11px] text-[var(--text-muted)]">
            {service.lastRun && <span>◀ {timeAgo(service.lastRun)}</span>}
            {service.nextRun && <span>▶ {timeUntil(service.nextRun)}</span>}
          </div>
        )}

        {/* Progress bar for finite schedules (skip keepalive/permanent services) */}
        {service.runsToday >= 0 && service.runsTotal > 0 && service.schedule?.type !== "keepalive" && (
          <div className="mt-2">
            <div className="flex justify-between text-[10px] text-[var(--text-muted)] mb-1">
              <span>{service.runsToday} из {service.runsTotal}</span>
            </div>
            <div className="w-full h-1.5 bg-[var(--border)] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.min(100, (service.runsToday / service.runsTotal) * 100)}%`,
                  background: "var(--accent)",
                }}
              />
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-1.5 mt-2">
          {!isDeleted && !isArchived && (
            <button
              onClick={() => onRun(service.id)}
              className="text-xs px-3 py-1.5 rounded-lg border border-[var(--success)]/30 text-[var(--success)] hover:bg-[var(--success)]/10 transition-colors"
            >
              ▶ Запустить
            </button>
          )}
          {service.logPath && (
            <button
              onClick={() => onShowLogs(service)}
              className="text-xs px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-card-hover)] transition-colors"
            >
              Логи
            </button>
          )}
          {isDeleted && (
            <button
              onClick={() => onAction(service.id, "delete")}
              className="text-xs px-3 py-1.5 rounded-lg border border-[var(--danger)]/30 text-[var(--danger)] hover:bg-[var(--danger)]/10 transition-colors"
            >
              Убрать
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Watchdog Banner ────────────────────────────────────────

function WatchdogBanner() {
  const [lastEntry, setLastEntry] = useState<{ time: string; action: string; serviceId: string; result: string; details: string } | null>(null);

  useEffect(() => {
    fetch("/data/monitor/repair-log.json")
      .then(r => r.json())
      .then((entries: Array<{ time: string; action: string; serviceId: string; result: string; details: string }>) => {
        if (entries.length === 0) return;
        const last = entries[entries.length - 1];
        // Показываем только свежие записи (< 24 часов)
        if (last.time) {
          const ageMs = Date.now() - new Date(last.time).getTime();
          if (ageMs < 24 * 60 * 60 * 1000) {
            setLastEntry(last);
          }
        }
      })
      .catch(() => {});
  }, []);

  if (!lastEntry) return null;

  const age = timeAgo(lastEntry.time);
  const isOk = lastEntry.result === "success";

  return (
    <div className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs border ${
      isOk
        ? "border-[var(--success)]/20 bg-[var(--success)]/5 text-[var(--success)]"
        : "border-[var(--warning)]/20 bg-[var(--warning)]/5 text-[var(--warning)]"
    }`}>
      <span className="font-medium">Watchdog:</span>
      <span>{lastEntry.details}</span>
      <span className="text-[var(--text-muted)]">· {age}</span>
    </div>
  );
}

// ─── Main Page ──────────────────────────────────────────────

export default function MonitorPage() {
  const [status, setStatus] = useState<StatusData | null>(null);
  const [changes, setChanges] = useState<Change[]>([]);
  const [loading, setLoading] = useState(true);
  const [logService, setLogService] = useState<Service | null>(null);
  const [showArchive, setShowArchive] = useState(false);
  const [runResult, setRunResult] = useState<{ id: string; ok: boolean; message: string } | null>(null);
  const [repairLog, setRepairLog] = useState<Array<{ time: string; serviceId: string; action: string; result: string; details: string; aiResponse?: string | null }>>([]);

  const fetchStatus = useCallback(async () => {
    try {
      const [statusRes, changesRes] = await Promise.all([
        fetch("/api/monitor/status"),
        fetch("/data/monitor/changes.json"),
      ]);
      const statusData = await statusRes.json();
      setStatus(statusData);
      try {
        const changesData = await changesRes.json();
        setChanges(changesData);
      } catch {
        // changes might not exist yet
      }
      try {
        const repairRes = await fetch("/data/monitor/repair-log.json");
        const repairData = await repairRes.json();
        setRepairLog(repairData);
      } catch {}
    } catch (e) {
      console.error("Failed to fetch status:", e);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 30_000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  const handleAction = useCallback(async (id: string, action: string) => {
    await fetch("/api/monitor/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
    });
    fetchStatus();
  }, [fetchStatus]);

  const handleRun = useCallback(async (id: string) => {
    setRunResult(null);
    try {
      const res = await fetch("/api/monitor/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      setRunResult({ id, ok: res.ok, message: data.message || data.error || "Неизвестный результат" });
      // Auto-hide after 5 seconds
      setTimeout(() => setRunResult(null), 5000);
      // Refresh status after 2 seconds (give time for process to start)
      setTimeout(fetchStatus, 2000);
    } catch {
      setRunResult({ id, ok: false, message: "Ошибка сети" });
      setTimeout(() => setRunResult(null), 5000);
    }
  }, [fetchStatus]);

  // Compute stats
  const services = status?.services || [];
  const active = services.filter((s) => s.lifecycle !== "archived");
  const archived = services.filter((s) => s.lifecycle === "archived");

  const stats = useMemo(() => {
    const runningList = active.filter((s) => s.status === "running" || s.status === "idle");
    const warningList = active.filter((s) => s.status === "stopped" || s.status === "unknown" || s.lifecycle === "stale");
    const errorList = active.filter((s) => s.status === "error");
    const errCount = active.reduce((sum, s) => sum + (s.errorsLast24h || 0), 0);
    return {
      running: runningList.length,
      runningNames: runningList.map((s) => s.name),
      warning: warningList.length,
      warningNames: warningList.map((s) => s.name),
      errors: errorList.length,
      errorNames: errorList.map((s) => s.name),
      errCount,
      errNames: active.filter((s) => (s.errorsLast24h || 0) > 0).map((s) => `${s.name} (${s.errorsLast24h})`),
    };
  }, [active]);

  // Group by project
  const grouped = useMemo(() => {
    const map = new Map<string, Service[]>();
    for (const svc of active) {
      const project = svc.project || "Другое";
      if (!map.has(project)) map.set(project, []);
      map.get(project)!.push(svc);
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length);
  }, [active]);

  // All errors across services
  const allErrors = useMemo(() => {
    return active
      .flatMap((s) => s.lastErrors.map((e) => ({ ...e, serviceName: s.name, serviceId: s.id })))
      .sort((a, b) => (b.time || "").localeCompare(a.time || ""))
      .slice(0, 20);
  }, [active]);

  const totalActive = active.length;
  const okCount = stats.running;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-[var(--text-muted)]">Загрузка мониторинга...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Мониторинг скриптов</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            {status?.machine || "MacBook Air"} ·{" "}
            <span style={{ color: okCount === totalActive ? "var(--success)" : "var(--warning)" }}>
              {okCount}/{totalActive} OK
            </span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <p className="text-xs text-[var(--text-muted)]">
            Обновлено: {status?.timestamp ? timeAgo(status.timestamp) : "—"}
          </p>
          <button
            onClick={fetchStatus}
            className="text-xs px-2.5 py-1 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-white hover:bg-[var(--bg-card)] transition-colors"
          >
            ↻
          </button>
        </div>
      </div>

      {/* Run result toast */}
      {runResult && (
        <div
          className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-xl border shadow-xl text-sm transition-all ${
            runResult.ok
              ? "bg-[var(--bg-card)] border-[var(--success)]/30 text-[var(--success)]"
              : "bg-[var(--bg-card)] border-[var(--danger)]/30 text-[var(--danger)]"
          }`}
        >
          {runResult.ok ? "✅" : "❌"} {runResult.message}
        </div>
      )}

      {/* Watchdog status */}
      <WatchdogBanner />

      {/* Data health */}
      <DataHealthCard />

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard title="Работают" value={stats.running} color="success" tooltipItems={stats.runningNames} />
        <StatCard title="Остановлены" value={stats.warning} color="warning" tooltipItems={stats.warningNames} />
        <StatCard title="Упали" value={stats.errors} color="danger" tooltipItems={stats.errorNames} />
        <StatCard title="Ошибок за 24ч" value={stats.errCount} color={stats.errCount > 0 ? "danger" : "default"} tooltipItems={stats.errNames} />
      </div>

      {/* Status legend */}
      <div className="flex flex-wrap gap-4 text-xs text-[var(--text-muted)] bg-[var(--bg-card)] rounded-lg border border-[var(--border)] px-4 py-2">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--success)" }} />Работает — процесс запущен</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: "#42A5F5" }} />Ожидает — cron-задача отработала, ждёт следующего запуска</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--warning)" }} />Остановлен — не запускался или последний запуск более 25ч назад</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full" style={{ background: "var(--danger)" }} />Ошибка — процесс завершился с ошибкой</span>
      </div>

      {/* Services grouped by project */}
      {grouped.map(([project, svcs]) => {
        const pRunning = svcs.filter(s => s.status === "running").length;
        const pIdle = svcs.filter(s => s.status === "idle").length;
        const pStopped = svcs.filter(s => s.status === "stopped" || s.status === "unknown").length;
        const pError = svcs.filter(s => s.status === "error").length;
        return (
        <div key={project} className="border border-[var(--border)]/40 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-white">{project} <span className="text-sm font-normal text-[var(--text-muted)]">{svcs.length}</span></h2>
            <div className="flex items-center gap-3 text-xs">
              {pRunning > 0 && <span className="flex items-center gap-1 text-[var(--success)]"><span className="w-2 h-2 rounded-full bg-[var(--success)]" />{pRunning}</span>}
              {pIdle > 0 && <span className="flex items-center gap-1" style={{ color: "#42A5F5" }}><span className="w-2 h-2 rounded-full" style={{ background: "#42A5F5" }} />{pIdle}</span>}
              {pStopped > 0 && <span className="flex items-center gap-1 text-[var(--warning)]"><span className="w-2 h-2 rounded-full bg-[var(--warning)]" />{pStopped}</span>}
              {pError > 0 && <span className="flex items-center gap-1 text-[var(--danger)]"><span className="w-2 h-2 rounded-full bg-[var(--danger)]" />{pError}</span>}
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            {svcs.map((svc) => (
              <ServiceCard
                key={svc.id}
                service={svc}
                onShowLogs={setLogService}
                onAction={handleAction}
                onRun={handleRun}
                recentChanges={changes}
              />
            ))}
          </div>
        </div>
        );
      })}

      {/* Error journal */}
      {allErrors.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-white mb-3">Журнал ошибок</h2>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl overflow-hidden">
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Время</th>
                    <th>Скрипт</th>
                    <th>Сообщение</th>
                  </tr>
                </thead>
                <tbody>
                  {allErrors.map((err, i) => (
                    <tr key={i}>
                      <td className="text-[var(--text-muted)] whitespace-nowrap">{err.time || "—"}</td>
                      <td className="text-white whitespace-nowrap">{err.serviceName}</td>
                      <td className="text-[var(--danger)] text-sm" style={{ whiteSpace: "normal", maxWidth: 400 }}>
                        {err.message}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Repair log (Watchdog) */}
      {repairLog.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-white mb-3">История ремонтов (Watchdog)</h2>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl overflow-hidden">
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Время</th>
                    <th>Сервис</th>
                    <th>Действие</th>
                    <th>Результат</th>
                    <th>Детали</th>
                  </tr>
                </thead>
                <tbody>
                  {[...repairLog].reverse().slice(0, 20).map((entry, i) => (
                    <tr key={i}>
                      <td className="text-[var(--text-muted)] whitespace-nowrap">
                        {entry.time ? new Date(entry.time).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                      </td>
                      <td className="text-white whitespace-nowrap">{entry.serviceId}</td>
                      <td>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          entry.action === "restart" ? "bg-[var(--accent)]/10 text-[var(--accent)]" :
                          entry.action === "ai_diagnosis" ? "bg-[var(--warning)]/10 text-[var(--warning)]" :
                          entry.action === "error_analysis" ? "bg-[var(--warning)]/10 text-[var(--warning)]" :
                          "bg-[var(--success)]/10 text-[var(--success)]"
                        }`}>
                          {entry.action}
                        </span>
                      </td>
                      <td>
                        <span className={entry.result === "success" ? "text-[var(--success)]" : entry.result === "failed" ? "text-[var(--danger)]" : "text-[var(--text-muted)]"}>
                          {entry.result}
                        </span>
                      </td>
                      <td className="text-[var(--text-muted)] text-sm" style={{ whiteSpace: "normal", maxWidth: 300 }}>
                        {entry.aiResponse ? entry.aiResponse.slice(0, 150) + (entry.aiResponse.length > 150 ? "..." : "") : entry.details}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Changes journal */}
      {changes.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-white mb-3">Журнал изменений</h2>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl overflow-hidden">
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Время</th>
                    <th>Скрипт</th>
                    <th>Действие</th>
                    <th>Детали</th>
                  </tr>
                </thead>
                <tbody>
                  {changes.slice(0, 20).map((ch, i) => (
                    <tr key={i}>
                      <td className="text-[var(--text-muted)] whitespace-nowrap">
                        {ch.time ? new Date(ch.time).toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—"}
                      </td>
                      <td className="text-white whitespace-nowrap">{ch.scriptId}</td>
                      <td>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          ch.type === "modified" ? "bg-[var(--accent)]/10 text-[var(--accent)]" :
                          ch.type === "deleted" ? "bg-[var(--danger)]/10 text-[var(--danger)]" :
                          ch.type === "discovered" ? "bg-[var(--success)]/10 text-[var(--success)]" :
                          ch.type === "archived" ? "bg-[var(--text-muted)]/10 text-[var(--text-muted)]" :
                          "bg-[var(--warning)]/10 text-[var(--warning)]"
                        }`}>
                          {ch.type}
                        </span>
                      </td>
                      <td className="text-[var(--text-muted)] text-sm">{ch.details || (ch.oldHash ? `${ch.oldHash} → ${ch.newHash}` : "")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Archive */}
      {archived.length > 0 && (
        <div>
          <button
            onClick={() => setShowArchive(!showArchive)}
            className="flex items-center gap-2 text-[var(--text-muted)] hover:text-white text-sm mb-3 transition-colors"
          >
            <span className="text-xs">{showArchive ? "▼" : "▶"}</span>
            Архив ({archived.length})
          </button>
          {showArchive && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 opacity-60">
              {archived.map((svc) => (
                <div key={svc.id} className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-white font-semibold">{svc.name}</h4>
                      <p className="text-xs text-[var(--text-muted)] mt-1">{svc.description}</p>
                    </div>
                    <button
                      onClick={() => handleAction(svc.id, "unarchive")}
                      className="text-xs px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-white transition-colors"
                    >
                      Восстановить
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Log modal */}
      {logService && <LogModal service={logService} onClose={() => setLogService(null)} />}
    </div>
  );
}
