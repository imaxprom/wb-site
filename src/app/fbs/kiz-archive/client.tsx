"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Archive,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Eye,
  FileCheck2,
  LockKeyhole,
  QrCode,
  RefreshCw,
  ScanLine,
  Search,
  ShieldCheck,
  TriangleAlert,
  X,
} from "lucide-react";
import type {
  FbsKizArchiveEvent,
  FbsKizArchiveProduct,
  FbsKizArchiveSnapshot,
  FbsKizVerificationStatus,
} from "@/lib/fbs-kiz-archive";

type ScanResult = {
  duplicate: boolean;
  item: {
    archiveId: number;
    unitRef: string;
    codeTail: string;
    nmId: number;
    vendorCode: string;
    productName: string;
    sizeName: string;
    wbSize: string;
    russianSize: string;
    barcode: string;
    verificationStatus: FbsKizVerificationStatus;
    verificationMessage: string;
  };
};

const EMPTY: FbsKizArchiveSnapshot = {
  summary: { total: 0, onlineVerified: 0, formatVerified: 0, errors24h: 0 },
  onlineVerificationConfigured: false,
  products: [],
  events: [],
};

const STATUS_LABELS: Record<FbsKizVerificationStatus, string> = {
  online_verified: "Подтверждён TrueAPI",
  format_verified: "Формат проверен",
  error: "Ошибка",
};

