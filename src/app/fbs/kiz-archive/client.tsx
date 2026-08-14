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
  Printer,
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
  FbsKizArchiveSize,
  FbsKizArchiveSnapshot,
  FbsKizMappingCandidate,
  FbsKizPrintBatch,
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
  summary: { total: 0, available: 0, reserved: 0, printed: 0, onlineVerified: 0, formatVerified: 0, errors24h: 0 },
  onlineVerificationConfigured: false,
  products: [],
  printBatches: [],
  events: [],
};

type PrintSelection = { product: FbsKizArchiveProduct; size: FbsKizArchiveSize };
type MappingRequest = { gtin: string; candidates: FbsKizMappingCandidate[] };

const STATUS_LABELS: Record<FbsKizVerificationStatus, string> = {
  online_verified: "Подтверждён TrueAPI",
  format_verified: "Формат проверен",
  error: "Ошибка",
};

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
  const selectScanValueOnFocusRef = useRef(false);
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
  const [printSelection, setPrintSelection] = useState<PrintSelection | null>(null);
  const [printQuantity, setPrintQuantity] = useState(1);
  const [printBusy, setPrintBusy] = useState(false);
  const [printError, setPrintError] = useState("");
  const [recoveryBatch, setRecoveryBatch] = useState<FbsKizPrintBatch | null>(null);
  const [lastPrintedPosition, setLastPrintedPosition] = useState(0);
  const [mappingRequest, setMappingRequest] = useState<MappingRequest | null>(null);
  const [mappingQuery, setMappingQuery] = useState("");
  const [selectedMappingKey, setSelectedMappingKey] = useState("");
  const [mappingError, setMappingError] = useState("");

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
  useEffect(() => {
    if (loading || saving || printSelection || recoveryBatch || mappingRequest) return;
    const frame = window.requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input || input.disabled) return;
      input.focus({ preventScroll: true });
      if (selectScanValueOnFocusRef.current && input.value) input.select();
      selectScanValueOnFocusRef.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [loading, saving, printSelection, recoveryBatch, mappingRequest]);

  const activePrintBatches = useMemo(
    () => snapshot.printBatches.filter((batch) => ["queued", "printing", "paused"].includes(batch.status)),
    [snapshot.printBatches],
  );

  useEffect(() => {
    if (!activePrintBatches.length) return;
    const timer = window.setInterval(() => void load(true), 2000);
    return () => window.clearInterval(timer);
  }, [activePrintBatches.length, load]);

  const filteredProducts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return snapshot.products;
    return snapshot.products.filter((product) =>
      [String(product.nmId), product.vendorCode, product.productName].some((field) => field.toLowerCase().includes(normalized)),
    );
  }, [query, snapshot.products]);

  const filteredMappingCandidates = useMemo(() => {
    if (!mappingRequest) return [];
    const normalized = mappingQuery.trim().toLowerCase();
    if (!normalized) return mappingRequest.candidates;
    return mappingRequest.candidates.filter((candidate) => [
      String(candidate.nmId),
      candidate.vendorCode,
      candidate.productName,
      candidate.sizeName,
      candidate.wbSize,
      candidate.russianSize,
      candidate.barcode,
    ].some((field) => field.toLowerCase().includes(normalized)));
  }, [mappingQuery, mappingRequest]);

  function toggleProduct(nmId: number) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(nmId)) next.delete(nmId);
      else next.add(nmId);
      return next;
    });
  }

  function openPrint(product: FbsKizArchiveProduct, size: FbsKizArchiveSize) {
    setPrintSelection({ product, size });
    setPrintQuantity(Math.min(Math.max(size.available, 1), 40));
    setPrintError("");
  }

  async function createPrintBatch() {
    if (!printSelection || printBusy) return;
    setPrintBusy(true);
    setPrintError("");
    try {
      const response = await fetch("/api/fbs/kiz-archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create_print_batch",
          nmId: printSelection.product.nmId,
          barcode: printSelection.size.barcode,
          quantity: printQuantity,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorText(payload, "Не удалось создать пачку КИЗ"));
      setSnapshot((payload as { snapshot: FbsKizArchiveSnapshot }).snapshot);
      setPrintSelection(null);
    } catch (printFailure) {
      setPrintError(printFailure instanceof Error ? printFailure.message : String(printFailure));
    } finally {
      setPrintBusy(false);
    }
  }

  function openRecovery(batch: FbsKizPrintBatch) {
    setRecoveryBatch(batch);
    setLastPrintedPosition(batch.printed);
    setPrintError("");
  }

  async function resumePrintBatch() {
    if (!recoveryBatch || printBusy) return;
    setPrintBusy(true);
    setPrintError("");
    try {
      const response = await fetch("/api/fbs/kiz-archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "resume_print_batch", jobId: recoveryBatch.jobId, lastPrintedPosition }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorText(payload, "Не удалось продолжить печать"));
      setSnapshot((payload as { snapshot: FbsKizArchiveSnapshot }).snapshot);
      setRecoveryBatch(null);
    } catch (recoveryFailure) {
      setPrintError(recoveryFailure instanceof Error ? recoveryFailure.message : String(recoveryFailure));
    } finally {
      setPrintBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!value || saving) return;
    selectScanValueOnFocusRef.current = false;
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
      if (
        response.status === 409
        && payload
        && typeof payload === "object"
        && (payload as { code?: unknown }).code === "kiz_gtin_mapping_required"
      ) {
        const typed = payload as { gtin?: unknown; candidates?: unknown };
        setMappingRequest({
          gtin: String(typed.gtin || ""),
          candidates: Array.isArray(typed.candidates) ? typed.candidates as FbsKizMappingCandidate[] : [],
        });
        setMappingQuery("");
        setSelectedMappingKey("");
        setMappingError("");
        return;
      }
      if (!response.ok) throw new Error(errorText(payload, "КИЗ не удалось сохранить"));
      const typed = payload as { result: ScanResult; snapshot: FbsKizArchiveSnapshot };
      setResult(typed.result);
      setSnapshot(typed.snapshot);
      setExpanded((current) => new Set([...current, typed.result.item.nmId]));
      setValue("");
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : String(scanError));
      selectScanValueOnFocusRef.current = true;
    } finally {
      setSaving(false);
    }
  }

  async function mapAndSave() {
    if (!mappingRequest || !selectedMappingKey || saving) return;
    const selected = mappingRequest.candidates.find((candidate) => `${candidate.nmId}:${candidate.barcode}` === selectedMappingKey);
    if (!selected) return setMappingError("Выберите товар и размер из списка");
    setSaving(true);
    setMappingError("");
    try {
      const response = await fetch("/api/fbs/kiz-archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "map_and_scan",
          value,
          nmId: selected.nmId,
          barcode: selected.barcode,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(errorText(payload, "Не удалось сохранить сопоставление GTIN"));
      const typed = payload as { result: ScanResult; snapshot: FbsKizArchiveSnapshot };
      setResult(typed.result);
      setSnapshot(typed.snapshot);
      setExpanded((current) => new Set([...current, typed.result.item.nmId]));
      setValue("");
      setMappingRequest(null);
      setSelectedMappingKey("");
      setMappingQuery("");
    } catch (mappingFailure) {
      setMappingError(mappingFailure instanceof Error ? mappingFailure.message : String(mappingFailure));
    } finally {
      setSaving(false);
    }
  }

  function closeMapping() {
    if (saving) return;
    setMappingRequest(null);
    setSelectedMappingKey("");
    setMappingQuery("");
    setMappingError("");
    setValue("");
  }

  return <main className="mx-auto max-w-[1540px] space-y-5 pb-14">
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="flex items-center gap-3 text-2xl font-bold"><Archive className="text-[var(--accent)]" size={30} /> Архив нанесённых КИЗ</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">Проверка и защищённый учёт нанесённой маркировки по артикулам и размерам</p>
      </div>
      <div className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 text-sm text-[var(--text-muted)]">
        <LockKeyhole size={20} className="text-emerald-400" />
        <span>Полный код зашифрован · после печати уничтожается</span>
      </div>
    </header>

    <section className="rounded-2xl border border-[var(--accent)]/35 bg-[var(--bg-card)] p-5 shadow-[0_0_28px_rgba(124,58,237,0.08)]">
      <div className="grid items-center gap-5 lg:grid-cols-[minmax(0,1fr)_390px]">
        <div>
          <div className="flex items-center gap-3"><span className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--accent)]/15 text-[var(--accent)]"><ScanLine size={27} /></span><h2 className="text-xl font-bold">Отсканируйте нанесённый Data Matrix</h2></div>
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

    {activePrintBatches.length > 0 && <section className="overflow-hidden rounded-2xl border border-amber-500/30 bg-[var(--bg-card)]">
      <div className="flex items-center gap-3 border-b border-[var(--border)] p-4"><Printer className="text-amber-400" size={27} /><div><h2 className="text-xl font-bold">Печать КИЗ</h2><p className="text-sm text-[var(--text-muted)]">Прогресс обновляется автоматически.</p></div></div>
      <div className="divide-y divide-[var(--border)]">{activePrintBatches.map((batch) => {
        const percent = batch.total ? Math.round(batch.printed * 100 / batch.total) : 0;
        return <div key={batch.jobId} className="grid items-center gap-4 p-4 lg:grid-cols-[minmax(260px,1fr)_minmax(280px,1.2fr)_190px]">
          <div><strong className="block">WB {batch.nmId} · {batch.sizeName}</strong><span className="text-sm text-[var(--text-muted)]">{batch.productName}</span></div>
          <div><div className="mb-2 flex justify-between text-sm"><span>{batch.status === "paused" ? "Печать остановлена" : batch.status === "queued" ? "Ожидает принтер" : "Печатается"}</span><strong>{batch.printed} из {batch.total}</strong></div><div className="h-3 overflow-hidden rounded-full bg-[var(--bg)]"><div className={`h-full transition-all ${batch.status === "paused" ? "bg-red-500" : "bg-amber-400"}`} style={{ width: `${percent}%` }} /></div>{batch.lastError && <div className="mt-2 text-sm text-red-400">{batch.lastError}</div>}</div>
          {batch.status === "paused" ? <button type="button" onClick={() => openRecovery(batch)} className="min-h-12 rounded-xl bg-red-500 px-4 font-semibold text-white transition hover:brightness-110">Восстановить печать</button> : <div className="flex min-h-12 items-center justify-center gap-2 rounded-xl border border-[var(--border)] text-[var(--text-muted)]"><RefreshCw size={19} className="animate-spin" /> {batch.printed}/{batch.total}</div>}
        </div>;
      })}</div>
    </section>}

    <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] p-4">
        <h2 className="text-xl font-bold">Артикулы и размеры</h2>
        <div className="flex w-full max-w-[560px] gap-2">
          <label className="flex min-h-12 min-w-0 flex-1 items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4"><Search size={20} className="text-[var(--text-muted)]" /><input value={query} onChange={(event) => setQuery(event.target.value)} className="min-w-0 flex-1 bg-transparent outline-none" placeholder="Артикул WB или название" /></label>
          <button type="button" onClick={() => void load(true)} disabled={refreshing} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] transition hover:bg-[var(--bg-card-hover)] disabled:opacity-50" aria-label="Обновить архив"><RefreshCw size={21} className={refreshing ? "animate-spin" : ""} /></button>
        </div>
      </div>

      {loading ? <div className="flex min-h-48 items-center justify-center gap-3 text-[var(--text-muted)]"><RefreshCw className="animate-spin" /> Загружаем товары…</div>
        : filteredProducts.length === 0 ? <div className="flex min-h-48 flex-col items-center justify-center px-4 text-center"><Archive size={34} className="text-[var(--text-muted)]" /><div className="mt-3 font-semibold">Подходящие товары не найдены</div><div className="mt-1 text-sm text-[var(--text-muted)]">Измените поиск или обновите каталог FBS.</div></div>
          : <div className="divide-y divide-[var(--border)]">{filteredProducts.map((product) => <ProductBlock key={product.nmId} product={product} expanded={expanded.has(product.nmId)} onToggle={() => toggleProduct(product.nmId)} onPrint={(size) => openPrint(product, size)} />)}</div>}
    </section>

    <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-card)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] p-4"><div><h2 className="text-xl font-bold">Последние сканирования</h2><p className="text-sm text-[var(--text-muted)]">Полный код скрыт; отображается только контрольный хвост.</p></div><FileCheck2 className="text-[var(--accent)]" size={28} /></div>
      {snapshot.events.length === 0 ? <div className="flex min-h-36 items-center justify-center text-[var(--text-muted)]">В журнале пока нет сканирований</div> : <div className="overflow-x-auto"><div className="min-w-[1120px]">
        <div className="grid grid-cols-[160px_minmax(320px,1fr)_135px_160px_210px_140px_70px] gap-3 bg-[var(--bg)] px-4 py-3 text-center text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"><span>КИЗ</span><span className="text-left">Товар</span><span>Размер WB</span><span>Размер</span><span>Результат</span><span>Время</span><span /></div>
        {snapshot.events.map((event) => <div key={event.id} className="grid grid-cols-[160px_minmax(320px,1fr)_135px_160px_210px_140px_70px] items-center gap-3 border-t border-[var(--border)] px-4 py-3 text-center"><span className="font-mono text-sm">{event.codeTail}</span><span className="text-left">{event.nmId ? <strong className="block">WB {event.nmId}</strong> : <strong className="block text-red-400">Не определён</strong>}<span className="block text-sm text-[var(--text-muted)]">{event.productName || event.message}</span></span><strong>{event.wbSize || "—"}</strong><span>{event.russianSize || "—"}</span><span><StatusPill status={event.verificationStatus} /></span><span>{formatDate(event.createdAt)}</span><button type="button" onClick={() => setDetails(event)} className="flex h-10 w-10 items-center justify-center justify-self-center rounded-lg border border-[var(--border)] transition hover:border-[var(--accent)] hover:bg-[var(--accent)]/10" aria-label="Открыть запись журнала"><Eye size={20} /></button></div>)}
      </div></div>}
    </section>

    {mappingRequest && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={closeMapping}><div className="flex max-h-[88vh] w-full max-w-[860px] flex-col overflow-hidden rounded-2xl border border-amber-500/35 bg-[var(--bg-card)] shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] p-5"><div><div className="text-sm font-semibold text-amber-400">ПЕРВОЕ СОПОСТАВЛЕНИЕ GTIN</div><h3 className="mt-1 text-xl font-bold">Выберите товар и размер</h3><p className="mt-1 text-sm text-[var(--text-muted)]">GTIN {mappingRequest.gtin} будет запомнен для всех следующих КИЗ этого вида.</p></div><button type="button" disabled={saving} onClick={closeMapping} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--border)] transition hover:bg-[var(--bg-card-hover)] disabled:opacity-40"><X size={22} /></button></div>
      <div className="p-5 pb-3"><div className="rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm"><strong className="text-amber-400">Проверьте выбор внимательно.</strong><span className="ml-1 text-[var(--text-muted)]">Сопоставление создаётся один раз и применяется автоматически к следующим кодам с таким GTIN.</span></div><label className="mt-4 flex min-h-12 items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4"><Search size={20} className="text-[var(--text-muted)]" /><input value={mappingQuery} onChange={(event) => setMappingQuery(event.target.value)} autoFocus className="min-w-0 flex-1 bg-transparent outline-none" placeholder="Артикул WB, название или размер" /></label></div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4"><div className="overflow-hidden rounded-xl border border-[var(--border)]">{filteredMappingCandidates.length === 0 ? <div className="p-8 text-center text-[var(--text-muted)]">Подходящий товар не найден</div> : filteredMappingCandidates.map((candidate) => {
        const key = `${candidate.nmId}:${candidate.barcode}`;
        const selected = key === selectedMappingKey;
        return <button type="button" key={key} onClick={() => setSelectedMappingKey(key)} className={`grid w-full items-center gap-3 border-b border-[var(--border)] p-4 text-left transition last:border-0 md:grid-cols-[minmax(260px,1fr)_140px_150px] ${selected ? "bg-[var(--accent)]/15 ring-1 ring-inset ring-[var(--accent)]" : "hover:bg-[var(--bg-card-hover)]"}`}><span><strong className="block">WB {candidate.nmId}</strong><span className="block text-sm text-[var(--text-muted)]">{candidate.productName} · {candidate.vendorCode}</span></span><span><strong className="block">{candidate.wbSize || "—"}</strong><span className="text-sm text-[var(--text-muted)]">Размер WB</span></span><span><strong className="block">{candidate.russianSize || candidate.sizeName || "—"}</strong><span className="text-sm text-[var(--text-muted)]">Размер</span></span></button>;
      })}</div></div>
      <div className="border-t border-[var(--border)] p-5">{mappingError && <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-400">{mappingError}</div>}<div className="flex gap-3"><button type="button" disabled={saving} onClick={closeMapping} className="min-h-12 flex-1 rounded-xl border border-[var(--border)] font-semibold transition hover:bg-[var(--bg-card-hover)] disabled:opacity-40">Отмена</button><button type="button" disabled={saving || !selectedMappingKey} onClick={() => void mapAndSave()} className="flex min-h-12 flex-[1.6] items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-5 font-semibold text-white transition hover:brightness-110 disabled:opacity-40">{saving ? <RefreshCw className="animate-spin" size={20} /> : <CheckCircle2 size={20} />} Связать и сохранить КИЗ</button></div></div>
    </div></div>}

    {printSelection && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4" onClick={() => !printBusy && setPrintSelection(null)}><div className="w-full max-w-[560px] rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-4"><div><div className="text-sm font-semibold text-[var(--accent)]">ПЕЧАТЬ КИЗ</div><h3 className="mt-1 text-xl font-bold">WB {printSelection.product.nmId} · {printSelection.size.russianSize}</h3><div className="mt-1 text-sm text-[var(--text-muted)]">Доступно: {printSelection.size.available}</div></div><button type="button" disabled={printBusy} onClick={() => setPrintSelection(null)} className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border)] transition hover:bg-[var(--bg-card-hover)] disabled:opacity-40"><X size={22} /></button></div>
      <label className="mt-5 block"><span className="text-sm font-semibold">Количество этикеток</span><input type="number" min={1} max={Math.min(500, printSelection.size.available)} value={printQuantity} onChange={(event) => setPrintQuantity(Number(event.target.value))} autoFocus className="mt-2 h-14 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 text-2xl font-bold outline-none focus:border-[var(--accent)]" /></label>
      <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/10 p-4 text-sm text-[var(--text-muted)]">Система зарезервирует {printQuantity || 0} уникальных КИЗ. После подтверждённой печати они исчезнут из доступного остатка.</div>
      {printError && <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">{printError}</div>}
      <div className="mt-5 flex gap-3"><button type="button" disabled={printBusy} onClick={() => setPrintSelection(null)} className="min-h-12 flex-1 rounded-xl border border-[var(--border)] font-semibold transition hover:bg-[var(--bg-card-hover)] disabled:opacity-40">Отмена</button><button type="button" disabled={printBusy || printQuantity < 1 || printQuantity > printSelection.size.available || printQuantity > 500} onClick={() => void createPrintBatch()} className="flex min-h-12 flex-[1.4] items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-5 font-semibold text-white transition hover:brightness-110 disabled:opacity-40">{printBusy ? <RefreshCw className="animate-spin" size={20} /> : <Printer size={20} />} Печатать {printQuantity || 0}</button></div>
    </div></div>}

    {recoveryBatch && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-4" onClick={() => !printBusy && setRecoveryBatch(null)}><div className="w-full max-w-[620px] rounded-2xl border border-red-500/35 bg-[var(--bg-card)] p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-4"><div><div className="text-sm font-semibold text-red-400">ВОССТАНОВЛЕНИЕ ПЕЧАТИ</div><h3 className="mt-1 text-xl font-bold">WB {recoveryBatch.nmId} · {recoveryBatch.sizeName}</h3></div><button type="button" disabled={printBusy} onClick={() => setRecoveryBatch(null)} className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border)] transition hover:bg-[var(--bg-card-hover)]"><X size={22} /></button></div>
      <div className="mt-4 rounded-xl border border-red-500/25 bg-red-500/10 p-4"><strong className="block text-red-400">Проверьте физические этикетки</strong><span className="mt-1 block text-sm text-[var(--text-muted)]">На каждой этикетке указан номер вида 18/{recoveryBatch.total}. Введите номер последней нормально вышедшей этикетки. Следующая позиция будет отправлена на печать заново.</span></div>
      <label className="mt-5 block"><span className="text-sm font-semibold">Последняя напечатанная позиция</span><input type="number" min={recoveryBatch.printed} max={recoveryBatch.total} value={lastPrintedPosition} onChange={(event) => setLastPrintedPosition(Number(event.target.value))} autoFocus className="mt-2 h-14 w-full rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 text-2xl font-bold outline-none focus:border-red-400" /><span className="mt-2 block text-sm text-[var(--text-muted)]">Допустимо: от {recoveryBatch.printed} до {recoveryBatch.total}</span></label>
      {printError && <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-400">{printError}</div>}
      <div className="mt-5 flex gap-3"><button type="button" disabled={printBusy} onClick={() => setRecoveryBatch(null)} className="min-h-12 flex-1 rounded-xl border border-[var(--border)] font-semibold transition hover:bg-[var(--bg-card-hover)]">Закрыть</button><button type="button" disabled={printBusy || lastPrintedPosition < recoveryBatch.printed || lastPrintedPosition > recoveryBatch.total} onClick={() => void resumePrintBatch()} className="min-h-12 flex-[1.5] rounded-xl bg-red-500 px-5 font-semibold text-white transition hover:brightness-110 disabled:opacity-40">Продолжить с позиции {Math.min(lastPrintedPosition + 1, recoveryBatch.total)}</button></div>
    </div></div>}

    {details && <div className="fixed inset-0 z-50 flex justify-end bg-black/60" onClick={() => setDetails(null)}><aside className="h-full w-full max-w-[560px] overflow-y-auto border-l border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-2xl" onClick={(event) => event.stopPropagation()}>
      <div className="flex items-start justify-between gap-4"><div><div className="text-sm font-semibold text-[var(--accent)]">ЗАПИСЬ ЖУРНАЛА</div><h3 className="mt-1 text-xl font-bold">{details.codeTail}</h3></div><button type="button" onClick={() => setDetails(null)} className="flex h-11 w-11 items-center justify-center rounded-full border border-[var(--border)] transition hover:bg-[var(--bg-card-hover)]"><X size={22} /></button></div>
      <div className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4"><div className="flex items-center gap-3"><ShieldCheck className="text-[var(--accent)]" size={28} /><div><div className="font-semibold">Полный код недоступен в интерфейсе</div><div className="text-sm text-[var(--text-muted)]">До печати он зашифрован. После подтверждённой печати полный код удаляется.</div></div></div></div>
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

function ProductBlock({ product, expanded, onToggle, onPrint }: { product: FbsKizArchiveProduct; expanded: boolean; onToggle: () => void; onPrint: (size: FbsKizArchiveSize) => void }) {
  return <div>
    <button type="button" onClick={onToggle} className="grid w-full items-center gap-4 px-4 py-4 text-left transition hover:bg-[var(--bg-card-hover)] md:grid-cols-[34px_minmax(330px,1fr)_150px_170px]">
      <span className="text-[var(--text-muted)]">{expanded ? <ChevronDown size={24} /> : <ChevronRight size={24} />}</span>
      <span><strong className="block text-lg">WB {product.nmId}</strong><span className="block text-sm text-[var(--text-muted)]">{product.productName} · {product.vendorCode}</span></span>
      <span><strong className="block text-xl">{product.sizes.length}</strong><span className="text-sm text-[var(--text-muted)]">размеров</span></span>
      <span><strong className="block text-xl text-emerald-400">{product.available}</strong><span className="text-sm text-[var(--text-muted)]">доступно</span></span>
    </button>
    {expanded && <div className="overflow-x-auto border-t border-[var(--border)] bg-[var(--bg)]/55"><div className="min-w-[1120px]">
      <div className="grid grid-cols-[130px_140px_minmax(220px,1fr)_130px_130px_130px_190px] gap-3 px-5 py-3 text-center text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]"><span>Размер WB</span><span>Размер</span><span>ШК товара</span><span>Доступно</span><span>В печати</span><span>Использовано</span><span>Действие</span></div>
      {product.sizes.map((size) => <div key={`${product.nmId}-${size.barcode}`} className="grid grid-cols-[130px_140px_minmax(220px,1fr)_130px_130px_130px_190px] items-center gap-3 border-t border-[var(--border)]/70 px-5 py-3 text-center"><strong>{size.wbSize}</strong><span>{size.russianSize}</span><span className="font-mono text-sm">{size.barcode}</span><strong className={size.available ? "text-emerald-400" : "text-[var(--text-muted)]"}>{size.available}</strong><span className={size.reserved ? "font-semibold text-amber-400" : "text-[var(--text-muted)]"}>{size.reserved}</span><span className="text-[var(--text-muted)]">{size.printed}</span><button type="button" disabled={size.available < 1 || size.reserved > 0} onClick={() => onPrint(size)} className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[var(--accent)] px-4 font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-[var(--bg-card-hover)] disabled:text-[var(--text-muted)]"><Printer size={19} /> Печать</button></div>)}
    </div></div>}
  </div>;
}
