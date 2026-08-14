"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  AlertTriangle, Backpack, Box, CheckCircle2, Loader2,
  FileText, Package, Printer, QrCode, RefreshCw, ScanLine, ShieldCheck,
  Truck, X,
} from "lucide-react";
import FbsPickSheet from "@/components/FbsPickSheet";
import { parseFbsDataMatrix } from "@/lib/fbs-datamatrix";
import { fbsLabelText, fbsStickerNumber } from "@/lib/fbs-label";
import {
  DEFAULT_FBS_MARKING_POLICY,
  getFbsEffectiveRequiredMeta,
  getFbsReviewOptionalMeta,
  hasFbsOperatorMetadata,
  type FbsMarkingPolicy,
} from "@/lib/fbs-metadata";
import { getFbsPrinterProblem, resolveFbsPrinter, type FbsPrintAgent } from "@/lib/fbs-printer-status";
import { getWbImageUrlCandidates, getWbImageUrlFromKnownSource } from "@/lib/wb-image";

type MetaType = "sgtin" | "uin" | "imei" | "gtin" | "expiration" | "customsDeclaration";
type Order = {
  order_id: number; order_uid: string; supply_id: string | null; warehouse_id: number;
  nm_id: number; chrt_id: number; vendor_code: string; product_name: string;
  size_name: string; photo_url: string; skus: string[]; required_meta: MetaType[];
  optional_meta: MetaType[]; supplier_status: string; wb_status: string;
  picked_at: string | null; sticker_printed_at: string | null; packed_at: string | null;
  metadata_decisions: Array<{ key?: string; type?: string; name?: string; decision?: string; status?: string; message?: string }>;
  optional_meta_reviewed_at: string | null;
  reshipment_required: boolean; created_at_wb: string | null; raw_json: Record<string, unknown>;
};
type Supply = {
  supply_id: string; name: string; delivery_mode: "warehouse" | "pvz"; done: boolean;
  is_b2b: boolean | null; cargo_type: number | null; order_count: number; boxes_count: number;
  box_ids: string[]; box_stickers_printed_ids: string[]; box_stickers_printed_count: number;
  box_stickers_printed_at: string | null; pvz_rules_confirmed_at: string | null;
  qr_printed_at: string | null; created_at_wb: string | null; locally_delivered: boolean;
};
type PrintJob = { job_id: string; supply_id: string; group_key: string; nm_id: number; chrt_id: number; sku: string; total_count: number; printed_count: number; status: "queued" | "printing" | "paused" | "completed" | "cancelled" | "error"; agent_id: string | null; last_error: string; created_at: string; updated_at: string };
type Warehouse = { warehouse_id: number; warehouse_name: string };
type Snapshot = { orders: Order[]; supplies: Supply[]; warehouses: Warehouse[]; scans: unknown[]; events: Array<{ id: number; action: string; status: string; message: string; supply_id?: string; created_at: string }>; printJobs: PrintJob[]; printAgents: FbsPrintAgent[]; markingPolicy: FbsMarkingPolicy };
type LiveOrderState = Pick<Order, "order_id" | "picked_at" | "sticker_printed_at">;
type LiveSnapshot = { orders: LiveOrderState[]; supply: Supply | null; printJobs: PrintJob[]; printAgents: FbsPrintAgent[] };
type WorkflowStep = "tasks" | "assembly" | "marking" | "shipping";
type BatchCategory = "backpack" | "underwear" | "other";
type BatchGroupState = "active" | "pending" | "complete";
type BatchGroup = { key: string; order: Order; sku: string; orders: Order[]; category: BatchCategory };
type BatchArticleGroup = { wbArticle: number; groups: BatchGroup[]; orderCount: number; sizeCount: number; state: BatchGroupState };
type BatchSection = { category: BatchCategory; orderCount: number; articles: BatchArticleGroup[]; completedGroupCount: number };
type AssemblyMarkingStatus = { state: "sending" | "pending" | "filled" | "error"; message: string; updatedAt?: string };
type AssemblyStatusPanel = "accepted" | "pending" | "errors";
type MarkingQueueStatus = {
  order_id: number;
  metadata_decisions: Order["metadata_decisions"];
  queue_status: "queued" | "sending" | "sent" | "retry" | "verified" | "error" | null;
  message: string;
  updated_at: string | null;
};

const EMPTY: Snapshot = { orders: [], supplies: [], warehouses: [], scans: [], events: [], printJobs: [], printAgents: [], markingPolicy: DEFAULT_FBS_MARKING_POLICY };
const META_LABELS: Record<MetaType, string> = {
  sgtin: "КИЗ / DataMatrix", uin: "УИН", imei: "IMEI", gtin: "GTIN",
  expiration: "Срок годности", customsDeclaration: "Номер ДТ",
};