function formatNumber(value: number) {
  return new Intl.NumberFormat("ru-RU").format(value);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function errorText(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object" && "error" in payload) return String((payload as { error?: unknown }).error || fallback);
  return fallback;
}

function StatusPill({ status }: { status: FbsKizVerificationStatus }) {
  const className = status === "online_verified"
    ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
    : status === "format_verified"
      ? "border-amber-500/25 bg-amber-500/10 text-amber-400"
      : "border-red-500/25 bg-red-500/10 text-red-400";
  return <span className={`inline-flex min-h-8 items-center rounded-lg border px-3 text-sm font-semibold ${className}`}>{STATUS_LABELS[status]}</span>;
}

export function KizArchiveClient() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [snapshot, setSnapshot] = useState<FbsKizArchiveSnapshot>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [result, setResult] = useState<ScanResult | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [details, setDetails] = useState<FbsKizArchiveEvent | null>(null);

  useEffect(() => {
    const existed = document.documentElement.classList.contains("fbs-readable-ui");
    document.documentElement.classList.add("fbs-readable-ui");
    return () => {
      if (!existed) document.documentElement.classList.remove("fbs-readable-ui");
    };
  }, []);

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true);
    else setLoading(true);
    try {
      const response = await fetch("/api/fbs/kiz-archive", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorText(payload, "Не удалось загрузить архив КИЗ"));
      const next = (payload as { snapshot?: FbsKizArchiveSnapshot }).snapshot || EMPTY;
      setSnapshot(next);
      setExpanded((current) => {
        if (current.size || !next.products.length) return current;
        const first = next.products.find((product) => product.total > 0) || next.products[0];
        return new Set([first.nmId]);
      });
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!loading) inputRef.current?.focus(); }, [loading]);

  const filteredProducts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return snapshot.products;
    return snapshot.products.filter((product) =>
      [String(product.nmId), product.vendorCode, product.productName].some((field) => field.toLowerCase().includes(normalized)),
    );
  }, [query, snapshot.products]);

  function toggleProduct(nmId: number) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(nmId)) next.delete(nmId);
      else next.add(nmId);
      return next;
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!value || saving) return;
    setSaving(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/fbs/kiz-archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorText(payload, "КИЗ не удалось сохранить"));
      const typed = payload as { result: ScanResult; snapshot: FbsKizArchiveSnapshot };
      setResult(typed.result);
      setSnapshot(typed.snapshot);
      setExpanded((current) => new Set([...current, typed.result.item.nmId]));
      setValue("");
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : String(scanError));
    } finally {
      setSaving(false);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  return <main className="mx-auto max-w-[1540px] space-y-5 pb-14">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="flex items-center gap-3 text-2xl font-bold"><Archive className="text-[var(--accent)]" size={30} /> Архив нанесённых КИЗ</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Проверка и защищённый учёт нанесённой маркировки по артикулам и размерам</p>
      </div>
      <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 text-sm text-[var(--text-muted)]">
        <LockKeyhole size={20} className="text-emerald-400" />
        <span>Полный код зашифрован · перепечатка недоступна</span>
      </div>
    </header>

    {!snapshot.onlineVerificationConfigured && !loading && <section className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4">
      <TriangleAlert className="mt-0.5 shrink-0 text-amber-400" size={24} />
      <div><div className="font-semibold text-amber-400">Онлайн-проверка TrueAPI пока не подключена</div><div className="mt-1 text-sm text-[var(--text-muted)]">Система проверяет полный формат Data Matrix, контрольную цифру GTIN и точное соответствие артикулу и размеру. Онлайн-подтверждение будет отображаться отдельно после подключения TrueAPI.</div></div>
    </section>}

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4"><div className="text-sm text-[var(--text-muted)]">Всего в архиве</div><div className="mt-1 text-3xl font-bold">{formatNumber(snapshot.summary.total)}</div></div>
      <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4"><div className="text-sm text-[var(--text-muted)]">Подтверждено TrueAPI</div><div className="mt-1 text-3xl font-bold text-emerald-400">{formatNumber(snapshot.summary.onlineVerified)}</div></div>
      <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4"><div className="text-sm text-[var(--text-muted)]">Проверен формат</div><div className="mt-1 text-3xl font-bold text-amber-400">{formatNumber(snapshot.summary.formatVerified)}</div></div>
      <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4"><div className="text-sm text-[var(--text-muted)]">Ошибки за 24 часа</div><div className="mt-1 text-3xl font-bold text-red-400">{formatNumber(snapshot.summary.errors24h)}</div></div>
    </section>

    <section className="rounded-2xl border border-[var(--accent)]/35 bg-[var(--bg-card)] p-5 shadow-[0_0_28px_rgba(124,58,237,0.08)]">
      <div className="grid items-center gap-5 lg:grid-cols-[minmax(0,1fr)_390px]">
        <div>
          <div className="flex items-center gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--accent)]/15 text-[var(--accent)]"><ScanLine size={27} /></span><div><h2 className="text-xl font-bold">Отсканируйте нанесённый Data Matrix</h2><p className="text-sm text-[var(--text-muted)]">Артикул и размер определятся автоматически по GTIN.</p></div></div>
          <form onSubmit={submit} className="mt-4 flex gap-3">
            <input ref={inputRef} value={value} onChange={(event) => setValue(event.target.value)} disabled={saving} className="min-h-14 min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 font-mono text-sm outline-none transition focus:border-[var(--accent)] disabled:opacity-60" placeholder="Поле готово к сканированию" autoComplete="off" />
            <button type="submit" disabled={!value || saving} className="min-h-14 shrink-0 rounded-xl bg-[var(--accent)] px-6 font-semibold text-white transition hover:brightness-110 disabled:opacity-45">{saving ? "Проверяем…" : "Проверить и сохранить"}</button>
          </form>
        </div>

        <div className={`flex min-h-[128px] items-center rounded-xl border p-4 ${error ? "border-red-500/30 bg-red-500/10" : result ? (result.item.verificationStatus === "online_verified" ? "border-emerald-500/30 bg-emerald-500/10" : "border-amber-500/30 bg-amber-500/10") : "border-[var(--border)] bg-[var(--bg)]"}`}>
          {saving ? <div className="flex items-center gap-3"><RefreshCw size={30} className="animate-spin text-[var(--accent)]" /><div><div className="font-semibold">Проверяем КИЗ</div><div className="text-sm text-[var(--text-muted)]">Формат, GTIN, товар и размер</div></div></div>
            : error ? <div className="flex items-start gap-3"><TriangleAlert size={30} className="mt-0.5 shrink-0 text-red-400" /><div><div className="font-semibold text-red-400">КИЗ не сохранён</div><div className="mt-1 text-sm text-[var(--text-muted)]">{error}</div></div></div>
              : result ? <div className="w-full"><div className={`flex items-center gap-2 font-semibold ${result.item.verificationStatus === "online_verified" ? "text-emerald-400" : "text-amber-400"}`}><CheckCircle2 size={25} />{result.duplicate ? "КИЗ уже был в архиве" : "КИЗ проверен и сохранён"}</div><div className="mt-2 text-sm">WB {result.item.nmId} · {result.item.wbSize} / {result.item.russianSize}</div><div className="text-sm text-[var(--text-muted)]">{result.item.unitRef}</div></div>
                : <div className="flex items-center gap-3 text-[var(--text-muted)]"><QrCode size={30} /><div><div className="font-semibold text-[var(--text)]">Ожидаем код</div><div className="text-sm">Сканер уже в фокусе</div></div></div>}
        </div>
      </div>
    </section>

    <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] p-4">
        <div><h2 className="text-xl font-bold">Артикулы и размеры</h2><p className="text-sm text-[var(--text-muted)]">Размерная сетка загружена из данных выбранного юрлица.</p></div>
        <div className="flex w-full max-w-[560px] gap-2">
          <label className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4"><Search size={20} className="text-[var(--text-muted)]" /><input value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent outline-none" placeholder="Артикул WB или название" /></label>
          <button type="button" onClick={() => void load(true)} disabled={refreshing} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] transition hover:bg-[var(--bg-card-hover)] disabled:opacity-50" aria-label="Обновить архив"><RefreshCw size={21} className={refreshing ? "animate-spin" : ""} /></button>
        </div>
      </div>

      {loading ? <div className="flex min-h-48 items-center justify-center gap-3 text-[var(--text-muted)]"><RefreshCw className="animate-spin" /> Загружаем товары…</div>
        : filteredProducts.length === 0 ? <div className="flex min-h-48 flex-col items-center justify-center px-4 text-center"><Archive size={34} className="text-[var(--text-muted)]" /><div className="mt-3 font-semibold">Подходящие товары не найдены</div><div className="mt-1 text-sm text-[var(--text-muted)]">Измените поиск или обновите каталог FBS.</div></div>
          : <div className="divide-y divide-[var(--border)]">{filteredProducts.map((product) => <ProductBlock key={product.nmId} product={product} expanded={expanded.has(product.nmId)} onToggle={() => toggleProduct(product.nmId)} />)}</div>}
    </section>

    <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] p-4"><div><h2 className="text-xl font-bold">Последние сканирования</h2><p className="text-sm text-[var(--text-muted)]">Полный код скрыт; отображается только контрольный хвост.</p></div><FileCheck2 className="text-[var(--accent)]" size={28} /></div>
      {snapshot.events.length === 0 ? <div className="flex min-h-36 items-center justify-center text-[var(--text-muted)]">В журнале пока нет сканирований</div> : <div className="overflow-x-auto"><div className="min-w-[1120px]">
        <div className="grid grid-cols-[160px_minmax(320px,1fr)_135px_160px_210px_140px_70px] gap-3 bg-[var(--bg)] px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"><span>КИЗ</span><span className="text-left">Товар</span><span>Размер WB</span><span>Размер</span><span>Результат</span><span>Время</span><span /></div>
        {snapshot.events.map((event) => <div key={event.id} className="grid grid-cols-[160px_minmax(320px,1fr)_135px_160px_210px_140px_70px] items-center gap-3 border-t border-[var(--border)] px-4 py-3 text-center"><span className="font-mono text-sm">{event.codeTail}</span><span className="text-left">{event.nmId ? <strong className="block">WB {event.nmId}</strong> : <strong className="block text-red-400">Не определён</strong>}<span className="block text-sm text-[var(--text-muted)]">{event.productName || event.message}</span></span><strong>{event.wbSize || "—"}</strong><span>{event.russianSize || "—"}</span><span><StatusPill status={event.verificationStatus} /></span><span>{formatDate(event.createdAt)}</span><button type="button" onClick={() => setDetails(event)} className="flex h-10 w-10 items-center justify-center justify-self-center rounded-lg border border-[var(--border)] transition hover:border-[var(--accent)] hover:bg-[var(--accent)]/10" aria-label="Открыть запись журнала"><Eye size={20} /></button></div>)}
      </div></div>}
    </section>

    {details && <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={() => setDetails(null)}><aside className="h-full w-full max-w-[560px] overflow-y-auto border-l border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-4"><div><div className="text-sm font-semibold text-[var(--accent)]">ЗАПИСЬ ЖУРНАЛА</div><h3 className="mt-1 text-xl font-bold">{details.codeTail}</h3></div><button type="button" onClick={() => setDetails(null)} className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border)] transition hover:bg-[var(--bg-card-hover)]"><X size={22} /></button></div>
      <div className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4"><div className="flex items-center gap-3"><ShieldCheck className="text-[var(--accent)]" size={28} /><div><div className="font-semibold">Полный код недоступен в интерфейсе</div><div className="text-sm text-[var(--text-muted)]">Он хранится в зашифрованном виде и не может быть перепечатан.</div></div></div></div>
      <dl className="mt-5 divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">{[
        ["Артикул WB", details.nmId ? String(details.nmId) : "Не определён"],
        ["Товар", details.productName || "—"],
        ["Размер", details.sizeName || "—"],
        ["Результат", STATUS_LABELS[details.verificationStatus]],
        ["Сотрудник", details.operator],
        ["Дата", formatDate(details.createdAt)],
      ].map(([label, text]) => <div key={label} className="grid grid-cols-[180px_1fr] gap-4 px-4 py-3"><dt className="text-sm text-[var(--text-muted)]">{label}</dt><dd className="font-medium">{text}</dd></div>)}</dl>
      <div className={`mt-5 rounded-xl border p-4 ${details.verificationStatus === "error" ? "border-red-500/30 bg-red-500/10" : "border-[var(--border)] bg-[var(--bg)]"}`}><div className="font-semibold">Результат проверки</div><div className="mt-1 text-sm text-[var(--text-muted)]">{details.message}</div></div>
    </aside></div>}
  </main>;
}

