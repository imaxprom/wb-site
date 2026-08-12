"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, ChevronLeft, ChevronRight, Download, FileText, RefreshCw, Search } from "lucide-react";
import { formatNumber } from "@/lib/utils";

type DocumentStatus = "missing" | "available" | "saved" | "error";
type DocumentType = "acceptance_act" | "reconciliation_report" | "honest_sign";

interface SupplyDocument {
  supplyID: number;
  type: DocumentType;
  label: string;
  status: DocumentStatus;
  serviceName: string | null;
  documentName: string | null;
  category: string | null;
  extension: string | null;
  creationTime: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  downloadedAt: string | null;
  checkedAt: string | null;
  error: string | null;
}

interface SupplyReportRow {
  supplyID: number;
  preorderID: number | null;
  statusID: number | null;
  supplyDate: string | null;
  factDate: string | null;
  warehouseName: string | null;
  actualWarehouseName: string | null;
  quantity: number | null;
  acceptedQuantity: number | null;
  documents: Record<DocumentType, SupplyDocument>;
}

interface SupplyReportsResponse {
  ok: boolean;
  rows: SupplyReportRow[];
  error?: string;
}

const DOCUMENT_COLUMNS: DocumentType[] = ["acceptance_act", "reconciliation_report", "honest_sign"];
const PAGE_SIZE_OPTIONS = [25, 50, 100];

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatSize(bytes: number | null) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function statusTone(status: DocumentStatus) {
  if (status === "saved") return "border-[var(--success)]/35 bg-[var(--success)]/10 text-[var(--success)]";
  if (status === "available") return "border-[var(--accent)]/35 bg-[var(--accent)]/10 text-[var(--accent-hover)]";
  if (status === "error") return "border-[var(--danger)]/35 bg-[var(--danger)]/10 text-[var(--danger)]";
  return "border-[var(--border)] bg-[var(--bg)] text-[var(--text-muted)]";
}

function statusLabel(status: DocumentStatus) {
  if (status === "saved") return "Скачан";
  if (status === "available") return "Найден WB";
  if (status === "error") return "Ошибка";
  return "Не найден";
}

function DocumentCell({ doc }: { doc: SupplyDocument }) {
  const canDownload = doc.status === "saved" ||
    doc.status === "available" ||
    ((doc.type === "acceptance_act" || doc.type === "reconciliation_report") && doc.status === "missing");
  return (
    <div className="min-w-[172px] space-y-2">
      <div className={`inline-flex min-w-[92px] justify-center rounded-full border px-2.5 py-1 text-xs font-medium ${statusTone(doc.status)}`}>
        {statusLabel(doc.status)}
      </div>
      <div className="min-h-8 text-xs leading-4 text-[var(--text-muted)]">
        {doc.documentName || doc.error || (doc.status === "missing" ? "WB не отдал файл для этой поставки" : "-")}
      </div>
      <div className="flex min-h-7 items-center gap-2">
        {canDownload ? (
          <a
            href={`/api/supply-reports/${doc.supplyID}/documents/${doc.type}`}
            className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-xs font-medium text-[var(--text)] transition-colors hover:border-[var(--accent)] hover:text-white"
          >
            <Download size={13} />
            Скачать
          </a>
        ) : (
          <span className="text-xs text-[var(--text-muted)]">{doc.checkedAt ? "Проверено" : "Не проверено"}</span>
        )}
        {doc.extension && <span className="font-mono text-xs uppercase text-[var(--text-muted)]">{doc.extension}</span>}
        {doc.sizeBytes ? <span className="text-xs text-[var(--text-muted)]">{formatSize(doc.sizeBytes)}</span> : null}
      </div>
    </div>
  );
}