function formatDate(value?: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatOrderDate(value?: string | null) {
  if (!value) return "дата не указана";
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Moscow", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(value));
}

function orderAge(value: string | null | undefined, now: number) {
  if (!value) return "время не указано";
  const createdAt = new Date(value).getTime();
  if (!Number.isFinite(createdAt)) return "время не указано";
  const totalMinutes = Math.max(0, Math.floor((now - createdAt) / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} ч ${minutes} мин назад` : `${minutes} мин назад`;
}

function orderWord(count: number) {
  const lastTwo = count % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return "заказов";
  if (count % 10 === 1) return "заказ";
  if (count % 10 >= 2 && count % 10 <= 4) return "заказа";
  return "заказов";
}

function labelWord(count: number) {
  const lastTwo = count % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return "этикеток";
  if (count % 10 === 1) return "этикетка";
  if (count % 10 >= 2 && count % 10 <= 4) return "этикетки";
  return "этикеток";
}

function remainingProductText(count: number) {
  const lastTwo = count % 100;
  const word = lastTwo >= 11 && lastTwo <= 14
    ? "товаров"
    : count % 10 === 1
      ? "товар"
      : count % 10 >= 2 && count % 10 <= 4
        ? "товара"
        : "товаров";
  return `${count === 1 ? "Остался" : "Осталось"} ${count} ${word}`;
}

function visibleSize(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized && normalized !== "0" && normalized !== "нулевой" ? value : "";
}

function sizeSortNumber(value: string) {
  const match = visibleSize(value).match(/\d+/);
  return match ? Number(match[0]) : Number.MAX_SAFE_INTEGER;
}

function sizeWord(count: number) {
  const lastTwo = count % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return "размеров";
  if (count % 10 === 1) return "размер";
  if (count % 10 >= 2 && count % 10 <= 4) return "размера";
  return "размеров";
}

function getBatchCategory(order: Order): BatchCategory {
  const product = `${order.product_name} ${order.vendor_code}`.toLocaleLowerCase("ru");
  if (/рюкзак|портфел/.test(product)) return "backpack";
  if (/трус|боксер|нижн(?:ее|его|ем) бель/.test(product)) return "underwear";
  return "other";
}

function effectiveRequiredMeta(order: Order, markingPolicy: FbsMarkingPolicy) {
  return getFbsEffectiveRequiredMeta(
    order.required_meta,
    order.optional_meta,
    order.product_name,
    order.vendor_code,
    [],
    markingPolicy,
  );
}

function isBatchGroupComplete(group: BatchGroup, markingPolicy: FbsMarkingPolicy) {
  const labelsComplete = group.orders.every((order) => Boolean(order.picked_at && order.sticker_printed_at));
  if (!labelsComplete) return false;
  return group.orders.every((order) => {
    const requiresSgtin = effectiveRequiredMeta(order, markingPolicy).includes("sgtin");
    if (!requiresSgtin) return true;
    return (order.metadata_decisions || []).some((detail) =>
      (detail.key === "sgtin" || detail.type === "sgtin" || detail.name === "sgtin")
      && (detail.decision || detail.status || "") === "filled"
    );
  });
}

function isNewFbsOrder(order: Order) {
  return (order.supplier_status === "new" && order.wb_status === "waiting" && !order.supply_id)
    || order.reshipment_required;
}

function newOrderSignature(orders: Order[]) {
  return orders.map((order) => order.order_id).sort((a, b) => a - b).join(":");
}

function HighlightedLabelNumber({ value, large = false }: { value: string | number; large?: boolean }) {
  const labelNumber = String(value);
  const prefix = labelNumber.slice(0, -4);
  const suffix = labelNumber.slice(-4);
  return <span className={`inline-flex items-baseline whitespace-nowrap font-mono font-semibold tracking-wide ${large ? "text-xl" : "text-lg"}`}><span>{prefix}</span><span className={`ml-2 font-extrabold text-[var(--accent)] ${large ? "text-2xl" : "text-xl"}`}>{suffix}</span></span>;
}

function ProductPhoto({ order, enlargeable = false, large = false, tall = false }: { order: Order; enlargeable?: boolean; large?: boolean; tall?: boolean }) {
  const candidates = useMemo(() => Array.from(new Set([order.photo_url, ...getWbImageUrlCandidates(order.nm_id, "small")].filter(Boolean))), [order.photo_url, order.nm_id]);
  const previewCandidates = useMemo(() => Array.from(new Set([
    `/api/fbs/photo?orderId=${order.order_id}`,
    getWbImageUrlFromKnownSource(order.photo_url, "medium"),
    order.photo_url,
    ...getWbImageUrlCandidates(order.nm_id, "medium"),
    ...getWbImageUrlCandidates(order.nm_id, "small"),
  ].filter(Boolean))), [order.order_id, order.photo_url, order.nm_id]);
  const [index, setIndex] = useState(0);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(true);
  useEffect(() => { setIndex(0); setPreviewIndex(0); setPreviewOpen(false); setPreviewLoading(true); }, [order.nm_id, order.photo_url]);
  useEffect(() => {
    if (!previewOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") setPreviewOpen(false); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [previewOpen]);
  const openPreview = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setPreviewIndex(0);
    setPreviewLoading(true);
    setPreviewOpen(true);
  };
  const warmPreview = () => {
    const source = previewCandidates[0];
    if (source) new Image().src = source;
  };
  const imageClass = large ? "h-[108px] w-[80px]" : tall ? "h-[95px] w-[70px]" : "h-16 w-12";
  if (!candidates[index]) return <div className={`${imageClass} rounded-lg bg-[var(--bg)]`} />;
  const image = <img src={candidates[index]} alt={order.product_name || order.vendor_code || `Товар ${order.nm_id}`} className={`${imageClass} rounded-lg bg-white object-contain`} onError={() => setIndex((n) => n + 1)} />;
  return <>
    {enlargeable ? <button type="button" onClick={openPreview} onMouseEnter={warmPreview} onFocus={warmPreview} className="shrink-0 cursor-zoom-in rounded-lg outline-none ring-[var(--accent)] focus-visible:ring-2" aria-label="Увеличить фотографию товара">{image}</button> : image}
    {previewOpen && typeof document !== "undefined" && createPortal(
      <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 p-4" role="dialog" aria-modal="true" aria-label="Фотография товара" onClick={() => setPreviewOpen(false)}>
        <div className="relative flex h-[min(88vh,688px)] w-[min(88vw,516px)] items-center justify-center overflow-hidden rounded-2xl bg-white p-3 shadow-2xl" onClick={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => setPreviewOpen(false)} className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/70 text-white transition hover:bg-black" aria-label="Закрыть фотографию"><X size={22} /></button>
          {previewLoading && previewCandidates[previewIndex] && <div className="absolute inset-0 flex items-center justify-center bg-white"><Loader2 size={38} className="animate-spin text-[var(--accent)]" /></div>}
          {previewCandidates[previewIndex] ? <img key={previewCandidates[previewIndex]} src={previewCandidates[previewIndex]} alt={order.product_name || order.vendor_code || `Товар ${order.nm_id}`} className={`h-full w-full object-contain transition-opacity duration-200 ${previewLoading ? "opacity-0" : "opacity-100"}`} onLoad={() => setPreviewLoading(false)} onError={() => { setPreviewLoading(true); setPreviewIndex((n) => n + 1); }} /> : <div className="px-6 text-center text-base font-medium text-neutral-600">Фотография временно недоступна</div>}
        </div>
      </div>,
      document.body,
    )}
  </>;
}

function statusPill(ok: boolean, label: string) {
  return <span className={`rounded-full px-2 py-1 text-xs ${ok ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-500"}`}>{ok ? "✓ " : "○ "}{label}</span>;
}

function assemblySgtinErrorMessage(order: Order, status?: AssemblyMarkingStatus) {
  if (status?.state === "error" && status.message) return status.message;
  const detail = (order.metadata_decisions || []).find((item) => {
    const type = item.key || item.type || item.name || "";
    const decision = (item.decision || item.status || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    return type === "sgtin" && Boolean(decision) && !["filled", "pending", "required", "optional", "missing", "empty"].includes(decision);
  });
  const decision = (detail?.decision || detail?.status || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (detail?.message) return detail.message;
  const messages: Record<string, string> = {
    deadlineexceeded: "Не проверено WB после 3 попыток",
    sgtinnotfound: "WB не нашёл код в системе «Честный знак»",
    sgtininvalidformat: "WB отклонил формат кода маркировки",
    sgtinnogs: "В коде отсутствует обязательный GS-разделитель",
    sgtinhasinvalidsymbols: "Код содержит недопустимые символы",
    sgtinhasnonlatinsymbols: "Код содержит не латинские символы — проверьте раскладку сканера",
    sgtininvalidpattern: "Структура кода не соответствует формату «Честного знака»",
    sgtinalreadyused: "WB сообщил, что код уже использован",
    sgtinalreadysold: "WB сообщил, что товар с этим кодом уже продан",
    sgtinbadstatus: "Код имеет недопустимый статус в системе «Честный знак»",
    sgtinnotbelongproduct: "Код не относится к этому товару",
  };
  return messages[decision] || (decision ? `WB отклонил код маркировки: ${decision}` : "WB отклонил код — пересканируйте");
}

function playScanTone(success: boolean) {
  if (success) return;
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "square";
    oscillator.frequency.setValueAtTime(650, context.currentTime);
    oscillator.frequency.setValueAtTime(420, context.currentTime + 0.3);
    gain.gain.setValueAtTime(0.55, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.7);
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.7);
    oscillator.addEventListener("ended", () => void context.close(), { once: true });
  } catch {
    // Visual feedback remains available if the browser blocks audio.
  }
}

export default function FbsPage() {
  const [data, setData] = useState<Snapshot>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedNew, setSelectedNew] = useState<Set<number>>(new Set());
  const [supplyTarget, setSupplyTarget] = useState<"new" | "existing">("new");
  const [existingSupplyId, setExistingSupplyId] = useState("");
  const [addConfirmOpen, setAddConfirmOpen] = useState(false);
  const [supplyName, setSupplyName] = useState(`FBS — ${new Date().toLocaleDateString("ru-RU")}`);
  const [deliveryMode, setDeliveryMode] = useState<"warehouse" | "pvz">("warehouse");
  const [activeSupplyId, setActiveSupplyId] = useState("");
  const [scanValue, setScanValue] = useState("");
  const [autoPrint, setAutoPrint] = useState(true);
  const [assemblyMode, setAssemblyMode] = useState<"single" | "batch">("batch");
  const [taskGroupKey, setTaskGroupKey] = useState("");
  const [singlePrintOrderId, setSinglePrintOrderId] = useState<number | null>(null);
  const [batchReprintConfirmOpen, setBatchReprintConfirmOpen] = useState(false);
  const [assemblyMarkingOrderId, setAssemblyMarkingOrderId] = useState<number | null>(null);
  const [assemblyMarkingValue, setAssemblyMarkingValue] = useState("");
  const [assemblyMarkingBusy, setAssemblyMarkingBusy] = useState(false);
  const [assemblyMarkingStatus, setAssemblyMarkingStatus] = useState<Record<number, AssemblyMarkingStatus>>({});
  const [assemblyMarkingMessage, setAssemblyMarkingMessage] = useState("Сканируйте этикетку WB на товаре");
  const [assemblyMarkingError, setAssemblyMarkingError] = useState("");
  const [assemblyMarkingGroupKey, setAssemblyMarkingGroupKey] = useState("");
  const [assemblyMarkingModalOpen, setAssemblyMarkingModalOpen] = useState(false);
  const [autoOpenMarkingGroupKey, setAutoOpenMarkingGroupKey] = useState("");
  const [assemblyStatusPanel, setAssemblyStatusPanel] = useState<AssemblyStatusPanel | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [metaType, setMetaType] = useState<MetaType>("sgtin");
  const [metaValue, setMetaValue] = useState("");
  const [preflight, setPreflight] = useState<{ ready: boolean; errors: string[] } | null>(null);
  const [activeStep, setActiveStep] = useState<WorkflowStep>("tasks");
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [pickSheetOrders, setPickSheetOrders] = useState<Order[] | null>(null);
  const [pickSheetCreatedAt, setPickSheetCreatedAt] = useState(0);
  const scanRef = useRef<HTMLInputElement>(null);
  const assemblyMarkingRef = useRef<HTMLInputElement>(null);
  const assemblyMarkingFormRef = useRef<HTMLFormElement>(null);
  const announcedQueueErrorsRef = useRef<Set<string>>(new Set());
  const selectAllNewRef = useRef<HTMLInputElement>(null);
  const selectAllNewMobileRef = useRef<HTMLInputElement>(null);
  const addConfirmRef = useRef<HTMLDivElement>(null);
  const addConfirmButtonRef = useRef<HTMLButtonElement>(null);
  const supplyTargetInitialized = useRef(false);
  const supplyRefreshPausedRef = useRef(false);
  const supplyRefreshResumeTimerRef = useRef<number | null>(null);
  const lastActionSnapshotRef = useRef<Snapshot | null>(null);

  const focusAssemblyMarkingScanner = useCallback((ensureFullyVisible = false, delay = 30) => {
    window.setTimeout(() => {
      const form = assemblyMarkingFormRef.current;
      if (ensureFullyVisible && form) {
        const rect = form.getBoundingClientRect();
        const visibleTop = 96;
        const visibleBottom = window.innerHeight - 24;
        if (rect.top < visibleTop || rect.bottom > visibleBottom) {
          form.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
      assemblyMarkingRef.current?.focus({ preventScroll: true });
    }, delay);
  }, []);

  useEffect(() => {
    const readableModeWasEnabled = document.documentElement.classList.contains("fbs-readable-ui");
    document.documentElement.classList.add("fbs-readable-ui");
    return () => {
      if (!readableModeWasEnabled) document.documentElement.classList.remove("fbs-readable-ui");
    };
  }, []);

  useEffect(() => {
    if (!assemblyStatusPanel) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAssemblyStatusPanel(null);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [assemblyStatusPanel]);

  const load = useCallback(async () => {
    if (supplyRefreshPausedRef.current) return null;
    try {
      const response = await fetch("/api/fbs", { cache: "no-store" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      if (supplyRefreshPausedRef.current) return payload as Snapshot;
      setData(payload);
      setError("");
      const open = (payload.supplies as Supply[]).find((row) => !row.done);
      if (!supplyTargetInitialized.current) {
        const savedSupplyId = window.sessionStorage.getItem("fbs.activeSupplyId") || "";
        const savedSupply = (payload.supplies as Supply[]).find((row) => row.supply_id === savedSupplyId);
        const resumableSavedSupply = savedSupply && (
          !savedSupply.done
          || (savedSupply.locally_delivered && !savedSupply.qr_printed_at)
        ) ? savedSupply : undefined;
        if (savedSupplyId && !resumableSavedSupply) {
          window.sessionStorage.removeItem("fbs.activeSupplyId");
        }
        const pendingQrSupply = (payload.supplies as Supply[]).find((row) =>
          row.done
          && row.locally_delivered
          && !row.qr_printed_at
        );
        const initialSupply = resumableSavedSupply || pendingQrSupply || open;
        setActiveSupplyId(initialSupply?.supply_id || "");
        if (initialSupply?.done) setActiveStep("shipping");
        setSupplyTarget(open ? "existing" : "new");
        supplyTargetInitialized.current = true;
      }
      return payload as Snapshot;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось загрузить FBS");
      return null;
    } finally { setLoading(false); }
  }, []);

  const loadLiveSupply = useCallback(async (supplyId: string, signal?: AbortSignal) => {
    if (!supplyId || supplyRefreshPausedRef.current) return;
    const response = await fetch(`/api/fbs?liveSupply=${encodeURIComponent(supplyId)}`, { cache: "no-store", signal });
    const payload = await response.json().catch(() => ({})) as Partial<LiveSnapshot> & { error?: string };
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    if (signal?.aborted || supplyRefreshPausedRef.current) return;
    const liveOrders = new Map((payload.orders || []).map((order) => [Number(order.order_id), order]));
    setData((current) => ({
      ...current,
      orders: current.orders.map((order) => {
        const live = liveOrders.get(order.order_id);
        return live ? { ...order, ...live } : order;
      }),
      supplies: payload.supply
        ? current.supplies.map((supply) => supply.supply_id === payload.supply?.supply_id ? { ...supply, ...payload.supply } : supply)
        : current.supplies,
      printJobs: payload.printJobs
        ? [...current.printJobs.filter((job) => job.supply_id !== supplyId), ...payload.printJobs]
        : current.printJobs,
      printAgents: payload.printAgents || current.printAgents,
    }));
  }, []);

  const pauseSupplyRefresh = useCallback(() => {
    supplyRefreshPausedRef.current = true;
    if (supplyRefreshResumeTimerRef.current !== null) {
      window.clearTimeout(supplyRefreshResumeTimerRef.current);
      supplyRefreshResumeTimerRef.current = null;
    }
  }, []);

  const resumeSupplyRefresh = useCallback(() => {
    if (!supplyRefreshPausedRef.current) return;
    supplyRefreshPausedRef.current = false;
    supplyRefreshResumeTimerRef.current = window.setTimeout(() => {
      supplyRefreshResumeTimerRef.current = null;
      supplyRefreshPausedRef.current = false;
    }, 50);
  }, []);

  useEffect(() => () => {
    if (supplyRefreshResumeTimerRef.current !== null) window.clearTimeout(supplyRefreshResumeTimerRef.current);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!supplyTargetInitialized.current) return;
    if (activeSupplyId) window.sessionStorage.setItem("fbs.activeSupplyId", activeSupplyId);
    else window.sessionStorage.removeItem("fbs.activeSupplyId");
  }, [activeSupplyId]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4_500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!addConfirmOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!addConfirmRef.current?.contains(event.target as Node)) setAddConfirmOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setAddConfirmOpen(false);
        addConfirmButtonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [addConfirmOpen]);

  useEffect(() => {
    setAddConfirmOpen(false);
  }, [existingSupplyId, selectedNew, supplyTarget]);

  useEffect(() => {
    if (activeStep !== "assembly" || assemblyMode !== "batch" || !activeSupplyId || assemblyMarkingModalOpen) return;
    const controller = new AbortController();
    const refresh = () => void loadLiveSupply(activeSupplyId, controller.signal).catch(() => undefined);
    refresh();
    const timer = window.setInterval(refresh, 3_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [activeStep, activeSupplyId, assemblyMarkingModalOpen, assemblyMode, loadLiveSupply]);

  async function action(name: string, body: Record<string, unknown>, refresh = true) {
    setBusy(name); setError(""); setNotice("");
    try {
      const response = await fetch("/api/fbs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      if (refresh && payload.snapshot) {
        lastActionSnapshotRef.current = payload.snapshot as Snapshot;
        setData(payload.snapshot);
      }
      return payload.result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Операция не выполнена");
      throw cause;
    } finally { setBusy(""); }
  }

  async function compactFbsAction(body: Record<string, unknown>) {
    const response = await fetch("/api/fbs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, compact: true }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload.result;
  }

  const newOrders = data.orders.filter(isNewFbsOrder);
  const allNewSelected = newOrders.length > 0 && newOrders.every((order) => selectedNew.has(order.order_id));
  const someNewSelected = newOrders.some((order) => selectedNew.has(order.order_id));
  useEffect(() => {
    if (selectAllNewRef.current) selectAllNewRef.current.indeterminate = someNewSelected && !allNewSelected;
    if (selectAllNewMobileRef.current) selectAllNewMobileRef.current.indeterminate = someNewSelected && !allNewSelected;
  }, [allNewSelected, someNewSelected]);
  useEffect(() => {
    if (!pickSheetOrders) return;
    if (newOrderSignature(pickSheetOrders) !== newOrderSignature(data.orders.filter(isNewFbsOrder))) {
      setPickSheetOrders(null);
      setPickSheetCreatedAt(0);
    }
  }, [data.orders, pickSheetOrders]);
  const warehouseNameById = useMemo(() => new Map(
    data.warehouses.map((warehouse) => [Number(warehouse.warehouse_id), warehouse.warehouse_name]),
  ), [data.warehouses]);
  const warehouseNameFor = (order: Order) => {
    const warehouseId = Number(order.warehouse_id || 0);
    return warehouseNameById.get(warehouseId) || (warehouseId ? `Склад №${warehouseId}` : "Склад не указан");
  };
  const { connected: connectedPrintAgent, ready: printAgentReady } = resolveFbsPrinter(data.printAgents);
  const currentPrinterProblem = getFbsPrinterProblem(connectedPrintAgent);
  const openSupplies = data.supplies.filter((supply) => !supply.done);
  const pendingQrSupplies = data.supplies.filter((supply) => supply.done && supply.locally_delivered && !supply.qr_printed_at);
  const activeSupply = data.supplies.find((supply) => supply.supply_id === activeSupplyId);
  const activeSupplyQrJob = data.printJobs.find((job) =>
    job.supply_id === activeSupplyId
    && job.group_key === `supply-qr:${activeSupplyId}`
    && ["queued", "printing", "paused"].includes(job.status)
  ) || null;
  const activeSupplyQrJobKey = activeSupplyQrJob
    ? `${activeSupplyQrJob.job_id}:${activeSupplyQrJob.status}:${activeSupplyQrJob.printed_count}`
    : "";
  const activeBoxQrJob = data.printJobs.find((job) =>
    job.supply_id === activeSupplyId
    && (job.group_key.startsWith(`box-qr:${activeSupplyId}:`) || job.group_key.startsWith(`box-qr-reprint:${activeSupplyId}:`))
    && ["queued", "printing", "paused"].includes(job.status)
  ) || null;
  const activeBoxQrJobKey = activeBoxQrJob
    ? `${activeBoxQrJob.job_id}:${activeBoxQrJob.status}:${activeBoxQrJob.printed_count}`
    : "";
  const selectableSupplies = Array.from(new Map(
    [...(activeSupply?.done ? [activeSupply] : []), ...pendingQrSupplies, ...openSupplies]
      .map((supply) => [supply.supply_id, supply]),
  ).values());
  const supplyOrders = useMemo(() => data.orders.filter((order) => order.supply_id === activeSupplyId), [activeSupplyId, data.orders]);
  const picked = supplyOrders.filter((order) => order.picked_at).length;
  const printed = supplyOrders.filter((order) => order.sticker_printed_at).length;
  const packed = supplyOrders.filter((order) => order.packed_at).length;
  const allPicked = supplyOrders.length > 0 && picked === supplyOrders.length;
  const allPrinted = supplyOrders.length > 0 && printed === supplyOrders.length;
  const markingOrders = useMemo(() => supplyOrders.filter((order) =>
    hasFbsOperatorMetadata(order.required_meta, order.optional_meta, order.product_name, order.vendor_code, data.markingPolicy)
  ), [data.markingPolicy, supplyOrders]);
  const metaReady = (order: Order) => {
    const decisions = order.metadata_decisions || [];
    const effectiveRequired = effectiveRequiredMeta(order, data.markingPolicy);
    const reviewOptional = getFbsReviewOptionalMeta(order.optional_meta);
    const requiredReady = effectiveRequired.every((required) => decisions.some((detail) =>
      (detail.key === required || detail.type === required || detail.name === required)
      && (detail.decision || detail.status || "") === "filled",
    ));
    return requiredReady && (!reviewOptional.length || Boolean(order.optional_meta_reviewed_at));
  };
  const metaPending = (order: Order) => (order.metadata_decisions || []).some((detail) =>
    (detail.key === "sgtin" || detail.type === "sgtin" || detail.name === "sgtin")
    && (detail.decision || detail.status || "").toLowerCase().replace(/[^a-z0-9]/g, "") === "pending",
  );
  const metaRejected = (order: Order) => (order.metadata_decisions || []).some((detail) => {
    const type = detail.key || detail.type || detail.name || "";
    const decision = (detail.decision || detail.status || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    return type === "sgtin" && Boolean(decision) && !["filled", "pending", "required", "optional", "missing", "empty"].includes(decision);
  });
  const metaDeadlineExceeded = (order: Order) => (order.metadata_decisions || []).some((detail) =>
    (detail.key === "sgtin" || detail.type === "sgtin" || detail.name === "sgtin")
    && (detail.decision || detail.status || "").toLowerCase().replace(/[^a-z0-9]/g, "") === "deadlineexceeded"
  );
  const sgtinReady = (order: Order) => (order.metadata_decisions || []).some((detail) =>
    (detail.key === "sgtin" || detail.type === "sgtin" || detail.name === "sgtin")
    && (detail.decision || detail.status || "") === "filled"
  );
  const assemblySgtinOrders = useMemo(() => markingOrders.filter((order) =>
    effectiveRequiredMeta(order, data.markingPolicy).includes("sgtin")
  ), [data.markingPolicy, markingOrders]);
  const assemblySgtinAcceptedOrders = assemblySgtinOrders.filter(sgtinReady);
  const assemblySgtinPendingOrders = assemblySgtinOrders.filter((order) =>
    !sgtinReady(order)
    && !metaRejected(order)
    && assemblyMarkingStatus[order.order_id]?.state !== "error"
    && (metaPending(order) || ["sending", "pending"].includes(assemblyMarkingStatus[order.order_id]?.state || ""))
  );
  const assemblySgtinErrorOrders = assemblySgtinOrders.filter((order) =>
    !sgtinReady(order) && (metaRejected(order) || assemblyMarkingStatus[order.order_id]?.state === "error")
  );
  const assemblySgtinAccepted = assemblySgtinAcceptedOrders.length;
  const assemblySgtinPending = assemblySgtinPendingOrders.length;
  const assemblySgtinErrors = assemblySgtinErrorOrders.length;
  const assemblyStatusPanelOrders = assemblyStatusPanel === "accepted"
    ? assemblySgtinAcceptedOrders
    : assemblyStatusPanel === "pending"
      ? assemblySgtinPendingOrders
      : assemblyStatusPanel === "errors"
        ? assemblySgtinErrorOrders
        : [];
  const assemblyStatusPanelTitle = assemblyStatusPanel === "accepted"
    ? "Принято WB"
    : assemblyStatusPanel === "pending"
      ? "Проверяется WB"
      : "Ошибки";
  const allAssemblySgtinReady = assemblySgtinAccepted === assemblySgtinOrders.length;
  const assemblySgtinStateKey = assemblySgtinOrders.map((order) =>
    `${order.order_id}:${sgtinReady(order) ? "filled" : metaRejected(order) ? "error" : metaPending(order) ? "pending" : "missing"}`
  ).join("|");
  const assemblyMarkingOrder = assemblyMarkingOrderId
    ? assemblySgtinOrders.find((order) => order.order_id === assemblyMarkingOrderId) || null
    : null;
  const markingQueueOrderKey = assemblySgtinOrders.map((order) => order.order_id).join(",");
  const markingQueueActive = assemblySgtinOrders.some((order) =>
    !sgtinReady(order)
    && !metaRejected(order)
    && assemblyMarkingStatus[order.order_id]?.state !== "error"
    && (metaPending(order) || ["sending", "pending"].includes(assemblyMarkingStatus[order.order_id]?.state || ""))
  );
  const markingOrderKey = markingOrders.map((order) => order.order_id).join(",");
  const marked = markingOrders.filter((order) => metaReady(order)).length;
  const assemblyReady = allPicked && allPrinted;
  const allMarked = assemblyReady && marked === markingOrders.length;
  const markingStepInactive = !data.markingPolicy.forceUnderwearSgtin && markingOrders.length === 0;
  const allPacked = supplyOrders.length > 0 && packed === supplyOrders.length;
  const selectedOrder = data.orders.find((order) => order.order_id === selectedOrderId) || null;
  const selectedOrderMetaTypes = selectedOrder
    ? [...new Set([
      ...effectiveRequiredMeta(selectedOrder, data.markingPolicy),
      ...getFbsReviewOptionalMeta(selectedOrder.optional_meta),
    ])]
    : [];

  useEffect(() => {
    if (!["assembly", "marking"].includes(activeStep) || !markingQueueActive || !markingQueueOrderKey) return;
    let stopped = false;
    let running = false;
    const processQueue = async () => {
      if (running || stopped || supplyRefreshPausedRef.current) return;
      running = true;
      try {
        const orderIds = markingQueueOrderKey.split(",").map(Number).filter(Number.isSafeInteger);
        const response = await fetch("/api/fbs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "process_marking_queue", orderIds, compact: true }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
        if (stopped || supplyRefreshPausedRef.current) return;
        const statuses = Array.isArray(payload.result?.statuses) ? payload.result.statuses as MarkingQueueStatus[] : [];
        if (!statuses.length) return;
        const byId = new Map(statuses.map((status) => [Number(status.order_id), status]));
        setData((current) => ({
          ...current,
          orders: current.orders.map((order) => {
            const status = byId.get(order.order_id);
            return status ? { ...order, metadata_decisions: status.metadata_decisions || [] } : order;
          }),
        }));
        setAssemblyMarkingStatus((current) => {
          const next = { ...current };
          for (const status of statuses) {
            if (!status.queue_status) continue;
            const filled = (status.metadata_decisions || []).some((detail) =>
              [detail.key, detail.type, detail.name].some((type) => type === "sgtin")
              && (detail.decision || detail.status || "") === "filled"
            );
            const state: AssemblyMarkingStatus["state"] = filled || status.queue_status === "verified"
              ? "filled"
              : status.queue_status === "error"
                ? "error"
                : "pending";
            next[status.order_id] = {
              state,
              message: state === "filled" ? "Принят WB" : state === "error" ? status.message || "WB отклонил код" : "Проверяется WB",
              updatedAt: status.updated_at || new Date().toISOString(),
            };
          }
          return next;
        });
        const freshError = statuses.find((status) => {
          if (status.queue_status !== "error") return false;
          const key = `${status.order_id}:${status.updated_at || status.message}`;
          if (announcedQueueErrorsRef.current.has(key)) return false;
          announcedQueueErrorsRef.current.add(key);
          return true;
        });
        if (freshError) {
          const order = assemblySgtinOrders.find((candidate) => candidate.order_id === freshError.order_id);
          const message = `${order ? fbsLabelText(order) : `Этикетка ${freshError.order_id}`}: ${freshError.message || "WB отклонил код — пересканируйте"}`;
          setAssemblyMarkingMessage(message);
          setAssemblyMarkingError(message);
          setError(message);
          playScanTone(false);
        }
      } catch {
        // The durable server queue will retry; scanning must not stop on a transient poll failure.
      } finally {
        running = false;
      }
    };
    void processQueue();
    const timer = window.setInterval(() => void processQueue(), 2_500);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [activeStep, markingQueueActive, markingQueueOrderKey]);

  useEffect(() => {
    if (activeStep !== "shipping" || (!activeSupplyQrJobKey && !activeBoxQrJobKey)) return;
    const controller = new AbortController();
    const refresh = () => void loadLiveSupply(activeSupplyId, controller.signal).catch(() => undefined);
    const timer = window.setInterval(refresh, 2_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [activeStep, activeSupplyId, activeBoxQrJobKey, activeSupplyQrJobKey, loadLiveSupply]);

  useEffect(() => {
    if (activeStep !== "shipping" || activeSupply?.delivery_mode !== "pvz" || !activeSupplyId) return;
    const controller = new AbortController();
    const refresh = () => void loadLiveSupply(activeSupplyId, controller.signal).catch(() => undefined);
    const timer = window.setInterval(refresh, 2_000);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [activeStep, activeSupply?.delivery_mode, activeSupplyId, loadLiveSupply]);

  useEffect(() => {
    if (activeStep !== "assembly") return;
    const resolved = assemblySgtinOrders.filter((order) =>
      ["sending", "pending"].includes(assemblyMarkingStatus[order.order_id]?.state || "")
      && (sgtinReady(order) || metaRejected(order))
    );
    if (!resolved.length) return;
    setAssemblyMarkingStatus((current) => {
      const next = { ...current };
      for (const order of resolved) {
        next[order.order_id] = sgtinReady(order)
          ? { state: "filled", message: "Принят WB", updatedAt: new Date().toISOString() }
          : { state: "error", message: assemblySgtinErrorMessage(order, current[order.order_id]), updatedAt: new Date().toISOString() };
      }
      return next;
    });
    const rejected = resolved.find(metaRejected);
    if (rejected) {
      setAssemblyMarkingMessage(`${fbsLabelText(rejected)}: ${assemblySgtinErrorMessage(rejected)}`);
      playScanTone(false);
    } else {
      const accepted = resolved[resolved.length - 1];
      setAssemblyMarkingMessage(`${fbsLabelText(accepted)}: «Честный знак» принят WB`);
      playScanTone(true);
    }
  }, [activeStep, assemblySgtinStateKey]);

  const batchGroups = useMemo(() => {
    const groups = new Map<string, BatchGroup>();
    for (const order of supplyOrders) {
      const sku = order.skus?.[0] || "";
      const key = `${order.nm_id}:${order.chrt_id}:${sku}`;
      const group = groups.get(key) || { key, order, sku, orders: [], category: getBatchCategory(order) };
      group.orders.push(order);
      groups.set(key, group);
    }
    const categoryOrder: Record<BatchCategory, number> = { underwear: 0, backpack: 1, other: 2 };
    return Array.from(groups.values()).sort((a, b) =>
      categoryOrder[a.category] - categoryOrder[b.category]
      || a.order.nm_id - b.order.nm_id
      || sizeSortNumber(a.order.size_name || "") - sizeSortNumber(b.order.size_name || "")
      || a.order.vendor_code.localeCompare(b.order.vendor_code, "ru")
      || a.key.localeCompare(b.key),
    );
  }, [supplyOrders]);
  const batchSections = useMemo<BatchSection[]>(() => (["underwear", "backpack", "other"] as BatchCategory[]).map((category) => {
    const categoryGroups = batchGroups.filter((group) => group.category === category);
    const stateFor = (group: BatchGroup): BatchGroupState => {
      const labelsComplete = group.orders.every((order) => Boolean(order.picked_at && order.sticker_printed_at));
      if (!labelsComplete) return "active";
      if (isBatchGroupComplete(group, data.markingPolicy)) return "complete";
      const sgtinOrders = group.orders.filter((order) =>
        effectiveRequiredMeta(order, data.markingPolicy).includes("sgtin")
      );
      const rejected = sgtinOrders.some((order) => metaRejected(order) || assemblyMarkingStatus[order.order_id]?.state === "error");
      const allSubmitted = sgtinOrders.length > 0 && sgtinOrders.every((order) =>
        sgtinReady(order)
        || metaPending(order)
        || ["sending", "pending"].includes(assemblyMarkingStatus[order.order_id]?.state || "")
      );
      return allSubmitted && !rejected ? "pending" : "active";
    };
    const activeGroups = categoryGroups.filter((group) => stateFor(group) === "active");
    const pendingGroups = categoryGroups.filter((group) => stateFor(group) === "pending");
    const completedGroups = categoryGroups.filter((group) => stateFor(group) === "complete");
    const buildArticles = (groups: BatchGroup[], state: BatchGroupState) => {
      const articleMap = new Map<number, BatchGroup[]>();
      for (const group of groups) {
        articleMap.set(group.order.nm_id, [...(articleMap.get(group.order.nm_id) || []), group]);
      }
      return Array.from(articleMap.entries()).map(([wbArticle, articleGroups]): BatchArticleGroup => {
        const visibleSizes = new Set(articleGroups.map((group) => visibleSize(group.order.size_name || "")).filter(Boolean));
        return {
          wbArticle,
          groups: articleGroups,
          orderCount: articleGroups.reduce((sum, group) => sum + group.orders.length, 0),
          sizeCount: visibleSizes.size || articleGroups.length,
          state,
        };
      });
    };
    return {
      category,
      orderCount: categoryGroups.reduce((sum, group) => sum + group.orders.length, 0),
      articles: [...buildArticles(activeGroups, "active"), ...buildArticles(pendingGroups, "pending"), ...buildArticles(completedGroups, "complete")],
      completedGroupCount: completedGroups.length,
    };
  }).filter((section) => section.orderCount > 0), [assemblyMarkingStatus, batchGroups, data.markingPolicy]);
  const taskGroup = batchGroups.find((group) => group.key === taskGroupKey) || null;
  const assemblyMarkingGroup = batchGroups.find((group) => group.key === assemblyMarkingGroupKey) || null;
  const assemblyMarkingDisplayOrder = assemblyMarkingOrder || assemblyMarkingGroup?.order || null;
  const assemblyMarkingGroupOrders = assemblyMarkingGroup?.orders.filter((order) =>
    effectiveRequiredMeta(order, data.markingPolicy).includes("sgtin")
  ) || [];
  const assemblyMarkingGroupSubmitted = assemblyMarkingGroupOrders.filter((order) => {
    const localState = assemblyMarkingStatus[order.order_id]?.state || "";
    return sgtinReady(order)
      || (!metaRejected(order) && metaPending(order))
      || ["sending", "pending", "filled"].includes(localState);
  }).length;
  const assemblyMarkingGroupRemaining = Math.max(0, assemblyMarkingGroupOrders.length - assemblyMarkingGroupSubmitted);
  const taskGroupPrintComplete = taskGroup
    ? taskGroup.orders.length > 0 && taskGroup.orders.every((order) => Boolean(order.picked_at && order.sticker_printed_at))
    : false;
  const taskGroupReprintJob = taskGroup
    ? data.printJobs.find((job) =>
      job.supply_id === activeSupplyId
      && job.nm_id === taskGroup.order.nm_id
      && job.chrt_id === taskGroup.order.chrt_id
      && job.sku === taskGroup.sku
      && job.group_key.startsWith("batch-reprint:")
      && ["queued", "printing", "paused"].includes(job.status)
    ) || null
    : null;
  const singlePrintOrder = singlePrintOrderId ? data.orders.find((order) => order.order_id === singlePrintOrderId) || null : null;

  useEffect(() => {
    if (!autoOpenMarkingGroupKey || activeStep !== "assembly") return;
    const group = batchGroups.find((candidate) => candidate.key === autoOpenMarkingGroupKey);
    if (!group) {
      setAutoOpenMarkingGroupKey("");
      return;
    }
    const labelsComplete = group.orders.every((order) => Boolean(order.picked_at && order.sticker_printed_at));
    const activeJob = data.printJobs.some((job) =>
      job.supply_id === activeSupplyId
      && job.group_key === group.key
      && ["queued", "printing", "paused"].includes(job.status)
    );
    if (!labelsComplete || activeJob) return;
    setAutoOpenMarkingGroupKey("");
    setAssemblyMarkingGroupKey(group.key);
    setAssemblyMarkingOrderId(null);
    setAssemblyMarkingValue("");
    setAssemblyMarkingError("");
    setAssemblyMarkingMessage("Отсканируйте этикетку WB");
    setAssemblyMarkingModalOpen(true);
  }, [activeStep, activeSupplyId, autoOpenMarkingGroupKey, batchGroups, data.printJobs]);

  useEffect(() => {
    if (!assemblyMarkingModalOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    focusAssemblyMarkingScanner(false, 80);
    return () => { document.body.style.overflow = previousOverflow; };
  }, [assemblyMarkingModalOpen, focusAssemblyMarkingScanner]);

  useEffect(() => {
    if (!assemblyMarkingModalOpen || !assemblyMarkingGroupOrders.length || assemblyMarkingGroupRemaining > 0) return;
    const timer = window.setTimeout(() => setAssemblyMarkingModalOpen(false), 900);
    return () => window.clearTimeout(timer);
  }, [assemblyMarkingGroupOrders.length, assemblyMarkingGroupRemaining, assemblyMarkingModalOpen]);
  const selectedNewOrders = useMemo(() => newOrders.filter((order) => selectedNew.has(order.order_id)), [newOrders, selectedNew]);
  const selectedOrdersAllowedForPvz = selectedNewOrders.length > 0 && selectedNewOrders.every((order) => order.raw_json?.isPickupPointShipmentAllowed === true);
  const generatedSupplyName = useMemo(() => {
    const date = new Date().toLocaleDateString("ru-RU");
    if (!selectedNewOrders.length) return `FBS — ${date}`;
    const warehouseIds = Array.from(new Set(selectedNewOrders.map((order) => Number(order.warehouse_id || 0)).filter(Boolean)));
    if (warehouseIds.length !== 1) return `Несколько складов — FBS — ${date}`;
    const warehouseId = warehouseIds[0];
    const warehouseName = warehouseNameById.get(warehouseId) || `Склад №${warehouseId}`;
    return `${warehouseName} — FBS — ${date}`;
  }, [selectedNewOrders, warehouseNameById]);
  const compatibleExistingSupplies = useMemo(() => openSupplies.filter((supply) => {
    if (supply.delivery_mode === "pvz" && supply.boxes_count > 0) return false;
    if (!selectedNewOrders.length) return true;
    const currentOrders = data.orders.filter((order) => order.supply_id === supply.supply_id);
    if (supply.order_count > 0 && currentOrders.length !== supply.order_count) return false;
    const combined = [...currentOrders, ...selectedNewOrders];
    const first = combined[0];
    if (!first) return true;
    const firstCargo = Number(first.raw_json?.cargoType ?? -1);
    const firstWarehouse = Number(first.warehouse_id || 0);
    const firstCrossBorder = Number(first.raw_json?.crossBorderType ?? -1);
    const firstOptions = first.raw_json?.options as { isB2B?: boolean; isB2b?: boolean } | undefined;
    const firstB2b = Boolean(firstOptions?.isB2B ?? firstOptions?.isB2b);
    return combined.every((order) =>
      Number(order.raw_json?.cargoType ?? -1) === firstCargo
      && Number(order.warehouse_id || 0) === firstWarehouse
      && Number(order.raw_json?.crossBorderType ?? -1) === firstCrossBorder
      && Boolean((order.raw_json?.options as { isB2B?: boolean; isB2b?: boolean } | undefined)?.isB2B ?? (order.raw_json?.options as { isB2B?: boolean; isB2b?: boolean } | undefined)?.isB2b) === firstB2b,
    );
  }), [data.orders, openSupplies, selectedNewOrders]);
  useEffect(() => {
    if (activeStep === "assembly" && assemblyMode === "single") window.setTimeout(() => {
      scanRef.current?.focus({ preventScroll: true });
    }, 50);
    if (activeStep === "marking" && markingOrders.length && !markingOrders.some((order) => order.order_id === selectedOrderId)) {
      const first = markingOrders[0];
      setSelectedOrderId(first.order_id);
      setMetaType((effectiveRequiredMeta(first, data.markingPolicy)[0] || getFbsReviewOptionalMeta(first.optional_meta)[0] || "sgtin") as MetaType);
    }
  }, [activeStep, assemblyMode, data.markingPolicy, markingOrderKey, selectedOrderId]);

  useEffect(() => {
    if (!taskGroup) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (singlePrintOrderId) setSinglePrintOrderId(null);
        else if (batchReprintConfirmOpen) setBatchReprintConfirmOpen(false);
        else setTaskGroupKey("");
      }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [batchReprintConfirmOpen, singlePrintOrderId, taskGroup]);

  useEffect(() => {
    if (activeStep !== "assembly" || assemblyMode !== "batch") {
      setTaskGroupKey("");
      setSinglePrintOrderId(null);
      setBatchReprintConfirmOpen(false);
      setAssemblyMarkingOrderId(null);
      setAssemblyMarkingValue("");
    }
  }, [activeStep, assemblyMode]);

  useEffect(() => {
    setAssemblyMarkingOrderId(null);
    setAssemblyMarkingValue("");
    setAssemblyMarkingStatus({});
    setAssemblyMarkingMessage("Сканируйте этикетку WB на товаре");
  }, [activeSupplyId]);

  useEffect(() => {
    if (!openSupplies.length) {
      setSupplyTarget("new");
      setExistingSupplyId("");
      return;
    }
    if (supplyTarget === "existing" && !compatibleExistingSupplies.some((supply) => supply.supply_id === existingSupplyId)) {
      setExistingSupplyId(compatibleExistingSupplies[0]?.supply_id || "");
    }
  }, [compatibleExistingSupplies, existingSupplyId, openSupplies.length, supplyTarget]);

  useEffect(() => {
    if (supplyTarget === "new") setSupplyName(generatedSupplyName);
  }, [generatedSupplyName, supplyTarget]);

  useEffect(() => {
    if (deliveryMode === "pvz" && selectedNewOrders.length > 0 && !selectedOrdersAllowedForPvz) setDeliveryMode("warehouse");
  }, [deliveryMode, selectedNewOrders.length, selectedOrdersAllowedForPvz]);

  function compatibleOrdersFor(order: Order) {
    const cargo = Number(order.raw_json?.cargoType ?? -1);
    const warehouseId = Number(order.warehouse_id || 0);
    const crossBorder = Number(order.raw_json?.crossBorderType ?? -1);
    const options = order.raw_json?.options as { isB2B?: boolean; isB2b?: boolean } | undefined;
    const isB2b = Boolean(options?.isB2B ?? options?.isB2b);
    return newOrders.filter((row) => {
      const rowOptions = row.raw_json?.options as { isB2B?: boolean; isB2b?: boolean } | undefined;
      return Number(row.raw_json?.cargoType ?? -1) === cargo
        && Number(row.warehouse_id || 0) === warehouseId
        && Number(row.raw_json?.crossBorderType ?? -1) === crossBorder
        && Boolean(rowOptions?.isB2B ?? rowOptions?.isB2b) === isB2b;
    });
  }

  function compatibleGroupSelected(order: Order) {
    const compatible = compatibleOrdersFor(order);
    return compatible.length > 0 && compatible.every((row) => selectedNew.has(row.order_id));
  }

  function toggleCompatible(order: Order) {
    const compatible = compatibleOrdersFor(order);
    const cancel = compatible.length > 0 && compatible.every((row) => selectedNew.has(row.order_id));
    setSelectedNew((current) => {
      const next = new Set(current);
      for (const row of compatible) cancel ? next.delete(row.order_id) : next.add(row.order_id);
      return next;
    });
    setNotice(cancel ? `Снято совместимых заказов: ${compatible.length}.` : `Выбрано совместимых заказов: ${compatible.length}.`);
  }

  function toggleAllNewOrders() {
    setSelectedNew(allNewSelected ? new Set() : new Set(newOrders.map((order) => order.order_id)));
  }

  async function sync() {
    lastActionSnapshotRef.current = null;
    const result = await action("sync", { action: "sync" }) as { newOrders?: number };
    const refreshedSnapshot = lastActionSnapshotRef.current as Snapshot | null;
    const refreshedOrders = (refreshedSnapshot?.orders || []).filter(isNewFbsOrder);
    setPickSheetOrders(refreshedOrders);
    setPickSheetCreatedAt(Date.now());
    setClockNow(Date.now());
    const newOrdersCount = Number(result?.newOrders || 0);
    setNotice(newOrdersCount > 0 ? `Получено новых заказов: ${newOrdersCount}.` : "Новых заказов нет.");
  }

  async function createSupply(confirmed = false) {
    if (!selectedNew.size) return setError("Выберите заказы для поставки");
    if (supplyTarget === "existing" && !existingSupplyId) return setError("Выберите существующую совместимую поставку");
    if (supplyTarget === "existing" && !confirmed) {
      setAddConfirmOpen(true);
      return;
    }
    setAddConfirmOpen(false);
    const result = supplyTarget === "existing"
      ? await action("add_to_supply", { action: "add_to_supply", supplyId: existingSupplyId, orderIds: Array.from(selectedNew) })
      : await action("create_supply", { action: "create_supply", name: supplyName, deliveryMode, orderIds: Array.from(selectedNew) });
    setPickSheetOrders(null); setPickSheetCreatedAt(0);
    setSelectedNew(new Set()); setActiveSupplyId(result.supplyId); setActiveStep("assembly");
    const requested = Number(result.requested || selectedNew.size);
    const added = Number(result.added || requested);
    const failed = Number(result.failed || Math.max(0, requested - added));
    setNotice(result.partial
      ? `В поставку ${result.supplyId} добавлено ${added} из ${requested}. ${failed} осталось в «Новых».`
      : supplyTarget === "existing"
        ? `${added} заказов добавлено в поставку ${result.supplyId}.`
        : `Поставка ${result.supplyId} создана. ${added} заказов переведено «На сборке».`);
    window.setTimeout(() => scanRef.current?.focus({ preventScroll: true }), 100);
  }

  async function moveToShipping(message: string) {
    if (!allMarked) return setError("Сначала завершите сборку, печать и обязательную маркировку всех этикеток");
    if (!allPacked) await action("finalize", { action: "mark_packed", orderIds: supplyOrders.map((order) => order.order_id) });
    setPreflight(null);
    setActiveStep("shipping");
    setNotice(message);
  }

  function openStep(step: WorkflowStep) {
    if (step === "marking" && markingStepInactive) return;
    if (step === "marking" && activeStep === "assembly" && assemblyMode === "batch" && !allAssemblySgtinReady) {
      setError("Сначала завершите маркировку при сборке: WB должен принять все обязательные DataMatrix");
      focusAssemblyMarkingScanner(true);
      return;
    }
    if (step === "shipping" && activeSupply && allMarked && !allPacked) {
      void moveToShipping("Подготовка завершена. Выполните контрольную проверку перед отгрузкой.");
      return;
    }
    setActiveStep(step);
    if (step === "tasks") setSupplyTarget(openSupplies.length ? "existing" : "new");
    setError("");
    setNotice("");
  }

  async function finishAssembly() {
    if (!allPicked) return setError("Сначала соберите все товары поставки");
    if (!allPrinted) return setError("Сначала напечатайте все этикетки WB");
    if (assemblyMode === "batch" && !allAssemblySgtinReady) return setError("Сначала отсканируйте и дождитесь принятия WB всех обязательных DataMatrix");
    if (markingOrders.length > 0) {
      setActiveStep("marking");
      setNotice(`Сборка и DataMatrix завершены. На этапе маркировки выполните контрольную сверку: ${markingOrders.length} ${labelWord(markingOrders.length)}.`);
      return;
    }
    await moveToShipping("Маркировка не требуется. Выполните контрольную проверку перед отгрузкой.");
  }

  function printPickSheet() {
    if (!pickSheetOrders?.length || !pickSheetCreatedAt) {
      setError("Сначала получите новые заказы, чтобы сформировать актуальный лист подбора");
      return;
    }
    const root = document.documentElement;
    const cleanup = () => root.classList.remove("fbs-pick-sheet-printing");
    root.classList.add("fbs-pick-sheet-printing");
    window.addEventListener("afterprint", cleanup, { once: true });
    window.setTimeout(() => window.print(), 50);
    window.setTimeout(cleanup, 120_000);
  }

  async function submitAssemblyMarkingScan(event: React.FormEvent) {
    event.preventDefault();
    const value = assemblyMarkingValue;
    if (!value || assemblyMarkingBusy) return;
    setAssemblyMarkingValue("");
    setError("");

    if (!assemblyMarkingOrder) {
      setAssemblyMarkingBusy(true);
      try {
        const order = await compactFbsAction({ action: "scan_sticker", supplyId: activeSupplyId, value }) as Order;
        if (!assemblyMarkingGroupOrders.some((candidate) => candidate.order_id === order.order_id)) {
          throw new Error("Эта этикетка относится к другой пачке. Отсканируйте этикетку текущего товара");
        }
        if (sgtinReady(order)) throw new Error(`${fbsLabelText(order)}: «Честный знак» уже принят WB`);
        if (metaPending(order) || ["sending", "pending"].includes(assemblyMarkingStatus[order.order_id]?.state || "")) {
          throw new Error(`${fbsLabelText(order)}: «Честный знак» уже проверяется WB`);
        }
        setAssemblyMarkingOrderId(order.order_id);
        setAssemblyMarkingMessage(`${fbsLabelText(order)} найдена. Отсканируйте «Честный знак»`);
        setAssemblyMarkingError("");
        playScanTone(true);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : "Не удалось распознать этикетку WB";
        setAssemblyMarkingMessage(message);
        setAssemblyMarkingError(message);
        setError(message);
        playScanTone(false);
      } finally {
        setAssemblyMarkingBusy(false);
        focusAssemblyMarkingScanner(true);
      }
      return;
    }

    try {
      parseFbsDataMatrix(value);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Это не код «Честного знака»";
      setAssemblyMarkingMessage(message);
      setAssemblyMarkingError(message);
      setError(message);
      playScanTone(false);
      focusAssemblyMarkingScanner(true);
      return;
    }

    const orderId = assemblyMarkingOrder.order_id;
    const label = fbsLabelText(assemblyMarkingOrder);
    setAssemblyMarkingOrderId(null);
    setAssemblyMarkingError("");
    setAssemblyMarkingStatus((current) => ({ ...current, [orderId]: { state: "sending", message: "Отправляем WB", updatedAt: new Date().toISOString() } }));
    setAssemblyMarkingMessage(`${label}: «Честный знак» отправляется WB. Сканируйте следующую этикетку WB`);
    playScanTone(true);
    focusAssemblyMarkingScanner(true);

    void compactFbsAction({ action: "attach_assembly_sgtin", orderId, value })
      .then((result: { verification?: string }) => {
        const filled = result?.verification === "filled";
        setAssemblyMarkingStatus((current) => ({
          ...current,
          [orderId]: { state: filled ? "filled" : "pending", message: filled ? "Принят WB" : "Проверяется WB", updatedAt: new Date().toISOString() },
        }));
      })
      .catch((cause) => {
        const message = cause instanceof Error ? cause.message : "WB не принял код «Честного знака»";
        setAssemblyMarkingStatus((current) => ({ ...current, [orderId]: { state: "error", message, updatedAt: new Date().toISOString() } }));
        setAssemblyMarkingMessage(`${label}: ${message}`);
        setAssemblyMarkingError(`${label}: ${message}`);
        setError(`${label}: ${message}`);
        playScanTone(false);
      });
  }

  function cancelAssemblyMarkingPair() {
    setAssemblyMarkingOrderId(null);
    setAssemblyMarkingValue("");
    setAssemblyMarkingError("");
    setAssemblyMarkingMessage("Отсканируйте этикетку WB");
    focusAssemblyMarkingScanner(false);
  }

  function openAssemblyMarkingBatch(group: BatchGroup) {
    setAssemblyMarkingGroupKey(group.key);
    setAssemblyMarkingOrderId(null);
    setAssemblyMarkingValue("");
    setAssemblyMarkingError("");
    setAssemblyMarkingMessage("Отсканируйте этикетку WB");
    setAssemblyMarkingModalOpen(true);
  }

  async function printBatch(group: BatchGroup) {
    if (!printAgentReady) {
      setError(`Печать недоступна. Откройте раздел «Принтер». Код ${currentPrinterProblem.code}.`);
      return;
    }
    const remaining = group.orders.filter((order) => !order.picked_at).length;
    if (!remaining) return;
    const result = await action("batch_print", {
      action: "create_batch_print",
      supplyId: activeSupplyId,
      nmId: group.order.nm_id,
      chrtId: group.order.chrt_id,
      sku: group.sku,
    });
    const groupNeedsSgtin = group.orders.some((order) =>
      effectiveRequiredMeta(order, data.markingPolicy).includes("sgtin")
    );
    if (groupNeedsSgtin) setAutoOpenMarkingGroupKey(group.key);
    setNotice(`${result.total_count} ${labelWord(result.total_count)} передано на печать.`);
  }

  async function printSingleLabel(order: Order) {
    if (!printAgentReady) {
      setError(`Печать недоступна. Откройте раздел «Принтер». Код ${currentPrinterProblem.code}.`);
      return;
    }
    const reprint = Boolean(order.sticker_printed_at);
    const result = await action(`single_print_${order.order_id}`, { action: "create_single_print", orderId: order.order_id }) as { sticker_number?: string };
    setSinglePrintOrderId(null);
    setNotice(`Этикетка ${result.sticker_number || fbsStickerNumber(order) || "WB"} ${reprint ? "повторно " : ""}передана на печать.`);
  }

  async function reprintTaskGroup(group: BatchGroup) {
    if (!printAgentReady) {
      setError(`Печать недоступна. Откройте раздел «Принтер». Код ${currentPrinterProblem.code}.`);
      return;
    }
    const result = await action("batch_reprint", {
      action: "create_batch_reprint",
      orderIds: group.orders.map((order) => order.order_id),
    }) as PrintJob;
    setBatchReprintConfirmOpen(false);
    setNotice(`${result.total_count} ${labelWord(result.total_count)} повторно передано на печать. Статусы заданий не изменятся.`);
  }

  async function continuePrint(job: PrintJob) {
    if (!printAgentReady) {
      setError(`Сначала восстановите печать в разделе «Принтер». Код ${currentPrinterProblem.code}.`);
      return;
    }
    const lastBarcode = window.prompt("Если последняя этикетка вышла нормально — отсканируйте её ШК. Если не вышла, оставьте поле пустым.", "");
    if (lastBarcode === null) return;
    await action("continue_print", { action: "resume_print_job", jobId: job.job_id, lastBarcode });
    setNotice("Печать продолжена.");
  }

  async function printSupplyQrViaAgent() {
    if (!printAgentReady) {
      setError(`Печать недоступна. Откройте раздел «Принтер». Код ${currentPrinterProblem.code}.`);
      return;
    }
    const result = await action("supply_qr_print", { action: "print_supply_qr", supplyId: activeSupplyId }) as PrintJob;
    setNotice(result.status === "completed"
      ? "QR этой поставки уже напечатан. Повторное задание не создано."
      : result.status === "paused"
        ? "Печать QR поставки ожидает продолжения."
        : "QR поставки надёжно сохранён в очереди и передан на Zebra.");
  }

  async function continueSupplyQrPrint(job: PrintJob) {
    if (!printAgentReady) {
      setError(`Сначала восстановите печать в разделе «Принтер». Код ${currentPrinterProblem.code}.`);
      return;
    }
    await action("supply_qr_resume", { action: "resume_print_job", jobId: job.job_id, lastBarcode: "" });
    setNotice("Печать QR поставки продолжена.");
  }

  async function createPickupPointBoxes() {
    if (!activeSupply) return;
    const maximum = Math.floor(activeSupply.order_count / 2);
    const remaining = Math.max(0, maximum - activeSupply.boxes_count);
    if (remaining < 1) return setError(`В каждом коробе ПВЗ должно быть минимум 2 заказа. Максимум для этой поставки: ${maximum}`);
    const amount = Number(window.prompt(`Сколько грузомест добавить? Доступно: ${remaining}`, "1"));
    if (!Number.isSafeInteger(amount) || amount < 1) return;
    if (amount > remaining) return setError(`Можно добавить не более ${remaining} грузомест`);
    await action("boxes", { action: "create_boxes", supplyId: activeSupplyId, amount });
    setPreflight(null);
    setNotice(`Добавлено грузомест: ${amount}. Теперь напечатайте их QR.`);
  }

  async function printPickupPointBoxes(boxId = "") {
    if (!printAgentReady) {
      setError(`Печать недоступна. Откройте раздел «Принтер». Код ${currentPrinterProblem.code}.`);
      return;
    }
    const result = await action(boxId ? `box_print_${boxId}` : "boxes_print", {
      action: boxId ? "print_single_box" : "print_boxes",
      supplyId: activeSupplyId,
      ...(boxId ? { boxId } : {}),
    }) as PrintJob;
    setPreflight(null);
    setNotice(result.status === "completed"
      ? "QR уже был напечатан."
      : boxId ? `QR грузоместа ${boxId} передан на повторную печать.` : `${result.total_count} QR грузомест передано на Zebra.`);
  }

  async function continuePickupPointBoxes(job: PrintJob) {
    if (!printAgentReady) {
      setError(`Сначала восстановите печать в разделе «Принтер». Код ${currentPrinterProblem.code}.`);
      return;
    }
    await action("boxes_print_resume", { action: "resume_print_job", jobId: job.job_id, lastBarcode: "" });
    setNotice("Печать QR грузомест продолжена.");
  }

  async function deletePickupPointBoxes() {
    if (!activeSupply?.boxes_count) return;
    const confirmation = window.prompt(`Удалить все грузоместа (${activeSupply.boxes_count}) и создать заново? Введите УДАЛИТЬ`);
    if (confirmation !== "УДАЛИТЬ") return;
    await action("delete_boxes", { action: "delete_boxes", supplyId: activeSupplyId, confirmation });
    setPreflight(null);
    setNotice("Грузоместа удалены. Укажите правильное количество и создайте заново.");
  }

  async function confirmPickupPointRules() {
    await action("confirm_pvz_rules", { action: "confirm_pvz_rules", supplyId: activeSupplyId, confirmation: "ПОДТВЕРЖДАЮ" });
    setPreflight(null);
    setNotice("Требования ПВЗ подтверждены.");
  }

  async function submitProductScan(event: React.FormEvent) {
    event.preventDefault();
    if (!activeSupplyId || !scanValue) return;
    const popup = autoPrint ? window.open("", "_blank") : null;
    if (popup) popup.document.write("<p style='font-family:sans-serif'>Товар найден. Получаем стикер WB…</p>");
    try {
      const result = await action("scan", { action: "scan_product", supplyId: activeSupplyId, value: scanValue });
      setScanValue(""); setSelectedOrderId(result.orderId);
      if (autoPrint) {
        const stickers = await action("print_scan", { action: "print_orders", orderIds: [result.orderId], width: 58 });
        if (!popup) throw new Error("Браузер заблокировал автопечать — разрешите всплывающие окна для MpHub");
        renderPrintPopup(popup, stickers);
        setNotice(`Найдено: ${result.productName || result.vendorCode}. Этикетка отправлена на печать.`);
      } else {
        popup?.close();
        setNotice(`Найдено: ${result.productName || result.vendorCode}.`);
      }
    } catch (cause) {
      if (popup && !popup.closed) popup.close();
      throw cause;
    } finally {
      window.setTimeout(() => scanRef.current?.focus({ preventScroll: true }), 50);
    }
  }

  function renderPrintPopup(popup: Window, result: unknown) {
    const stickers = Array.isArray(result) ? result : [result];
    const images = stickers.map((row: { file: string }) => `<img src="data:image/png;base64,${row.file}" />`).join("");
    popup.document.open();
    popup.document.write(`<!doctype html><html><head><title>Печать WB</title><style>@page{size:58mm 40mm;margin:0}body{margin:0}img{width:58mm;height:40mm;object-fit:contain;display:block;page-break-after:always}</style></head><body>${images}<script>window.onload=()=>window.print()<\/script></body></html>`);
    popup.document.close();
    return stickers.length;
  }

  async function printImages(actionName: "print_orders" | "print_boxes", body: Record<string, unknown>) {
    const popup = window.open("", "_blank");
    if (popup) popup.document.write("<p style='font-family:sans-serif'>Получаем этикетки WB…</p>");
    try {
      const result = await action(actionName, { action: actionName, ...body });
      if (!popup) throw new Error("Браузер заблокировал окно печати — разрешите всплывающие окна для MpHub");
      const count = renderPrintPopup(popup, result);
      setNotice(`Подготовлено этикеток: ${count}.`);
    } catch (cause) { popup?.close(); throw cause; }
  }

  async function submitMeta(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedOrder || !metaValue) return;
    const result = await action("meta", { action: "attach_meta", orderId: selectedOrder.order_id, metaType, value: metaValue });
    setMetaValue(""); setNotice(metaType === "sgtin"
      ? result?.verification === "pending"
        ? `${fbsLabelText(selectedOrder)}: DataMatrix передан WB. Проверка продолжается.`
        : `${fbsLabelText(selectedOrder)}: DataMatrix проверен и принят WB.`
      : `${fbsLabelText(selectedOrder)}: ${META_LABELS[metaType]} принят WB.`);
  }

  async function runPreflight() {
    const result = await action("preflight", { action: "preflight", supplyId: activeSupplyId });
    setPreflight(result); setNotice(result.ready ? "Поставка прошла все проверки." : "Есть блокирующие замечания — исправьте их до передачи.");
  }

  async function deliver() {
    const confirmation = window.prompt("Операция необратима. Для передачи поставки в доставку введите ПЕРЕДАТЬ");
    if (confirmation !== "ПЕРЕДАТЬ") return;
    await action("deliver", { action: "deliver", supplyId: activeSupplyId, confirmation });
    setNotice(activeSupply?.delivery_mode === "pvz"
      ? "Поставка передана в доставку. Теперь распечатайте основной QR-код поставки."
      : "Поставка передана в доставку. Теперь распечатайте QR-код поставки.");
  }

  function startNewCycle() {
    const nextOpen = openSupplies[0];
    window.sessionStorage.removeItem("fbs.activeSupplyId");
    setActiveSupplyId("");
    setSelectedNew(new Set());
    setSelectedOrderId(null);
    setScanValue("");
    setMetaValue("");
    setPreflight(null);
    setExistingSupplyId(nextOpen?.supply_id || "");
    setSupplyTarget(nextOpen ? "existing" : "new");
    setActiveStep("tasks");
    setError("");
    setNotice("Новый цикл начат. Выберите заказы для следующей поставки.");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (loading) return <div className="flex min-h-[60vh] items-center justify-center"><Loader2 className="animate-spin text-[var(--accent)]" /></div>;

  return (
    <main className="fbs-portal-content space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-bold">FBS — сборка и отгрузка</h1>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={printPickSheet} disabled={!pickSheetOrders?.length || Boolean(busy)} title={!pickSheetOrders?.length ? "Сначала получите новые заказы" : "Открыть печать листа подбора в формате A4"} className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-2 font-medium transition hover:border-[var(--accent)] hover:bg-[var(--accent)]/10 hover:text-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-40"><FileText size={17} />Лист подбора{pickSheetOrders?.length ? ` · ${pickSheetOrders.length}` : ""}</button>
          <button onClick={() => void sync()} disabled={Boolean(busy)} className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 font-medium text-white disabled:opacity-50">{busy === "sync" ? <Loader2 size={17} className="animate-spin" /> : <RefreshCw size={17} />}Получить новые заказы</button>
        </div>
      </div>

      {pickSheetOrders && pickSheetCreatedAt > 0 && <FbsPickSheet orders={pickSheetOrders} createdAt={pickSheetCreatedAt} />}

      {(error || notice) && <div className="pointer-events-none fixed inset-x-4 top-4 z-[100] flex flex-col items-end gap-2 sm:left-auto sm:w-[420px]" aria-live="polite">
        {error && <div role="alert" className="pointer-events-auto flex w-full items-start gap-3 rounded-xl border border-red-500/40 bg-[var(--bg-card)] p-4 text-red-500 shadow-2xl"><AlertTriangle className="mt-0.5 shrink-0" size={19} /><span className="min-w-0 flex-1">{error}</span><button type="button" onClick={() => setError("")} className="shrink-0 rounded px-2 text-xl leading-none text-[var(--text-muted)] hover:bg-red-500/10 hover:text-red-500" aria-label="Закрыть ошибку">×</button></div>}
        {notice && <div role="status" className="pointer-events-auto flex w-full items-start gap-3 rounded-xl border border-emerald-500/40 bg-[var(--bg-card)] p-4 text-emerald-500 shadow-2xl"><CheckCircle2 className="mt-0.5 shrink-0" size={19} /><span className="min-w-0 flex-1">{notice}</span><button type="button" onClick={() => setNotice("")} className="shrink-0 rounded px-2 text-xl leading-none text-[var(--text-muted)] hover:bg-emerald-500/10 hover:text-emerald-500" aria-label="Закрыть уведомление">×</button></div>}
      </div>}

      <section className="grid gap-2 md:grid-cols-4">
        {([
          { id: "tasks", title: "1. Новые заказы", value: `${newOrders.length} новых`, complete: Boolean(activeSupply), disabled: false },
          { id: "assembly", title: "2. Сборка", value: activeSupply ? `${picked}/${supplyOrders.length}` : "выберите поставку", complete: allPicked, disabled: false },
          { id: "marking", title: "3. Маркировка", value: markingStepInactive ? "не требуется" : activeSupply ? `${marked}/${markingOrders.length}` : "—", complete: markingStepInactive ? false : allMarked, disabled: markingStepInactive },
          { id: "shipping", title: "4. Отгрузка", value: activeSupply?.done ? "передано" : "контроль", complete: Boolean(activeSupply?.done), disabled: false },
        ] as Array<{ id: WorkflowStep; title: string; value: string; complete: boolean; disabled: boolean }>).map((step) => {
          const active = activeStep === step.id && !step.disabled;
          return <button type="button" key={step.id} disabled={step.disabled} onClick={() => openStep(step.id)} className={`relative rounded-xl border px-4 py-3 text-left transition ${step.disabled ? "cursor-not-allowed border-slate-500/20 bg-slate-500/5 text-[var(--text-muted)] opacity-55" : active ? "border-[var(--accent)] bg-[var(--accent)]/10 shadow-sm" : "border-[var(--border)] bg-[var(--bg-card)] hover:bg-[var(--bg-card-hover)]"}`}>
            {step.complete && <CheckCircle2 size={17} className="absolute right-3 top-3 text-emerald-500" />}
            <div className="font-semibold">{step.title}</div><div className="text-sm text-[var(--text-muted)]">{step.value}</div>
          </button>;
        })}
      </section>

      {activeStep === "tasks" && <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
        <div className="mb-3 flex gap-2">
          <button type="button" onClick={() => setSupplyTarget("new")} className={`rounded-lg px-4 py-2 text-sm font-medium ${supplyTarget === "new" ? "bg-[var(--accent)] text-white" : "border border-[var(--border)]"}`}>Создать новую</button>
          <button type="button" disabled={!openSupplies.length} onClick={() => setSupplyTarget("existing")} className={`rounded-lg px-4 py-2 text-sm font-medium disabled:cursor-not-allowed ${supplyTarget === "existing" && openSupplies.length ? "bg-[var(--accent)] text-white shadow-sm" : openSupplies.length ? "border border-[var(--border)]" : "border border-[var(--border)] bg-[var(--bg)] text-[var(--text-muted)] opacity-50"}`}>Добавить в существующую</button>
        </div>
        {supplyTarget === "new" ? <div className="grid gap-3 md:grid-cols-[1fr_190px_auto]">
          <input value={supplyName} onChange={(e) => setSupplyName(e.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2" placeholder="Название поставки" />
          <select value={deliveryMode} onChange={(e) => setDeliveryMode(e.target.value as "warehouse" | "pvz")} className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"><option value="warehouse">Склад / СЦ</option><option value="pvz" disabled={!selectedOrdersAllowedForPvz}>ПВЗ{selectedNewOrders.length && !selectedOrdersAllowedForPvz ? " — недоступно" : ""}</option></select>
          <button onClick={() => void createSupply()} disabled={!selectedNew.size || Boolean(busy)} className="rounded-lg bg-[var(--accent)] px-4 py-2 font-medium text-white disabled:opacity-40">Создать и передать на сборку</button>
          {selectedNewOrders.length > 0 && !selectedOrdersAllowedForPvz && <div className="text-sm text-amber-500 md:col-span-3">Для выбранных заказов WB разрешает только склад / СЦ.</div>}
        </div> : <div className="grid gap-3 md:max-w-[1040px] md:grid-cols-[minmax(360px,1fr)_auto]">
          <select value={existingSupplyId} onChange={(e) => setExistingSupplyId(e.target.value)} className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"><option value="">Выберите совместимую открытую поставку</option>{compatibleExistingSupplies.map((supply) => <option key={supply.supply_id} value={supply.supply_id}>{supply.name} · {supply.supply_id} · сейчас {supply.order_count} шт.</option>)}</select>
          <div ref={addConfirmRef} className="relative">
            <button ref={addConfirmButtonRef} type="button" onClick={() => void createSupply()} disabled={!selectedNew.size || !existingSupplyId || Boolean(busy)} className="h-full w-full rounded-lg bg-[var(--accent)] px-4 py-2 font-medium text-white disabled:opacity-40">Добавить и перейти к сборке</button>
            {addConfirmOpen && <div role="alertdialog" aria-modal="false" aria-label="Подтверждение добавления в поставку" className="absolute bottom-full right-0 z-40 mb-2 w-[min(380px,calc(100vw-2rem))] rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 text-left shadow-2xl xl:bottom-0 xl:left-[calc(100%+12px)] xl:right-auto xl:mb-0">
              <div className="font-semibold">Добавить {selectedNew.size} {orderWord(selectedNew.size)}?</div>
              <p className="mt-1 text-sm leading-relaxed text-[var(--text-muted)]">В поставку «{compatibleExistingSupplies.find((supply) => supply.supply_id === existingSupplyId)?.name || existingSupplyId}».</p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => { setAddConfirmOpen(false); addConfirmButtonRef.current?.focus(); }} className="rounded-lg border border-[var(--border)] px-3 py-2 font-medium transition hover:bg-[var(--bg-card-hover)]">Отмена</button>
                <button type="button" autoFocus onClick={() => void createSupply(true)} disabled={Boolean(busy)} className="rounded-lg bg-[var(--accent)] px-3 py-2 font-medium text-white disabled:opacity-45">{busy === "add_to_supply" ? "Добавляем…" : "Да, добавить"}</button>
              </div>
            </div>}
          </div>
          {selectedNew.size > 0 && compatibleExistingSupplies.length === 0 && <div className="text-sm text-amber-500 md:col-span-2">Нет открытых поставок, совместимых по складу, габариту, cross-border и B2B/B2C. Создайте новую поставку.</div>}
        </div>}
      </section>}

      {activeStep === "tasks" && <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold">1. Новые заказы</h2><span className="text-sm text-[var(--text-muted)]">Выбрано: {selectedNew.size}</span></div>
        <div className="max-h-[704px] overflow-auto rounded-lg border border-[var(--border)]">
          {newOrders.length > 0 && <label className="sticky top-0 z-10 flex cursor-pointer items-center gap-2 border-b border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm font-medium md:hidden"><input ref={selectAllNewMobileRef} type="checkbox" checked={allNewSelected} onChange={toggleAllNewOrders} aria-label={allNewSelected ? "Снять выделение со всех заказов" : "Выбрать все заказы"} /><span>{allNewSelected ? "Снять выделение со всех" : "Выбрать все заказы"}</span></label>}
          {newOrders.length > 0 && <div className="sticky top-0 z-10 hidden grid-cols-[32px_190px_minmax(320px,1fr)_170px_190px] items-center gap-3 border-b border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)] md:grid"><span className="flex justify-center"><input ref={selectAllNewRef} type="checkbox" checked={allNewSelected} onChange={toggleAllNewOrders} aria-label={allNewSelected ? "Снять выделение со всех заказов" : "Выбрать все заказы"} /></span><span>Заказ</span><span>Товар</span><span className="text-center">Склад</span><span className="text-center">Действие</span></div>}
          {newOrders.length === 0 ? <div className="p-6 text-center text-[var(--text-muted)]">Новых заказов нет. Нажмите «Получить новые заказы».</div> : newOrders.map((order) => (
            <label key={order.order_id} className="grid cursor-pointer grid-cols-[32px_minmax(0,1fr)] items-center gap-3 border-b border-[var(--border)] p-3 last:border-0 hover:bg-[var(--bg-card-hover)] md:grid-cols-[32px_190px_minmax(320px,1fr)_170px_190px]">
              <input type="checkbox" checked={selectedNew.has(order.order_id)} onChange={(e) => setSelectedNew((current) => { const next = new Set(current); e.target.checked ? next.add(order.order_id) : next.delete(order.order_id); return next; })} />
              <div className="min-w-0"><div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)] md:hidden">Заказ</div><div className="font-mono text-base font-semibold tabular-nums">{order.order_id}</div><div className="mt-0.5 text-xs text-[var(--text-muted)]">от {formatOrderDate(order.created_at_wb)}</div><span className="mt-1.5 inline-flex rounded-md bg-emerald-500/15 px-2 py-1 text-xs font-medium text-emerald-700">{orderAge(order.created_at_wb, clockNow)}</span></div>
              <div className="col-start-2 flex min-w-0 items-center gap-3 md:col-auto"><ProductPhoto order={order} tall /><div className="min-w-0 flex-1"><div className="font-medium">{order.product_name || order.vendor_code || `Артикул ${order.nm_id}`}</div><div className="text-sm text-[var(--text-muted)]">{order.vendor_code} · WB {order.nm_id}{visibleSize(order.size_name || "") ? ` · ${visibleSize(order.size_name || "")}` : ""}</div>{order.created_at_wb && <div className={`mt-1 text-xs ${clockNow - new Date(order.created_at_wb).getTime() > 96 * 60 * 60_000 ? "font-semibold text-red-500" : "text-[var(--text-muted)]"}`}>До автoотмены: {Math.max(0, Math.ceil(120 - (clockNow - new Date(order.created_at_wb).getTime()) / 3_600_000))} ч.</div>}{order.reshipment_required && <span className="mt-1 inline-block rounded bg-red-500/10 px-2 py-1 text-xs text-red-500">Требуется повторная отгрузка</span>}</div></div>
              <div className="col-start-2 min-w-0 text-sm md:col-auto md:text-center"><div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--text-muted)] md:hidden">Склад</div><span className="block truncate text-[var(--text)]">{warehouseNameFor(order)}</span></div>
              <button type="button" onClick={(e) => { e.preventDefault(); e.stopPropagation(); toggleCompatible(order); }} className={`col-start-2 cursor-pointer rounded-lg border px-3 py-2 text-xs transition-colors md:col-auto ${compatibleGroupSelected(order) ? "border-amber-500/50 bg-amber-500/10 text-amber-500 hover:bg-amber-500/20" : "border-[var(--border)] hover:border-[var(--accent)] hover:bg-[var(--accent)]/10 hover:text-[var(--accent)] active:bg-[var(--accent)]/20"}`}>{compatibleGroupSelected(order) ? "Отменить совместимые" : "Выбрать совместимые"}</button>
            </label>
          ))}
        </div>
      </section>}

      {activeStep !== "tasks" && <section className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
        <div className={`grid w-full items-center gap-2 ${activeStep === "assembly" && activeSupply && assemblySgtinOrders.length > 0 ? "min-w-[830px] grid-cols-[auto_minmax(180px,1fr)_180px_190px_150px]" : "max-w-[760px] grid-cols-[auto_minmax(0,1fr)]"}`}>
          <label className="shrink-0 text-sm text-[var(--text-muted)]">Поставка</label>
          <select value={activeSupplyId} onPointerDown={pauseSupplyRefresh} onFocus={pauseSupplyRefresh} onBlur={resumeSupplyRefresh} onKeyDown={(event) => { if (event.key === "Escape") resumeSupplyRefresh(); }} onChange={(e) => { setActiveSupplyId(e.target.value); setPreflight(null); setTaskGroupKey(""); resumeSupplyRefresh(); }} className="h-[48px] min-w-0 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3"><option value="">Выберите поставку</option>{selectableSupplies.map((supply) => <option key={supply.supply_id} value={supply.supply_id}>{supply.name} · {supply.supply_id} · {supply.order_count} шт.{supply.done ? " · передана" : ""}</option>)}</select>
          {activeStep === "assembly" && activeSupply && assemblySgtinOrders.length > 0 && <>
            <button type="button" onClick={() => setAssemblyStatusPanel("accepted")} className="flex h-[48px] min-w-0 items-center gap-2 rounded-lg bg-emerald-500/10 px-3 text-left transition hover:bg-emerald-500/20"><span className="w-8 shrink-0 text-xl font-bold tabular-nums text-emerald-500">{assemblySgtinAccepted}</span><span className="whitespace-nowrap text-sm font-medium text-[var(--text)]">Принято WB</span></button>
            <button type="button" onClick={() => setAssemblyStatusPanel("pending")} className="flex h-[48px] min-w-0 items-center gap-2 rounded-lg bg-amber-500/10 px-3 text-left transition hover:bg-amber-500/20"><span className="w-8 shrink-0 text-xl font-bold tabular-nums text-amber-500">{assemblySgtinPending}</span><span className="whitespace-nowrap text-sm font-medium text-[var(--text)]">Проверяется</span></button>
            <button type="button" onClick={() => setAssemblyStatusPanel("errors")} className="flex h-[48px] min-w-0 items-center gap-2 rounded-lg bg-red-500/10 px-3 text-left transition hover:bg-red-500/20"><span className="w-8 shrink-0 text-xl font-bold tabular-nums text-red-500">{assemblySgtinErrors}</span><span className="whitespace-nowrap text-sm font-medium text-[var(--text)]">Ошибки</span></button>
          </>}
        </div>
        {!activeSupply && <div className="mt-4 rounded-lg border border-dashed border-[var(--border)] p-6 text-center text-[var(--text-muted)]">Сначала создайте поставку на этапе «Новые заказы» или выберите открытую рабочую поставку.</div>}
      </section>}

      {activeStep === "assembly" && activeSupply && <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><h2 className="text-lg font-semibold">2. Сборка товара</h2><div className="flex gap-2"><button type="button" disabled title="Штучный режим временно недоступен" onClick={() => setAssemblyMode("single")} className="cursor-not-allowed rounded-lg border border-[var(--border)] bg-[var(--bg)] px-4 py-2 text-sm font-medium text-[var(--text-muted)] opacity-45">Штучно</button><button type="button" onClick={() => setAssemblyMode("batch")} className={`rounded-lg px-4 py-2 text-sm font-medium ${assemblyMode === "batch" ? "bg-[var(--accent)] text-white" : "border border-[var(--border)]"}`}>Пачками</button></div></div>
        {assemblyMode === "single" ? <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
          <div className="space-y-3">
            <div className="rounded-xl border-2 border-[var(--accent)]/40 bg-[var(--accent)]/5 p-4"><div className="mb-2 flex items-center gap-2 font-semibold"><ScanLine size={20} />Сканирование товара</div><form onSubmit={submitProductScan} className="flex gap-2"><input ref={scanRef} value={scanValue} onChange={(e) => setScanValue(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-3 font-mono" placeholder="Фокус для сканера" autoComplete="off" /><button disabled={!scanValue || Boolean(busy)} className="rounded-lg bg-[var(--accent)] px-4 text-white"><ScanLine size={20} /></button></form><label className="mt-3 flex cursor-pointer items-center gap-2 text-sm"><input type="checkbox" checked={autoPrint} onChange={(e) => setAutoPrint(e.target.checked)} />Сразу печатать стикер WB 58×40</label></div>
            <div className="rounded-lg bg-[var(--bg)] p-3 text-sm">Собрано <strong>{picked} из {supplyOrders.length}</strong> · стикеры <strong>{printed} из {supplyOrders.length}</strong></div>
            {allPicked && !allPrinted && <button type="button" onClick={() => void printImages("print_orders", { orderIds: supplyOrders.filter((order) => !order.sticker_printed_at).map((order) => order.order_id), width: 58 })} disabled={Boolean(busy)} className="flex w-full items-center justify-center gap-2 rounded-lg border border-[var(--border)] px-4 py-3 font-medium disabled:opacity-35"><Printer size={18} />Напечатать недостающие стикеры ({supplyOrders.length - printed})</button>}
            <button type="button" onClick={() => void finishAssembly()} disabled={!assemblyReady || Boolean(busy)} className="flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-3 font-medium text-white disabled:opacity-35">{markingOrders.length ? "Сборка завершена — к маркировке" : "Сборка завершена — к отгрузке"}</button>
          </div>
          <div className="max-h-[560px] overflow-auto rounded-lg border border-[var(--border)]">{supplyOrders.map((order) => <div key={order.order_id} className="flex flex-col gap-3 border-b border-[var(--border)] p-3 last:border-0 md:flex-row md:items-stretch">
            <div className="flex min-w-0 flex-1 items-center gap-3"><ProductPhoto order={order} enlargeable large /><div className="min-w-0 flex-1"><div className="font-medium">{order.product_name || order.vendor_code}</div>{visibleSize(order.size_name || "") && <div className="mt-1 text-sm text-[var(--text-muted)]">Размер: {visibleSize(order.size_name || "")}</div>}<div className="mt-2 text-xs text-[var(--text-muted)]">Артикул: <span className="font-medium text-[var(--text)]">{order.vendor_code || "—"}</span></div></div></div>
            <div className="hidden w-px shrink-0 bg-[var(--border)] md:block" />
            <div className="grid min-w-0 gap-2 border-t border-[var(--border)] pt-3 md:w-[300px] md:border-0 md:pt-0"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Номер этикетки</div><div>{fbsStickerNumber(order) ? <HighlightedLabelNumber value={fbsStickerNumber(order)} /> : <span className="text-sm text-[var(--text-muted)]">Номер появится после печати</span>}</div></div>{statusPill(Boolean(order.picked_at), "товар")}</div><div><div className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">ШК товара</div><div className="break-all font-mono text-sm">{order.skus?.join(", ") || "не получен"}</div></div></div>
          </div>)}</div>
        </div> : <div className="space-y-4">
          {!printAgentReady && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-500/40 bg-red-500/5 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3"><AlertTriangle className="shrink-0 text-red-500" size={21} /><div><div className="font-semibold text-red-500">Печать недоступна · {currentPrinterProblem.code}</div><div className="text-sm text-[var(--text-muted)]">{currentPrinterProblem.title}</div></div></div>
            <Link href="/printer" className="shrink-0 rounded-lg bg-red-500 px-4 py-2 font-semibold text-white transition hover:brightness-110">Перейти к принтеру</Link>
          </div>}
          <div className="overflow-x-auto rounded-xl border border-[var(--border)]"><div className="min-w-[1050px]">
            <div className="grid grid-cols-[88px_minmax(260px,1fr)_1px_160px_210px_250px] items-center gap-4 bg-[var(--bg)] px-4 py-3 text-center text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"><span>Фото</span><span>Товар</span><span /><span>Этикетки</span><span>ШК товара</span><span>Действие</span></div>
            {batchSections.map((section) => {
              const sectionRequiresSgtin = section.articles.some((article) => article.groups.some((group) =>
                group.orders.some((order) => effectiveRequiredMeta(order, data.markingPolicy).includes("sgtin"))
              ));
              const categoryConfig = section.category === "backpack"
                ? { title: "Рюкзаки", subtitle: "Маркировка не требуется", color: "bg-sky-500/10 text-sky-500", badge: "bg-sky-500 text-white", icon: <Backpack size={24} /> }
                : section.category === "underwear"
                  ? sectionRequiresSgtin
                    ? { title: "Трусы", subtitle: "Честный знак обязателен", color: "bg-amber-500/10 text-amber-500", badge: "bg-amber-500 text-white", icon: <QrCode size={24} /> }
                    : { title: "Трусы", subtitle: "Маркировка не требуется", color: "bg-slate-500/10 text-slate-400", badge: "bg-slate-500 text-white", icon: <QrCode size={24} /> }
                  : { title: "Другие товары", subtitle: "Категория определяется отдельно", color: "bg-slate-500/10 text-slate-400", badge: "bg-slate-500 text-white", icon: <Package size={24} /> };
              return <div key={section.category}>
                <div className={`flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] px-5 py-4 ${categoryConfig.color}`}>
                  <div className="flex items-center gap-3">{categoryConfig.icon}<div><div className="text-lg font-bold text-[var(--text)]">{categoryConfig.title}</div><div className="text-sm text-[var(--text-muted)]">{categoryConfig.subtitle}</div></div></div>
                  <div className={`rounded-full px-3 py-1 text-sm font-semibold ${categoryConfig.badge}`}>{section.orderCount} {orderWord(section.orderCount)}</div>
                </div>
                {section.articles.map((articleGroup, articleIndex) => <div key={`${articleGroup.state}:${articleGroup.wbArticle}`}>
                  {articleGroup.state === "pending" && (articleIndex === 0 || section.articles[articleIndex - 1]?.state !== "pending") && <div className="flex items-center gap-2 border-t border-amber-500/25 bg-amber-500/10 px-5 py-3 text-sm font-semibold text-amber-500"><Loader2 size={18} className="animate-spin" />Проверяются WB — работа сотрудника пока не требуется</div>}
                  {articleGroup.state === "complete" && (articleIndex === 0 || section.articles[articleIndex - 1]?.state !== "complete") && <div className="flex items-center gap-2 border-t border-emerald-500/25 bg-emerald-500/10 px-5 py-3 text-sm font-semibold text-emerald-500"><CheckCircle2 size={18} />Готовые</div>}
                  {(section.category === "underwear" || articleGroup.groups.length > 1) && <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] bg-[var(--bg)]/65 px-5 py-3">
                    <div><span className="text-sm text-[var(--text-muted)]">Артикул WB</span> <strong>{articleGroup.wbArticle}</strong></div>
                    <div className="text-sm text-[var(--text-muted)]">{articleGroup.sizeCount} {sizeWord(articleGroup.sizeCount)} · {articleGroup.orderCount} {labelWord(articleGroup.orderCount)}</div>
                  </div>}
                  {articleGroup.groups.map((group) => {
              const labelsComplete = group.orders.every((order) => Boolean(order.picked_at && order.sticker_printed_at));
              const printedCount = group.orders.filter((order) => order.picked_at && order.sticker_printed_at).length;
              const groupSgtinOrders = group.orders.filter((order) => effectiveRequiredMeta(order, data.markingPolicy).includes("sgtin"));
              const groupSgtinAccepted = groupSgtinOrders.filter(sgtinReady).length;
              const groupSgtinRemaining = groupSgtinOrders.length - groupSgtinAccepted;
              const groupSgtinSubmitted = groupSgtinOrders.filter((order) => {
                const localState = assemblyMarkingStatus[order.order_id]?.state || "";
                return sgtinReady(order)
                  || (!metaRejected(order) && metaPending(order))
                  || ["sending", "pending", "filled"].includes(localState);
              }).length;
              const groupSgtinScanRemaining = Math.max(0, groupSgtinOrders.length - groupSgtinSubmitted);
              const complete = labelsComplete && groupSgtinRemaining === 0;
              const checking = articleGroup.state === "pending";
              const job = data.printJobs.find((row) => row.supply_id === activeSupplyId && row.group_key === group.key && ["queued", "printing", "paused"].includes(row.status));
              const jobAgent = job?.agent_id ? data.printAgents.find((agent) => agent.agent_id === job.agent_id) : null;
              const needsRecovery = job?.status === "paused" || (job?.status === "printing" && (!jobAgent || jobAgent.status === "offline"));
              const sizeName = visibleSize(group.order.size_name || "");
              return <div key={group.key} className={`grid grid-cols-[88px_minmax(260px,1fr)_1px_160px_210px_250px] items-center gap-4 border-t border-[var(--border)] p-4 text-center ${needsRecovery ? "bg-amber-500/5" : ""}`}>
                <div className="flex justify-center"><ProductPhoto order={group.order} enlargeable large /></div>
                <div className="min-w-0 text-left"><div className="font-semibold leading-snug">{group.order.product_name || group.order.vendor_code}</div><div className="mt-2 text-xs text-[var(--text-muted)]">Артикул: <span className="font-semibold text-[var(--text)]">{group.order.vendor_code || "—"}</span>{sizeName && <span> · Размер: <strong className="text-[var(--text)]">{sizeName}</strong></span>}</div><div className="mt-2 text-xs text-[var(--text-muted)]">Напечатано {printedCount}/{group.orders.length}{groupSgtinOrders.length > 0 && <span> · Честный знак <strong className={groupSgtinRemaining ? "text-amber-500" : "text-emerald-500"}>{groupSgtinAccepted}/{groupSgtinOrders.length}</strong></span>}</div></div>
                <div className="h-full w-px bg-[var(--border)]" />
                <button type="button" onClick={() => setTaskGroupKey(group.key)} className="w-full rounded-lg p-2 text-center transition hover:bg-[var(--accent)]/10" aria-label={`Открыть ${group.orders.length} этикеток WB`}><div className="text-lg font-semibold">{group.orders.length}</div><div className="text-xs font-medium text-[var(--accent)]">Открыть список →</div></button>
                <div className="text-center font-mono text-sm">{group.sku || "не получен"}</div>
                <div className="flex w-[250px] items-center justify-end">{complete ? <div className="flex min-h-[58px] w-full items-center justify-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 font-medium text-emerald-500"><CheckCircle2 size={18} />Готово</div> : checking ? <div className="flex min-h-[58px] w-full items-center justify-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 font-medium text-amber-500"><Loader2 size={18} className="animate-spin" />Проверяется WB</div> : needsRecovery && job ? <button type="button" onClick={() => void continuePrint(job)} disabled={!printAgentReady} className="w-full rounded-lg bg-amber-500 px-4 py-2.5 font-medium text-white disabled:cursor-not-allowed disabled:opacity-35">Продолжить печать</button> : labelsComplete && groupSgtinScanRemaining > 0 ? <button type="button" onClick={() => openAssemblyMarkingBatch(group)} className="flex w-full flex-col items-center justify-center rounded-xl bg-amber-500 px-4 py-2.5 text-[21px] font-semibold leading-tight text-white transition hover:brightness-110"><span>{groupSgtinScanRemaining === 1 ? "Остался" : "Осталось"}</span><span>{groupSgtinScanRemaining} {groupSgtinScanRemaining === 1 ? "товар" : groupSgtinScanRemaining >= 2 && groupSgtinScanRemaining <= 4 ? "товара" : "товаров"}</span></button> : <button type="button" onClick={() => void printBatch(group)} disabled={!printAgentReady || !group.sku || Boolean(job) || Boolean(busy)} className="group flex min-h-[88px] w-full flex-col justify-center gap-1 rounded-xl bg-[var(--accent)] px-5 py-2.5 text-white transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[var(--accent)]/25 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-35"><span className="flex items-center justify-center gap-2 text-base font-medium">{job ? <Loader2 size={22} className="shrink-0 animate-spin" /> : <Printer size={22} className="shrink-0 transition-transform group-hover:scale-110" />}<span>{job ? "Печатается" : "Печать"}</span></span><span className="text-4xl font-black leading-none tabular-nums">{job ? Math.max(0, job.total_count - job.printed_count) : group.orders.length - printedCount}</span></button>}</div>
              </div>;
                  })}
                </div>)}
              </div>;
            })}
          </div></div>
          <div className="flex items-center justify-between gap-3 rounded-lg bg-[var(--bg)] p-3"><span className="text-sm">Собрано <strong>{picked} из {supplyOrders.length}</strong>{assemblySgtinOrders.length > 0 && <span> · «Честный знак» принят <strong>{assemblySgtinAccepted} из {assemblySgtinOrders.length}</strong></span>}</span><button type="button" onClick={() => void finishAssembly()} disabled={!assemblyReady || !allAssemblySgtinReady || Boolean(busy)} className="rounded-lg bg-[var(--accent)] px-4 py-2 font-medium text-white disabled:opacity-35">{!allAssemblySgtinReady ? "Завершите маркировку при сборке" : markingOrders.length ? "Все пачки готовы — к проверке" : "Все пачки готовы — к отгрузке"}</button></div>
        </div>}
      </section>}

      {assemblyMarkingModalOpen && assemblyMarkingGroup && typeof document !== "undefined" && createPortal(<div className="fixed inset-0 z-[200] bg-black/70 p-3 sm:p-6" role="presentation"><section className="relative mx-auto h-full w-full max-w-[1280px] overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] shadow-2xl" role="dialog" aria-modal="true" aria-label={`Маркировка ${assemblyMarkingGroupOrders.length} товаров`}>
        {assemblyMarkingError && <div className="absolute left-1/2 top-5 z-30 flex w-full max-w-[620px] -translate-x-1/2 items-start gap-3 rounded-xl border border-red-500/50 bg-[var(--bg-card)] p-4 text-red-500 shadow-2xl"><AlertTriangle className="mt-0.5 shrink-0" size={23} /><div className="min-w-0"><div className="font-bold">Ошибка сканирования</div><div className="mt-1 text-sm">{assemblyMarkingError}</div></div><button type="button" onClick={() => setAssemblyMarkingError("")} className="ml-2 shrink-0 rounded p-1 transition hover:bg-red-500/10" aria-label="Закрыть ошибку"><X size={19} /></button></div>}
        <div className="absolute left-5 top-5 z-20 flex items-center gap-2 text-[var(--accent)]"><QrCode size={24} /><span className="text-xl font-semibold">Маркировка</span></div>
        {assemblyMarkingGroupRemaining > 0 && <button type="button" onClick={() => setAssemblyMarkingModalOpen(false)} className="absolute right-5 top-5 z-40 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-4 py-3 text-sm font-medium transition hover:bg-[var(--bg-card-hover)]">Свернуть</button>}

        <div className="flex h-full min-h-0 overflow-y-auto p-5"><div className="my-auto w-full py-14">
          <div className="flex justify-center text-center"><div className={`rounded-xl px-4 py-2 text-xl font-black ${assemblyMarkingGroupRemaining === 0 ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-500"}`}>{assemblyMarkingGroupRemaining === 0 ? `Готово ${assemblyMarkingGroupOrders.length}/${assemblyMarkingGroupOrders.length}` : remainingProductText(assemblyMarkingGroupRemaining)}</div></div>
          <div className="mt-4 flex w-full items-center gap-4"><div className="h-3 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--bg)]"><div className={`h-full rounded-full transition-all duration-200 ${assemblyMarkingGroupRemaining === 0 ? "bg-emerald-500" : "bg-amber-500"}`} style={{ width: `${assemblyMarkingGroupOrders.length ? (assemblyMarkingGroupSubmitted / assemblyMarkingGroupOrders.length) * 100 : 0}%` }} /></div><div className="shrink-0 font-semibold tabular-nums text-amber-500">{assemblyMarkingGroupSubmitted} из {assemblyMarkingGroupOrders.length}</div></div>

          <div className={`mt-4 flex h-[300px] w-full flex-col overflow-hidden rounded-xl border p-4 ${assemblyMarkingOrder ? "border-[var(--accent)]/50 bg-[var(--accent)]/5" : "border-[var(--border)] bg-[var(--bg)]"}`}>
            <div className="relative flex h-[174px] shrink-0 items-start gap-4 overflow-hidden rounded-xl bg-[var(--bg-card)] p-4">
              {assemblyMarkingDisplayOrder && <><ProductPhoto order={assemblyMarkingDisplayOrder} large /><div className="min-w-0 pr-[250px] pt-1"><div className="text-lg font-semibold leading-snug">{assemblyMarkingDisplayOrder.product_name || assemblyMarkingDisplayOrder.vendor_code}</div><div className="mt-1 text-sm text-[var(--text-muted)]">Артикул {assemblyMarkingDisplayOrder.vendor_code || "—"}{visibleSize(assemblyMarkingDisplayOrder.size_name || "") && <span> · размер {visibleSize(assemblyMarkingDisplayOrder.size_name || "")}</span>}</div><div className="mt-2 h-8">{assemblyMarkingOrder ? (fbsStickerNumber(assemblyMarkingOrder) ? <HighlightedLabelNumber value={fbsStickerNumber(assemblyMarkingOrder)} /> : <span className="text-sm text-[var(--text-muted)]">Номер этикетки не получен</span>) : <span className="text-sm font-medium text-[var(--accent)]">Товар текущей пачки</span>}</div></div>{assemblyMarkingOrder && <div className="absolute right-4 top-4 inline-flex rounded-full bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-500">Этикетка WB найдена</div>}</>}
            </div>
            <form ref={assemblyMarkingFormRef} onSubmit={submitAssemblyMarkingScan} className="mt-3 flex gap-2">
              <input ref={assemblyMarkingRef} value={assemblyMarkingValue} onChange={(event) => setAssemblyMarkingValue(event.target.value)} disabled={assemblyMarkingBusy || assemblyMarkingGroupRemaining === 0} className="min-w-0 flex-1 rounded-lg border-2 border-[var(--accent)]/45 bg-[var(--bg-card)] px-4 py-3 font-mono text-lg outline-none focus:border-[var(--accent)] disabled:opacity-50" placeholder={assemblyMarkingOrder ? "Отсканируйте «Честный знак»" : "Отсканируйте этикетку WB"} autoComplete="off" />
              <button type="submit" disabled={!assemblyMarkingValue || assemblyMarkingBusy || assemblyMarkingGroupRemaining === 0} className="flex min-w-[150px] items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 font-medium text-white disabled:opacity-40">{assemblyMarkingBusy ? <Loader2 className="animate-spin" size={20} /> : <ScanLine size={20} />}Сканировать</button>
              <button type="button" onClick={cancelAssemblyMarkingPair} aria-hidden={!assemblyMarkingOrder} tabIndex={assemblyMarkingOrder ? 0 : -1} className={`shrink-0 rounded-lg border border-[var(--border)] px-4 text-sm font-medium ${assemblyMarkingOrder ? "visible" : "pointer-events-none invisible"}`}>Отменить пару</button>
            </form>
          </div>
        </div></div>
      </section></div>, document.body)}

      {assemblyStatusPanel && typeof document !== "undefined" && createPortal(<div className="fixed inset-0 z-[125] bg-black/55" onClick={() => setAssemblyStatusPanel(null)} role="presentation"><aside className="absolute inset-y-0 right-0 flex w-full max-w-[560px] flex-col border-l border-[var(--border)] bg-[var(--bg-card)] shadow-2xl" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={assemblyStatusPanelTitle}>
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border)] p-5"><div><div className={`text-sm font-semibold ${assemblyStatusPanel === "accepted" ? "text-emerald-500" : assemblyStatusPanel === "pending" ? "text-amber-500" : "text-red-500"}`}>Маркировка при сборке</div><div className="mt-1 flex items-baseline gap-3"><h3 className="text-2xl font-bold">{assemblyStatusPanelTitle}</h3><span className="text-2xl font-bold tabular-nums text-[var(--text-muted)]">{assemblyStatusPanelOrders.length}</span></div></div><button type="button" onClick={() => setAssemblyStatusPanel(null)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--border)] transition hover:bg-[var(--bg-card-hover)]" aria-label="Закрыть"><X size={21} /></button></div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{assemblyStatusPanelOrders.length === 0 ? <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center text-[var(--text-muted)]">В этой группе пока нет этикеток.</div> : <div className="space-y-3">{assemblyStatusPanelOrders.map((order) => {
          const status = assemblyMarkingStatus[order.order_id];
          const labelNumber = fbsStickerNumber(order);
          const sizeName = visibleSize(order.size_name || "");
          return <div key={order.order_id} className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4"><div className="flex items-start gap-3"><ProductPhoto order={order} enlargeable /><div className="min-w-0 flex-1"><div className="font-semibold leading-snug">{order.product_name || order.vendor_code}</div><div className="mt-1 text-sm text-[var(--text-muted)]">Артикул: <span className="font-medium text-[var(--text)]">{order.vendor_code || "—"}</span>{sizeName && <span> · Размер: <strong className="text-[var(--text)]">{sizeName}</strong></span>}</div><div className="mt-3 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Номер этикетки</div><div className="mt-0.5">{labelNumber ? <HighlightedLabelNumber value={labelNumber} /> : <span className="text-sm text-[var(--text-muted)]">Номер появится после печати</span>}</div></div></div>
            {assemblyStatusPanel === "accepted" && <div className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2 text-sm font-medium text-emerald-500">Принято WB</div>}
            {assemblyStatusPanel === "pending" && <div className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-sm font-medium text-amber-500">Проверяется WB</div>}
            {assemblyStatusPanel === "errors" && <><div className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500"><div className="font-semibold">{metaDeadlineExceeded(order) ? "Не проверено WB" : "WB не принял код"}</div><div className="mt-1">{assemblySgtinErrorMessage(order, status)}</div>{status?.updatedAt && <div className="mt-2 text-xs opacity-80">{formatDate(status.updatedAt)}</div>}</div>{!metaDeadlineExceeded(order) && <button type="button" onClick={() => { const group = batchGroups.find((candidate) => candidate.orders.some((candidateOrder) => candidateOrder.order_id === order.order_id)); if (!group) return; setAssemblyStatusPanel(null); setAssemblyMarkingGroupKey(group.key); setAssemblyMarkingOrderId(order.order_id); setAssemblyMarkingValue(""); setAssemblyMarkingError(""); setAssemblyMarkingMessage(`${fbsLabelText(order)}: отсканируйте «Честный знак» повторно`); setAssemblyMarkingModalOpen(true); }} className="mt-3 w-full rounded-lg bg-[var(--accent)] px-4 py-3 font-medium text-white transition hover:brightness-110">Перейти к пересканированию</button>}</>}
          </div>;
        })}</div>}</div>
      </aside></div>, document.body)}

      {taskGroup && typeof document !== "undefined" && createPortal(<div className="fixed inset-0 z-[110] bg-black/55" onClick={() => { setTaskGroupKey(""); setSinglePrintOrderId(null); setBatchReprintConfirmOpen(false); }} role="presentation"><aside className="absolute inset-y-0 right-0 flex w-full max-w-[540px] flex-col border-l border-[var(--border)] bg-[var(--bg-card)] shadow-2xl" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={`Этикетки: ${taskGroup.orders.length}`}>
        <div className="border-b border-[var(--border)] p-5"><div className="mb-4 flex items-start justify-between gap-4"><div><div className="text-sm font-medium text-[var(--accent)]">Этикетки</div><div className="mt-1 text-3xl font-bold">{taskGroup.orders.length}</div></div><button type="button" onClick={() => { setTaskGroupKey(""); setSinglePrintOrderId(null); }} className="flex h-10 w-10 items-center justify-center rounded-full border border-[var(--border)] transition hover:bg-[var(--bg-card-hover)]" aria-label="Закрыть список этикеток"><X size={21} /></button></div><div className="flex items-center gap-4"><ProductPhoto order={taskGroup.order} enlargeable large /><div className="min-w-0"><div className="font-semibold leading-snug">{taskGroup.order.product_name || taskGroup.order.vendor_code}</div><div className="mt-2 text-sm text-[var(--text-muted)]">Артикул: <span className="font-semibold text-[var(--text)]">{taskGroup.order.vendor_code || "—"}</span>{visibleSize(taskGroup.order.size_name || "") && <span> · Размер: <strong className="text-[var(--text)]">{visibleSize(taskGroup.order.size_name || "")}</strong></span>}</div><div className="mt-2 text-sm text-[var(--text-muted)]">Номера, напечатанные на физических этикетках</div></div></div></div>
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3 text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]"><span>Номер этикетки</span><span>{taskGroup.orders.length} шт.</span></div>
        <div className={`border-b border-[var(--border)] px-5 py-3 text-sm ${taskGroupPrintComplete ? "bg-emerald-500/10 text-emerald-600" : "bg-amber-500/10 text-amber-600"}`}>{taskGroupPrintComplete ? "Общая печать завершена. Можно повторно напечатать отдельную испорченную этикетку." : "Сначала напечатайте всю пачку основной кнопкой. Отдельная повторная печать откроется после её завершения."}</div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4"><div className="space-y-2">{taskGroup.orders.slice().sort((a, b) => a.order_id - b.order_id).map((order, index) => {
          const singleJob = data.printJobs
            .filter((job) => job.group_key.startsWith(`single:${order.order_id}:`))
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
          const singleState = !singleJob
            ? "idle"
            : singleJob.status === "queued"
              ? "queued"
              : singleJob.status === "printing"
                ? "printing"
                : singleJob.status === "completed"
                  ? "completed"
                  : "error";
          const singleLabel = singleState === "queued" ? "Очередь" : singleState === "printing" ? "Печать…" : singleState === "completed" ? "Готово" : singleState === "error" ? "Ошибка" : "Печать";
          const singleTone = singleState === "completed"
            ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
            : singleState === "error"
              ? "border-red-500/40 bg-red-500/10 text-red-500 hover:bg-red-500/20"
              : singleState === "queued" || singleState === "printing"
                ? "border-amber-500/40 bg-amber-500/10 text-amber-500"
                : "border-[var(--border)] hover:border-[var(--accent)] hover:bg-[var(--accent)]/10 hover:text-[var(--accent)]";
          const rowTone = singleState === "completed" ? "border-l-4 border-l-emerald-500" : singleState === "error" ? "border-l-4 border-l-red-500" : singleState === "queued" || singleState === "printing" ? "border-l-4 border-l-amber-500" : "border-l-4 border-l-transparent";
          const labelNumber = fbsStickerNumber(order);
          return <div key={order.order_id} className={`flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--bg)] px-4 py-3 ${rowTone}`}><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent)]/10 text-sm font-semibold text-[var(--accent)]">{index + 1}</span><span className="min-w-0 flex-1">{labelNumber ? <HighlightedLabelNumber value={labelNumber} /> : <span className="text-sm text-[var(--text-muted)]">Номер появится после печати</span>}</span><button type="button" onClick={() => singleState === "error" && singleJob ? void continuePrint(singleJob) : setSinglePrintOrderId(order.order_id)} disabled={!printAgentReady || !taskGroupPrintComplete || singleState === "queued" || singleState === "printing" || Boolean(busy)} title={!printAgentReady ? "Сначала восстановите принтер" : !taskGroupPrintComplete ? "Доступно после общей печати всей пачки" : undefined} className={`flex w-[112px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${singleTone}`} aria-label={`${singleLabel}: этикетка ${labelNumber || "WB"}`}><Printer size={15} />{singleLabel}</button></div>;
        })}</div></div>
        <div className="border-t border-[var(--border)] p-4"><div className="grid grid-cols-2 gap-3"><button type="button" onClick={() => { setTaskGroupKey(""); setSinglePrintOrderId(null); setBatchReprintConfirmOpen(false); }} className="rounded-lg border border-[var(--border)] px-4 py-3 font-medium transition hover:bg-[var(--bg-card-hover)]">Закрыть</button><button type="button" onClick={() => taskGroupReprintJob?.status === "paused" ? void continuePrint(taskGroupReprintJob) : setBatchReprintConfirmOpen(true)} disabled={!printAgentReady || !taskGroupPrintComplete || Boolean(busy) || Boolean(taskGroupReprintJob && taskGroupReprintJob.status !== "paused")} className="flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-3 font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"><Printer size={18} />{taskGroupReprintJob?.status === "paused" ? "Продолжить повтор" : taskGroupReprintJob ? `${taskGroupReprintJob.printed_count}/${taskGroupReprintJob.total_count}` : `Повторить все — ${taskGroup.orders.length}`}</button></div></div>
      </aside></div>, document.body)}

      {taskGroup && batchReprintConfirmOpen && taskGroupPrintComplete && typeof document !== "undefined" && createPortal(<div className="fixed inset-0 z-[135] flex items-center justify-center bg-black/65 p-4" onClick={() => setBatchReprintConfirmOpen(false)} role="presentation"><div className="w-full max-w-[460px] rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-2xl" onClick={(event) => event.stopPropagation()} role="alertdialog" aria-modal="true" aria-label="Подтверждение повторной печати всей пачки"><div className="flex items-start justify-between gap-3"><div><div className="text-lg font-semibold">Повторно напечатать все {taskGroup.orders.length} этикеток?</div><div className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">На Zebra будет отправлена вся эта пачка. Статусы «Готово», сборки и маркировки не изменятся.</div></div><button type="button" onClick={() => setBatchReprintConfirmOpen(false)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border)]" aria-label="Закрыть подтверждение"><X size={19} /></button></div><div className="mt-5 grid grid-cols-2 gap-3"><button type="button" onClick={() => setBatchReprintConfirmOpen(false)} className="rounded-lg border border-[var(--border)] px-4 py-3 font-medium">Отмена</button><button type="button" onClick={() => void reprintTaskGroup(taskGroup)} disabled={Boolean(busy)} className="flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-3 font-medium text-white disabled:opacity-45"><Printer size={18} />{busy === "batch_reprint" ? "Отправляем…" : `Печатать все — ${taskGroup.orders.length}`}</button></div></div></div>, document.body)}

      {singlePrintOrder && taskGroupPrintComplete && typeof document !== "undefined" && createPortal(<div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/65 p-4" onClick={() => setSinglePrintOrderId(null)} role="presentation"><div className="w-full max-w-[440px] rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-5 shadow-2xl" onClick={(event) => event.stopPropagation()} role="alertdialog" aria-modal="true" aria-label="Подтверждение повторной печати этикетки"><div className="mb-4 flex items-start justify-between gap-3"><div><div className="text-lg font-semibold">Повторно напечатать этикетку?</div><div className="mt-1 text-sm text-[var(--text-muted)]">Будет отправлена одна копия на Zebra. Остальные этикетки не печатаются.</div></div><button type="button" onClick={() => setSinglePrintOrderId(null)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--border)]" aria-label="Закрыть подтверждение"><X size={19} /></button></div><div className="mb-5 rounded-xl bg-[var(--bg)] p-4"><div className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">Номер этикетки</div><div className="mt-1">{fbsStickerNumber(singlePrintOrder) ? <HighlightedLabelNumber value={fbsStickerNumber(singlePrintOrder)} large /> : <span className="text-sm text-[var(--text-muted)]">Номер появится после печати</span>}</div><div className="mt-2 text-sm text-[var(--text-muted)]">{singlePrintOrder.product_name || singlePrintOrder.vendor_code} · артикул {singlePrintOrder.vendor_code || "—"}</div></div><div className="grid grid-cols-2 gap-3"><button type="button" onClick={() => setSinglePrintOrderId(null)} className="rounded-lg border border-[var(--border)] px-4 py-3 font-medium">Отмена</button><button type="button" onClick={() => void printSingleLabel(singlePrintOrder)} disabled={Boolean(busy)} className="flex items-center justify-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-3 font-medium text-white disabled:opacity-45"><Printer size={18} />{busy === `single_print_${singlePrintOrder.order_id}` ? "Отправляем…" : "Повторить одну"}</button></div></div></div>, document.body)}

      {activeStep === "marking" && activeSupply && <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
        <div className="mb-4"><h2 className="text-lg font-semibold">3. Контроль маркировки</h2><p className="text-sm text-[var(--text-muted)]">DataMatrix, отсканированные при сборке, уже находятся здесь. Проверьте, что WB принял все коды; повторное сканирование требуется только для ошибок.</p></div>
        {markingOrders.length === 0 ? <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-6 text-center"><CheckCircle2 className="mx-auto mb-2 text-emerald-500" /><div className="font-semibold text-emerald-500">Маркировка не требуется</div><p className="mt-1 text-sm text-[var(--text-muted)]">У всех этикеток этой поставки отсутствуют требования к дополнительным кодам WB.</p></div> : <div className="grid gap-4 lg:grid-cols-[minmax(320px,0.8fr)_minmax(420px,1.2fr)]">
          <div className="max-h-[560px] overflow-auto rounded-lg border border-[var(--border)]">{markingOrders.map((order) => <button type="button" key={order.order_id} onClick={() => { setSelectedOrderId(order.order_id); setMetaType((effectiveRequiredMeta(order, data.markingPolicy)[0] || getFbsReviewOptionalMeta(order.optional_meta)[0] || "sgtin") as MetaType); }} className={`flex w-full items-center gap-3 border-b border-[var(--border)] p-3 text-left last:border-0 ${selectedOrderId === order.order_id ? "bg-[var(--accent)]/10" : "hover:bg-[var(--bg-card-hover)]"}`}><ProductPhoto order={order} /><div className="min-w-0 flex-1"><div className="font-medium">{order.product_name || order.vendor_code}</div><div className="flex flex-wrap items-baseline gap-2 text-xs text-[var(--text-muted)]"><span>{order.vendor_code}</span><span>·</span>{fbsStickerNumber(order) ? <HighlightedLabelNumber value={fbsStickerNumber(order)} /> : <span>Номер появится после печати</span>}</div><div className="mt-2 flex flex-wrap gap-1">{metaPending(order) ? statusPill(false, "Проверяется WB") : metaRejected(order) ? <span className="rounded-full bg-red-500/10 px-2 py-1 text-xs text-red-500">✕ {metaDeadlineExceeded(order) ? "Не проверено WB" : "WB отклонил — пересканируйте"}</span> : statusPill(metaReady(order), metaReady(order) ? "DataMatrix принят" : "DataMatrix не введён")}</div></div></button>)}</div>
          <div>{selectedOrder && markingOrders.some((order) => order.order_id === selectedOrder.order_id) ? <><div className="rounded-xl border border-[var(--border)] p-4"><div className="mb-3 flex items-center gap-2 font-semibold"><QrCode size={19} />Этикетка {fbsStickerNumber(selectedOrder) ? <HighlightedLabelNumber value={fbsStickerNumber(selectedOrder)} /> : <span className="text-sm text-[var(--text-muted)]">номер появится после печати</span>}</div>{selectedOrderMetaTypes.length > 1 && <div className="mb-3 flex flex-wrap gap-2">{selectedOrderMetaTypes.map((type) => <button type="button" key={type} onClick={() => setMetaType(type as MetaType)} className={`rounded-lg px-3 py-2 text-sm ${metaType === type ? "bg-[var(--accent)] text-white" : "border border-[var(--border)]"}`}>{META_LABELS[type as MetaType] || type}{effectiveRequiredMeta(selectedOrder, data.markingPolicy).includes(type) ? " *" : ""}</button>)}</div>}<form onSubmit={submitMeta} className="flex gap-2"><input value={metaValue} onChange={(e) => setMetaValue(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-3 font-mono" placeholder={metaType === "expiration" ? "ДД.ММ.ГГГГ" : `Сканируйте ${META_LABELS[metaType] || metaType}`} autoComplete="off" /><button disabled={!metaValue || Boolean(busy)} className="rounded-lg bg-[var(--accent)] px-4 py-2 font-medium text-white">{busy === "meta" && metaType === "sgtin" ? "Проверяем WB…" : "Отправить WB"}</button></form>{metaType === "sgtin" && <p className="mt-2 text-xs text-[var(--text-muted)]">Принимается только DataMatrix «Честного знака» для этого товара. Успех появится после проверки WB; полный КИЗ в журнале не сохраняется.</p>}{getFbsReviewOptionalMeta(selectedOrder.optional_meta).length > 0 && <button type="button" onClick={() => void action("review_meta", { action: "review_optional_meta", orderId: selectedOrder.order_id }).then(() => setNotice("Проверка необязательной маркировки подтверждена."))} className="mt-3 rounded-lg border border-[var(--border)] px-3 py-2 text-sm">{selectedOrder.optional_meta_reviewed_at ? "✓ Необязательная маркировка проверена" : "Подтвердить проверку необязательной маркировки"}</button>}</div><div className="mt-2 flex flex-wrap justify-end gap-2">{metaType !== "expiration" && selectedOrderMetaTypes.includes(metaType) && <button type="button" onClick={() => { if (window.confirm(`Удалить ${META_LABELS[metaType] || metaType} на WB? ${fbsLabelText(selectedOrder)} будет изменена.`)) void action("remove_meta", { action: "remove_meta", orderId: selectedOrder.order_id, metaType, confirmation: "УДАЛИТЬ" }); }} className="rounded-lg border border-amber-500/40 px-3 py-2 text-sm text-amber-500">Удалить ошибочный код</button>}</div></> : <div className="rounded-lg border border-dashed border-[var(--border)] p-8 text-center text-[var(--text-muted)]">Выберите этикетку слева.</div>}</div>
        </div>}
        <div className="mt-4 flex justify-end"><button type="button" onClick={() => void moveToShipping("Маркировка завершена. Выполните контрольную проверку перед отгрузкой.")} disabled={!allMarked || Boolean(busy)} className="rounded-lg bg-[var(--accent)] px-5 py-3 font-medium text-white disabled:opacity-35">Маркировка завершена — к отгрузке</button></div>
      </section>}

      {activeStep === "shipping" && activeSupply && <><section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
        <h2 className="mb-1 text-lg font-semibold">4. Контроль и отгрузка</h2>
        <p className="mb-4 text-sm text-[var(--text-muted)]">MpHub повторно сверит статусы, сборку, этикетки и обязательную маркировку. Передача в доставку необратима.</p>
        {activeSupply.delivery_mode === "pvz" && <div className="mb-4 rounded-xl border border-[var(--border)] p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div><div className="font-medium">Грузоместа для ПВЗ</div><div className="text-sm text-[var(--text-muted)]">Создано {activeSupply.boxes_count} · подтверждённо напечатано {activeSupply.box_stickers_printed_count || 0}</div></div>{activeSupply.boxes_count > 0 && <button type="button" onClick={() => void deletePickupPointBoxes()} disabled={Boolean(busy) || Boolean(activeBoxQrJob)} className="rounded-lg border border-red-500/40 px-3 py-2 text-sm text-red-500 disabled:opacity-35">Удалить и создать заново</button>}</div>
          <div className="flex flex-wrap gap-2"><button type="button" onClick={() => void createPickupPointBoxes()} disabled={Boolean(busy) || activeSupply.done || Boolean(activeBoxQrJob)} className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-4 py-2 disabled:opacity-40"><Box size={18} />Добавить грузоместа</button><button type="button" onClick={() => activeBoxQrJob?.status === "paused" ? void continuePickupPointBoxes(activeBoxQrJob) : void printPickupPointBoxes()} disabled={!activeSupply.boxes_count || !printAgentReady || Boolean(busy) || Boolean(activeBoxQrJob && activeBoxQrJob.status !== "paused") || (!activeBoxQrJob && activeSupply.box_stickers_printed_count >= activeSupply.boxes_count)} className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 font-medium text-white disabled:opacity-40"><Printer size={18} />{activeBoxQrJob?.status === "paused" ? "Продолжить QR" : activeBoxQrJob ? `Печатается ${activeBoxQrJob.printed_count}/${activeBoxQrJob.total_count}` : activeSupply.box_stickers_printed_count >= activeSupply.boxes_count ? "Все QR напечатаны" : "Печать всех QR"}</button></div>
          {activeSupply.box_ids?.length > 0 && <div className="mt-3 space-y-2">{activeSupply.box_ids.map((boxId, index) => { const printed = activeSupply.box_stickers_printed_ids?.includes(boxId); return <div key={boxId} className="flex items-center justify-between gap-3 rounded-lg bg-[var(--bg)] px-3 py-2"><div className="min-w-0"><div className="text-xs text-[var(--text-muted)]">Грузоместо {index + 1}</div><div className="truncate font-mono text-sm">{boxId}</div></div><div className="flex shrink-0 items-center gap-2"><span className={`text-sm ${printed ? "text-emerald-500" : "text-amber-500"}`}>{printed ? "Напечатано" : "Не печаталось"}</span>{printed && <button type="button" onClick={() => void printPickupPointBoxes(boxId)} disabled={!printAgentReady || Boolean(busy) || Boolean(activeBoxQrJob)} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-35"><Printer size={16} /></button>}</div></div>; })}</div>}
          <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-[var(--border)] p-3"><input type="checkbox" checked={Boolean(activeSupply.pvz_rules_confirmed_at)} onChange={(event) => { if (event.target.checked) void confirmPickupPointRules(); }} disabled={!activeSupply.boxes_count || Boolean(activeSupply.pvz_rules_confirmed_at) || Boolean(busy)} className="mt-1" /><span className="text-sm">Короба закрыты, каждый не тяжелее 5 кг и соответствует габаритам WB; товаров больше одного на короб. ПВЗ выбран на карте WB и находится в зоне нашего склада.</span></label>
        </div>}
        <div className="flex flex-wrap gap-2">
          <button onClick={() => void runPreflight()} disabled={!allPacked || Boolean(busy)} className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-4 py-2 disabled:opacity-35"><ShieldCheck size={18} />Проверить готовность</button>
          <button onClick={() => void deliver()} disabled={!preflight?.ready || Boolean(busy) || activeSupply.done} className="flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 font-medium text-white disabled:opacity-35"><Truck size={18} />Передать в доставку</button>
          {activeSupply.done && <button
            type="button"
            onClick={() => activeSupplyQrJob?.status === "paused" ? void continueSupplyQrPrint(activeSupplyQrJob) : void printSupplyQrViaAgent()}
            disabled={!printAgentReady || Boolean(busy) || Boolean(activeSupplyQrJob && activeSupplyQrJob.status !== "paused")}
            title={!printAgentReady ? "Сначала восстановите принтер" : undefined}
            className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-45"
          ><Printer size={18} />{activeSupplyQrJob?.status === "paused" ? "Продолжить печать QR" : activeSupplyQrJob ? "QR печатается…" : "Печать QR поставки"}</button>}
        </div>
        {preflight && <div className={`mt-4 rounded-lg p-4 ${preflight.ready ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-500"}`}>{preflight.ready ? <div className="flex items-center gap-2 font-medium"><CheckCircle2 size={19} />Все этикетки готовы к передаче</div> : <><div className="mb-2 font-medium">Исправьте перед передачей:</div><ul className="list-disc space-y-1 pl-5 text-sm">{preflight.errors.slice(0, 20).map((row) => <li key={row}>{row}</li>)}</ul></>}</div>}
      </section>

      {activeSupply.done && !activeSupply.qr_printed_at && <section className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-500"><div className="font-semibold">Распечатайте основной QR-код поставки</div><div className="mt-1 text-sm">QR грузомест остаются на коробах. Основной QR предъявляется при приёмке всей поставки.</div></section>}
      {activeSupply.done && activeSupply.qr_printed_at && <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4"><div><div className="font-semibold text-emerald-500">Поставка завершена</div><div className="text-sm text-[var(--text-muted)]">{activeSupply.delivery_mode === "pvz" ? "QR грузомест и основной QR поставки напечатаны. Поставка готова к сдаче в ПВЗ." : "QR поставки подготовлен. Можно переходить к следующему циклу."}</div></div><button type="button" onClick={startNewCycle} className="rounded-lg bg-[var(--accent)] px-5 py-3 font-medium text-white">Завершить цикл и перейти к новым заказам</button></section>}
      </>}
    </main>
  );
}