function ProductBlock({ product, expanded, onToggle }: { product: FbsKizArchiveProduct; expanded: boolean; onToggle: () => void }) {
  return <div>
    <button type="button" onClick={onToggle} className="grid w-full items-center gap-4 px-4 py-4 text-left transition hover:bg-[var(--bg-card-hover)] md:grid-cols-[34px_minmax(330px,1fr)_150px_170px]">
      <span className="text-[var(--text-muted)]">{expanded ? <ChevronDown size={24} /> : <ChevronRight size={24} />}</span>
      <span><strong className="block text-lg">WB {product.nmId}</strong><span className="block text-sm text-[var(--text-muted)]">{product.productName} · {product.vendorCode}</span></span>
      <span><strong className="block text-xl">{product.sizes.length}</strong><span className="text-sm text-[var(--text-muted)]">размеров</span></span>
      <span><strong className="block text-xl">{product.total}</strong><span className="text-sm text-[var(--text-muted)]">КИЗ в архиве</span></span>
    </button>
    {expanded && <div className="overflow-x-auto border-t border-[var(--border)] bg-[var(--bg)]/55"><div className="min-w-[930px]">
      <div className="grid grid-cols-[150px_160px_minmax(250px,1fr)_130px_160px_160px] gap-3 px-5 py-3 text-center text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"><span>Размер WB</span><span>Размер</span><span>ШК товара</span><span>Всего</span><span>TrueAPI</span><span>Формат</span></div>
      {product.sizes.map((size) => <div key={`${product.nmId}-${size.barcode}`} className="grid grid-cols-[150px_160px_minmax(250px,1fr)_130px_160px_160px] items-center gap-3 border-t border-[var(--border)]/70 px-5 py-3 text-center"><strong>{size.wbSize}</strong><span>{size.russianSize}</span><span className="font-mono text-sm">{size.barcode}</span><strong>{size.total}</strong><span className={size.onlineVerified ? "font-semibold text-emerald-400" : "text-[var(--text-muted)]"}>{size.onlineVerified}</span><span className={size.formatVerified ? "font-semibold text-amber-400" : "text-[var(--text-muted)]"}>{size.formatVerified}</span></div>)}
    </div></div>}
  </div>;
}