export default function SupplyReportsPage() {
  const [rows, setRows] = useState<SupplyReportRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [query, setQuery] = useState("");
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [error, setError] = useState("");
  const [syncMessage, setSyncMessage] = useState("");

  const loadReports = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/supply-reports?limit=500", { cache: "no-store" });
      const data = await res.json() as SupplyReportsResponse;
      if (!res.ok || !data.ok) throw new Error(data.error || "Не удалось загрузить отчеты поставок");
      setRows(data.rows || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const visibleRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => [
      row.supplyID,
      row.preorderID,
      row.actualWarehouseName,
      row.warehouseName,
      ...Object.values(row.documents).map((doc) => doc.documentName),
    ].some((value) => String(value || "").toLowerCase().includes(needle)));
  }, [query, rows]);

  const totalPages = Math.max(1, Math.ceil(visibleRows.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const pageStart = visibleRows.length === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const pageEnd = Math.min(safePage * pageSize, visibleRows.length);
  const remainingRows = Math.max(visibleRows.length - pageEnd, 0);
  const pageRows = useMemo(() => {
    const start = (safePage - 1) * pageSize;
    return visibleRows.slice(start, start + pageSize);
  }, [pageSize, safePage, visibleRows]);
  const pageNumbers = useMemo(() => buildPageNumbers(safePage, totalPages), [safePage, totalPages]);

  useEffect(() => {
    setPage(1);
  }, [query, pageSize]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  async function syncDocuments() {
    setSyncing(true);
    setError("");
    setSyncMessage("");
    try {
      const res = await fetch("/api/supply-reports/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ download: false, supplyLimit: 500, documentPageLimit: 10 }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Не удалось синхронизировать документы");
      setSyncMessage(`Проверено поставок: ${formatNumber(data.checkedSupplies)} · найдено документов: ${formatNumber(data.discoveredDocuments)}`);
      await loadReports();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ошибка синхронизации");
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h2 className="text-2xl font-bold">Отчеты о поставках</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Принятые поставки WB и документы для повторного скачивания
          </p>
        </div>
        <button
          type="button"
          onClick={syncDocuments}
          disabled={loading || syncing}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-medium text-[var(--text)] transition-colors hover:border-[var(--accent)] hover:text-white disabled:cursor-not-allowed disabled:opacity-60"
        >
          <RefreshCw size={16} className={syncing ? "animate-spin" : ""} />
          {syncing ? "Синхронизация" : "Найти документы WB"}
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-4 py-3 text-sm text-[var(--danger)]">
          <AlertCircle size={16} />
          {error}
        </div>
      )}
      {syncMessage && (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--success)]/30 bg-[var(--success)]/10 px-4 py-3 text-sm text-[var(--success)]">
          <FileText size={16} />
          {syncMessage}
        </div>
      )}

      <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)]">
        <div className="flex flex-col gap-3 border-b border-[var(--border)] px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white">Документы принятых поставок</h3>
            <div className="mt-1 text-xs text-[var(--text-muted)]">
              {formatNumber(visibleRows.length)} из {formatNumber(rows.length)} строк
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 md:w-80">
            <Search size={16} className="shrink-0 text-[var(--text-muted)]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Номер, склад, документ"
              className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--text-muted)]"
            />
          </div>
        </div>

        <div className="overflow-auto">
          <table className="w-full min-w-[1180px] border-collapse text-sm">
            <thead className="bg-[var(--bg)] text-xs uppercase tracking-wide text-[var(--text-muted)]">
              <tr>
                <th className="px-4 py-3 text-left font-medium">Поставка</th>
                <th className="px-4 py-3 text-left font-medium">Дата приемки</th>
                <th className="px-4 py-3 text-left font-medium">Склад</th>
                <th className="px-4 py-3 text-center font-medium">Принято</th>
                <th className="px-4 py-3 text-left font-medium">Акт приемки</th>
                <th className="px-4 py-3 text-left font-medium">Отчет сверки</th>
                <th className="px-4 py-3 text-left font-medium">Честный знак</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">
                    <RefreshCw size={18} className="mx-auto mb-3 animate-spin" />
                    Загружаю отчеты поставок
                  </td>
                </tr>
              ) : visibleRows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-sm text-[var(--text-muted)]">
                    Отчеты поставок не найдены
                  </td>
                </tr>
              ) : pageRows.map((row) => (
                <tr key={row.supplyID} className="border-t border-[var(--border)] align-top">
                  <td className="px-4 py-3">
                    <div className="font-mono font-semibold text-white">{row.supplyID}</div>
                    {row.preorderID ? <div className="mt-1 text-xs text-[var(--text-muted)]">заявка {row.preorderID}</div> : null}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs tabular-nums text-white">{formatDate(row.factDate || row.supplyDate)}</td>
                  <td className="px-4 py-3 text-white">{row.actualWarehouseName || row.warehouseName || "-"}</td>
                  <td className="px-4 py-3 text-center">
                    <div className="font-mono text-base font-semibold tabular-nums text-white">
                      {formatNumber(row.acceptedQuantity ?? row.quantity ?? 0)}
                    </div>
                    <div className="text-xs text-[var(--text-muted)]">шт</div>
                  </td>
                  {DOCUMENT_COLUMNS.map((type) => (
                    <td key={`${row.supplyID}:${type}`} className="px-4 py-3">
                      <DocumentCell doc={row.documents[type]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-3 border-t border-[var(--border)] px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--text-muted)]">
            <label className="flex items-center gap-2">
              <span>Показать записей</span>
              <select
                value={pageSize}
                onChange={(event) => setPageSize(Number(event.target.value))}
                className="h-9 rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 text-sm text-white outline-none transition-colors hover:border-[var(--accent)] focus:border-[var(--accent)]"
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>{size}</option>
                ))}
              </select>
            </label>
            <span>
              {visibleRows.length === 0
                ? "0 записей"
                : `${formatNumber(pageStart)}-${formatNumber(pageEnd)} из ${formatNumber(visibleRows.length)}`}
            </span>
            <span>Осталось: {formatNumber(remainingRows)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => setPage((value) => Math.max(value - 1, 1))}
              disabled={safePage <= 1}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text)] transition-colors hover:border-[var(--accent)] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Предыдущая страница"
            >
              <ChevronLeft size={16} />
            </button>
            {pageNumbers.map((item, index) => item === "gap" ? (
              <span key={`gap-${index}`} className="flex h-9 min-w-9 items-center justify-center px-2 text-sm text-[var(--text-muted)]">
                ...
              </span>
            ) : (
              <button
                key={item}
                type="button"
                onClick={() => setPage(item)}
                className={`h-9 min-w-9 rounded-md px-3 text-sm font-semibold transition-colors ${
                  item === safePage
                    ? "bg-[var(--accent)] text-white"
                    : "border border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)] hover:text-white"
                }`}
              >
                {item}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setPage((value) => Math.min(value + 1, totalPages))}
              disabled={safePage >= totalPages}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-[var(--border)] text-[var(--text)] transition-colors hover:border-[var(--accent)] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
              aria-label="Следующая страница"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function buildPageNumbers(current: number, total: number): Array<number | "gap"> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = new Set([1, total, current - 1, current, current + 1]);
  const sorted = Array.from(pages)
    .filter((value) => value >= 1 && value <= total)
    .sort((left, right) => left - right);
  const result: Array<number | "gap"> = [];
  for (const value of sorted) {
    const previous = result[result.length - 1];
    if (typeof previous === "number" && value - previous > 1) result.push("gap");
    result.push(value);
  }
  return result;
}
