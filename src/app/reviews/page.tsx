"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { ReviewsFilters, type ReviewFilterValues } from "@/components/ReviewsFilters";
import { ReviewsTable } from "@/components/ReviewsTable";

// ─── Sync Progress ──────────────────────────────────────────

interface SyncStatus {
  total: number;
  loaded: number;
  status: "idle" | "syncing" | "done" | "error";
  message: string;
}

function fmt(n: number) {
  return n.toLocaleString("ru-RU");
}

function SyncProgress({ syncing, onRefresh, onFullSync }: { syncing: boolean; onRefresh: () => void; onFullSync: () => void }) {
  const [status, setStatus] = useState<SyncStatus>({ total: 0, loaded: 0, status: "idle", message: "" });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const poll = () => fetch("/api/reviews/sync-status").then(r => r.json()).then((s: SyncStatus) => {
      setStatus(s);
      if (s.status !== "syncing" && !syncing && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }).catch(() => {});

    // Always start polling — covers both active sync and background enrichment
    poll();
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(poll, 2000);
    return () => { if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; } };
  }, [syncing]);

  const pct = status.total > 0 ? Math.round((status.loaded / status.total) * 100) : 0;
  const isSyncing = status.status === "syncing";
  const isDone = status.status === "done";
  const isError = status.status === "error";

  return (
    <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-sm flex-1 min-w-0 mr-3">
          {isSyncing && (
            <span className={syncing ? "text-[var(--text)]" : "text-[var(--accent)]"}>
              {status.message || `Загрузка отзывов: ${fmt(status.loaded)} / ${status.total > 0 ? fmt(status.total) : "..."}`}
            </span>
          )}
          {isDone && (
            <span className="text-green-500">
              {status.message || `Загружено ${fmt(status.loaded)} ✅`}
            </span>
          )}
          {isError && (
            <span className="text-red-500">Ошибка: {status.message}</span>
          )}
          {!isSyncing && !isDone && !isError && (
            <span className="text-[var(--text-muted)]">
              {status.loaded > 0
                ? `В базе: ${fmt(status.loaded)}`
                : "Нажмите «Обновить» для загрузки отзывов"}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isSyncing && (
            <span className={`text-xs animate-pulse ${syncing ? "text-[var(--text-muted)]" : "text-[var(--accent)]"}`}>
              {syncing ? "Синхронизация..." : "Обогащение..."}
            </span>
          )}
          {!syncing && (
            <>
              <button
                onClick={onFullSync}
                className="text-xs px-3 py-1.5 rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-card-hover)] transition-colors"
              >
                Полная загрузка
              </button>
            </>
          )}
        </div>
      </div>
      {(isSyncing || isDone) && (
        <div className="w-full bg-[var(--border)] rounded-full h-2 overflow-hidden">
          {isSyncing && pct === 0 ? (
            <div className="h-full bg-green-500 rounded-full animate-progress-indeterminate" />
          ) : (
            <div
              className="h-full bg-green-500 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${isDone ? 100 : pct}%` }}
            />
          )}
        </div>
      )}
    </div>
  );
}

const TABS = [
  { href: "/reviews", label: "Отзывы" },
  { href: "/reviews/accounts", label: "Аккаунты WB" },
];

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

export default function ReviewsPage() {
  const [filters, setFilters] = useState<ReviewFilterValues>(emptyFilters);
  const [rows, setRows] = useState<ReviewRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [loading, setLoading] = useState(true);
  const [synced, setSynced] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [complainingId, setComplainingId] = useState<number | null>(null);

  const fetchData = useCallback(async (sync: false | "true" | "full" = false) => {
    setLoading(true);
    if (sync) setSyncing(true);
    const params = new URLSearchParams();
    params.set("page", String(page));
    params.set("per_page", "100");
    params.set("sort_by", sortBy);
    params.set("sort_dir", sortDir);
    if (sync) params.set("sync", sync);

    for (const [k, v] of Object.entries(filters)) {
      if (v) params.set(k, v);
    }

    try {
      const res = await fetch(`/api/reviews?${params}`);
      const data = await res.json();
      setRows(data.rows || []);
      setTotal(data.total || 0);
    } catch (e) {
      console.error("Failed to fetch reviews:", e);
    } finally {
      setLoading(false);
      if (sync) setSyncing(false);
    }
  }, [page, sortBy, sortDir, filters]);

  // Load data from DB on first render + sync complaint statuses
  useEffect(() => {
    if (!synced) {
      setSynced(true);
      // Sync complaint statuses from WB in background
      fetch("/api/reviews/complaints?sync=true").catch(() => {});
      fetchData(false);
    }
  }, [synced, fetchData]);

  // Refetch on filter/sort/page change (no sync)
  useEffect(() => {
    if (synced) fetchData(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, sortBy, sortDir, filters]);

  function handleSort(col: string) {
    if (sortBy === col) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortBy(col);
      setSortDir("desc");
    }
  }

  function handleStatusChange(id: number, status: string) {
    fetch(`/api/reviews/${id}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }).then(() => {
      setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    });
  }

  function handleComplaint(id: number) {
    setComplainingId(id);
    fetch("/api/reviews/complaints", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ review_id: id }),
    }).then(async (res) => {
      const data = await res.json();
      if (res.ok) {
        setRows((prev) => prev.map((r) => (r.id === id ? { ...r, complaint_status: "submitted" } : r)));
      } else {
        alert(data.error || "Ошибка при подаче жалобы");
      }
    }).catch(() => alert("Ошибка сети"))
      .finally(() => setComplainingId(null));
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Отзывы</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">Управление отзывами Wildberries</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[var(--bg-card)] rounded-lg p-1 border border-[var(--border)] w-fit">
        {TABS.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "px-4 py-2 rounded-md text-sm font-medium transition-colors",
              tab.href === "/reviews"
                ? "bg-[var(--accent)] text-white"
                : "text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-card-hover)]"
            )}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {/* Filters */}
      <ReviewsFilters
        filters={filters}
        onChange={setFilters}
        onApply={() => { setPage(1); fetchData(false); }}
        onRefresh={() => fetchData("true")}
      />

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-[var(--text-muted)]">Загрузка...</div>
      ) : (
        <ReviewsTable
          rows={rows}
          total={total}
          page={page}
          perPage={100}
          sortBy={sortBy}
          sortDir={sortDir}
          onSort={handleSort}
          onPageChange={setPage}
          onStatusChange={handleStatusChange}
          onComplaint={handleComplaint}
          complainingId={complainingId}
        />
      )}
    </div>
  );
}
