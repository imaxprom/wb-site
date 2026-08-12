"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CirclePause,
  CircleX,
  Loader2,
  PackageSearch,
  Play,
  RefreshCw,
  Warehouse,
  type LucideIcon,
} from "lucide-react";
import { getWbImageUrlCandidates } from "@/lib/wb-image";

interface ProductRow {
  id: number;
  nm_id: number;
  chrt_id: number;
  vendor_code: string;
  title: string;
  photo_url: string;
  size_name: string;
  physical_quantity: number;
  enabled: boolean;
  published_quantity: number;
  warehouse_count: number;
  mismatch_count: number;
  last_sync_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
}

interface WarehouseRow {
  product_id: number;
  warehouse_id: number;
  warehouse_name: string;
  enabled: boolean;
  target_quantity: number;
  confirmed_quantity: number | null;
  orders_30d: number;
  last_error: string | null;
}

interface Snapshot {
  products: ProductRow[];
  warehouses: WarehouseRow[];
  audit: Array<{
    id: number;
    product_id: number | null;
    order_id: number | null;
    action: string;
    status: string;
    message: string;
    created_at: string;
  }>;
}

interface Discovery {
  card: {
    nmId: number;
    vendorCode: string;
    title: string;
    brand: string;
    photoUrl: string;
    variants: Array<{ chrtId: number; sizeName: string; skus: string[] }>;
  };
  warehouses: Array<{
    id: number;
    name: string;
    amount: number | null;
    error?: string;
  }>;
}

const EMPTY_SNAPSHOT: Snapshot = { products: [], warehouses: [], audit: [] };

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    configuration_created: "Управление запущено",
    configuration_updated: "Настройки изменены",
    order_counted: "Заказ списан",
    order_released: "Резерв освобождён",
    baseline: "Базовый заказ",
    external_warehouse: "Внешний склад",
    rebalance: "Перераспределение",
    stock_decrease: "Остаток уменьшен",
    stock_increase: "Остаток увеличен",
    sync: "Синхронизация",
    paused: "Управление остановлено",
    stock_zero_started: "Обнуление запущено",
    stock_zeroed: "Остатки обнулены",
  };
  return labels[action] || action;
}

function ProductImage({ nmId, photoUrl = "" }: { nmId: number; photoUrl?: string }) {
  const candidates = useMemo(() => Array.from(new Set([
    photoUrl,
    ...getWbImageUrlCandidates(nmId, "small"),
  ].filter(Boolean))), [nmId, photoUrl]);
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [nmId, photoUrl]);
  if (!candidates[index]) return <div className="h-24 w-20 rounded-lg bg-[var(--bg)]" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={candidates[index]}
      alt=""
      className="h-24 w-20 rounded-lg bg-white object-contain"
      onError={() => setIndex((current) => current + 1)}
    />
  );
}

export default function FbsStockPage() {
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [nmId, setNmId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [chrtId, setChrtId] = useState<number | null>(null);
  const [selectedWarehouses, setSelectedWarehouses] = useState<Set<number>>(new Set());
  const [expandedProducts, setExpandedProducts] = useState<Set<number>>(new Set());
  const editorRef = useRef<HTMLElement | null>(null);
  const quantityInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const readableModeWasEnabled = document.documentElement.classList.contains("fbs-readable-ui");
    document.documentElement.classList.add("fbs-readable-ui");
    return () => {
      if (!readableModeWasEnabled) document.documentElement.classList.remove("fbs-readable-ui");
    };
  }, []);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await fetch("/api/fbs-stock", { cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setSnapshot(payload as Snapshot);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить FBS-остатки");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const refresh = () => {
      if (!document.hidden) void load(true);
    };
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  async function post(body: Record<string, unknown>) {
    const response = await fetch("/api/fbs-stock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload;
  }

  async function discover(article = nmId, editProduct?: ProductRow) {
    setBusy("discover");
    setError("");
    setNotice("");
    try {
      const payload = await post({ action: "discover", nmId: Number(article) }) as Discovery & { ok: true };
      setDiscovery(payload);
      const selectedVariant = editProduct?.chrt_id || (payload.card.variants.length === 1 ? payload.card.variants[0].chrtId : null);
      setChrtId(selectedVariant);
      if (editProduct) {
        setNmId(String(editProduct.nm_id));
        setQuantity(String(editProduct.physical_quantity));
        setSelectedWarehouses(new Set(
          snapshot.warehouses
            .filter((warehouse) => warehouse.product_id === editProduct.id && warehouse.enabled)
            .map((warehouse) => Number(warehouse.warehouse_id)),
        ));
        window.requestAnimationFrame(() => {
          editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          window.requestAnimationFrame(() => quantityInputRef.current?.focus({ preventScroll: true }));
        });
      } else {
        setSelectedWarehouses(new Set(payload.warehouses.map((warehouse) => warehouse.id)));
      }
    } catch (discoverError) {
      setError(discoverError instanceof Error ? discoverError.message : "Не удалось найти товар");
    } finally {
      setBusy("");
    }
  }

  async function configure() {
    if (!discovery || !chrtId) return;
    const total = Number(quantity);
    if (quantity.trim() === "" || !Number.isInteger(total) || total < 0) {
      setError("Укажите целый общий остаток от нуля");
      return;
    }
    if (selectedWarehouses.size === 0) {
      setError("Выберите хотя бы один склад");
      return;
    }
    const confirmed = window.confirm(
      `Опубликовать общий остаток ${total} шт. карточки ${discovery.card.nmId} на ${selectedWarehouses.size} складах? Значения на WB будут заменены рассчитанными остатками.`,
    );
    if (!confirmed) return;
    setBusy("configure");
    setError("");
    setNotice("");
    try {
      const payload = await post({
        action: "configure",
        nmId: discovery.card.nmId,
        chrtId,
        physicalQuantity: total,
        warehouseIds: Array.from(selectedWarehouses),
      });
      if (payload.snapshot) setSnapshot(payload.snapshot as Snapshot);
      else await load();
      setDiscovery(null);
      setNmId("");
      setQuantity("");
      setChrtId(null);
      setSelectedWarehouses(new Set());
      setNotice("Управление включено, WB подтвердил распределённые остатки.");
    } catch (configureError) {
      setError(configureError instanceof Error ? configureError.message : "Не удалось включить управление");
      await load(true);
    } finally {
      setBusy("");
    }
  }

  async function sync(product: ProductRow) {
    setBusy(`sync-${product.id}`);
    setError("");
    try {
      const payload = await post({ action: "sync", productId: product.id });
      if (payload.snapshot) setSnapshot(payload.snapshot as Snapshot);
      setNotice("Синхронизация завершена.");
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Ошибка синхронизации");
      await load(true);
    } finally {
      setBusy("");
    }
  }

  async function pause(product: ProductRow) {
    if (!window.confirm("Остановить автоматическое управление? Текущие остатки на WB останутся опубликованными.")) return;
    setBusy(`pause-${product.id}`);
    setError("");
    try {
      const payload = await post({ action: "pause", productId: product.id });
      if (payload.snapshot) setSnapshot(payload.snapshot as Snapshot);
      setNotice("Автоматическое управление остановлено. Остатки на WB не менялись.");
    } catch (pauseError) {
      setError(pauseError instanceof Error ? pauseError.message : "Не удалось остановить управление");
    } finally {
      setBusy("");
    }
  }

  async function zeroStocks(product: ProductRow) {
    const confirmed = window.confirm(
      `Обнулить артикул WB ${product.nm_id} на всех FBS-складах? Автоуправление остановится, общий остаток станет 0.`,
    );
    if (!confirmed) return;
    setBusy(`zero-${product.id}`);
    setError("");
    setNotice("");
    try {
      const payload = await post({
        action: "zero",
        productId: product.id,
        confirmationNmId: product.nm_id,
      });
      if (payload.snapshot) setSnapshot(payload.snapshot as Snapshot);
      const count = Number(payload.result?.warehouseCount || 0);
      setNotice(`WB подтвердил нулевой остаток на ${count} складах. Автоуправление остановлено.`);
    } catch (zeroError) {
      setError(zeroError instanceof Error ? zeroError.message : "Не удалось обнулить остатки");
      await load(true);
    } finally {
      setBusy("");
    }
  }

  const totals = useMemo(() => {
    const activeProductIds = new Set(snapshot.products.filter((product) => product.enabled).map((product) => product.id));
    const uniqueWarehouseIds = new Set(
      snapshot.warehouses
        .filter((warehouse) => warehouse.enabled && activeProductIds.has(warehouse.product_id))
        .map((warehouse) => warehouse.warehouse_id),
    );
    return snapshot.products.reduce((acc, product) => ({
      products: acc.products + (product.enabled ? 1 : 0),
      physical: acc.physical + (product.enabled ? Number(product.physical_quantity) : 0),
      published: acc.published + (product.enabled ? Number(product.published_quantity) : 0),
      warehouses: uniqueWarehouseIds.size,
    }), { products: 0, physical: 0, published: 0, warehouses: uniqueWarehouseIds.size });
  }, [snapshot.products, snapshot.warehouses]);

  return (
    <div className="fbs-portal-content space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">FBS Управление остатками</h1>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            Один физический остаток распределяется между складами и автоматически переносится на склады с продажами.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--bg-card-hover)] disabled:opacity-50"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Обновить
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-300">
          <AlertTriangle className="mt-0.5 shrink-0" size={17} /> {error}
        </div>
      )}
      {notice && (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-4 text-sm text-emerald-300">
          <CheckCircle2 className="mt-0.5 shrink-0" size={17} /> {notice}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {([ 
          ["Активных товаров", totals.products, Boxes],
          ["Физический остаток", totals.physical, PackageSearch],
          ["Опубликовано", totals.published, CheckCircle2],
          ["Активных складов", totals.warehouses, Warehouse],
        ] as Array<[string, number, LucideIcon]>).map(([label, value, Icon]) => (
          <div key={String(label)} className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
            <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]"><Icon size={16} /> {String(label)}</div>
            <div className="mt-2 text-2xl font-bold tabular-nums">{Number(value).toLocaleString("ru-RU")}</div>
          </div>
        ))}
      </div>

      <section ref={editorRef} className="scroll-mt-6 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
        <h2 className="text-lg font-semibold">Добавить или изменить товар</h2>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="min-w-[220px] flex-1 text-sm">
            <span className="mb-1 block text-[var(--text-muted)]">Артикул WB</span>
            <input
              value={nmId}
              onChange={(event) => setNmId(event.target.value.replace(/\D/g, ""))}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 outline-none focus:border-[var(--accent)]"
            />
          </label>
          <label className="w-44 text-sm">
            <span className="mb-1 block text-[var(--text-muted)]">Общий остаток, шт.</span>
            <input
              ref={quantityInputRef}
              type="number"
              min={0}
              max={100000}
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 outline-none focus:border-[var(--accent)]"
            />
          </label>
          <button
            type="button"
            onClick={() => void discover()}
            disabled={busy === "discover" || !nmId}
            className="flex items-center gap-2 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy === "discover" ? <Loader2 size={16} className="animate-spin" /> : <PackageSearch size={16} />}
            Найти товар и склады
          </button>
        </div>

        {discovery && (
          <div className="mt-5 space-y-4 border-t border-[var(--border)] pt-5">
            <div className="flex items-center gap-4">
              <ProductImage nmId={discovery.card.nmId} photoUrl={discovery.card.photoUrl} />
              <div className="min-w-0">
                <div className="font-semibold">{discovery.card.title}</div>
                <div className="mt-1 text-sm text-[var(--text-muted)]">
                  {discovery.card.vendorCode || "Без артикула продавца"} · WB {discovery.card.nmId}
                </div>
                {discovery.card.variants.length > 1 && (
                  <select
                    value={chrtId || ""}
                    onChange={(event) => setChrtId(Number(event.target.value) || null)}
                    className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
                  >
                    <option value="">Выберите размер</option>
                    {discovery.card.variants.map((variant) => (
                      <option key={variant.chrtId} value={variant.chrtId}>Размер {variant.sizeName} · chrtId {variant.chrtId}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-medium">Склады: выбрано {selectedWarehouses.size} из {discovery.warehouses.length}</div>
              <div className="flex gap-2 text-xs">
                <button type="button" onClick={() => setSelectedWarehouses(new Set(discovery.warehouses.map((item) => item.id)))} className="rounded border border-[var(--border)] px-2 py-1">Выбрать все</button>
                <button type="button" onClick={() => setSelectedWarehouses(new Set())} className="rounded border border-[var(--border)] px-2 py-1">Снять все</button>
              </div>
            </div>
            <div className="grid max-h-80 gap-2 overflow-y-auto sm:grid-cols-2 xl:grid-cols-3">
              {discovery.warehouses.map((warehouse) => (
                <label key={warehouse.id} className="flex cursor-pointer items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedWarehouses.has(warehouse.id)}
                    onChange={(event) => setSelectedWarehouses((current) => {
                      const next = new Set(current);
                      if (event.target.checked) next.add(warehouse.id); else next.delete(warehouse.id);
                      return next;
                    })}
                    className="h-4 w-4 accent-[var(--accent)]"
                  />
                  <span className="min-w-0 flex-1 truncate" title={warehouse.name}>{warehouse.name}</span>
                  <span className="tabular-nums text-[var(--text-muted)]" title={warehouse.error}>сейчас {warehouse.amount ?? "?"}</span>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setDiscovery(null)} className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm">Отмена</button>
              <button
                type="button"
                onClick={() => void configure()}
                disabled={busy === "configure" || !chrtId || selectedWarehouses.size === 0}
                className="flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {busy === "configure" ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
                Запустить управление
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Управляемые товары</h2>
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="animate-spin text-[var(--accent)]" /></div>
        ) : snapshot.products.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border)] p-10 text-center text-sm text-[var(--text-muted)]">Пока нет управляемых FBS-товаров.</div>
        ) : snapshot.products.map((product) => {
          const warehouses = snapshot.warehouses.filter((row) => row.product_id === product.id && row.enabled);
          const warehousesExpanded = expandedProducts.has(product.id);
          return (
            <article key={product.id} className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
              <div className="flex flex-wrap items-start gap-4">
                <ProductImage nmId={product.nm_id} photoUrl={product.photo_url} />
                <div className="min-w-[220px] flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-semibold">{product.title || product.vendor_code || product.nm_id}</h3>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${product.enabled ? "bg-emerald-500/15 text-emerald-300" : "bg-zinc-500/15 text-zinc-400"}`}>
                      {product.enabled ? "Автоуправление" : "Остановлено"}
                    </span>
                    {product.mismatch_count > 0 && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">Расхождений: {product.mismatch_count}</span>}
                  </div>
                  <div className="mt-1 text-sm text-[var(--text-muted)]">WB {product.nm_id} · chrtId {product.chrt_id}{product.size_name ? ` · размер ${product.size_name}` : ""}</div>
                  <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div><div className="text-xs text-[var(--text-muted)]">Физически</div><div className="font-semibold tabular-nums">{product.physical_quantity} шт.</div></div>
                    <div><div className="text-xs text-[var(--text-muted)]">Распределено</div><div className="font-semibold tabular-nums">{product.published_quantity} шт.</div></div>
                    <div><div className="text-xs text-[var(--text-muted)]">Складов</div><div className="font-semibold tabular-nums">{product.warehouse_count}</div></div>
                    <div><div className="text-xs text-[var(--text-muted)]">Последняя сверка</div><div className="text-sm font-medium">{formatDate(product.last_success_at)}</div></div>
                  </div>
                  {product.last_error && <div className="mt-3 text-sm text-red-300">{product.last_error}</div>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => void discover(String(product.nm_id), product)} disabled={Boolean(busy)} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--bg-card-hover)] disabled:opacity-50">Изменить</button>
                  {product.enabled && (
                    <>
                      <button type="button" onClick={() => void sync(product)} disabled={Boolean(busy)} className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--bg-card-hover)] disabled:opacity-50">
                        {busy === `sync-${product.id}` ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Сверить
                      </button>
                      <button type="button" onClick={() => void pause(product)} disabled={Boolean(busy)} className="flex items-center gap-2 rounded-lg border border-red-500/30 px-3 py-2 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-50">
                        <CirclePause size={15} /> Стоп
                      </button>
                    </>
                  )}
                  <button type="button" onClick={() => void zeroStocks(product)} disabled={Boolean(busy)} className="flex items-center gap-2 rounded-lg border border-red-500/30 px-3 py-2 text-sm text-red-300 hover:bg-red-500/10 disabled:opacity-50">
                    {busy === `zero-${product.id}` ? <Loader2 size={15} className="animate-spin" /> : <CircleX size={15} />} Обнулить
                  </button>
                </div>
              </div>
              {warehouses.length > 0 && (
                <button
                  type="button"
                  onClick={() => setExpandedProducts((current) => {
                    const next = new Set(current);
                    if (next.has(product.id)) next.delete(product.id); else next.add(product.id);
                    return next;
                  })}
                  aria-expanded={warehousesExpanded}
                  aria-controls={`fbs-warehouses-${product.id}`}
                  className="mt-4 flex w-full items-center justify-between rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm transition-colors hover:bg-[var(--bg-card-hover)]"
                >
                  <span className="flex items-center gap-2 font-medium">
                    {warehousesExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    Склады
                  </span>
                  <span className="text-[var(--text-muted)]">{warehouses.length}</span>
                </button>
              )}
              {warehouses.length > 0 && warehousesExpanded && (
                <div id={`fbs-warehouses-${product.id}`} className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[700px] border-collapse text-sm">
                    <thead><tr className="text-left text-xs text-[var(--text-muted)]"><th className="border-b border-[var(--border)] px-3 py-2">Склад</th><th className="border-b border-[var(--border)] px-3 py-2 text-center">Цель</th><th className="border-b border-[var(--border)] px-3 py-2 text-center">Подтверждено WB</th><th className="border-b border-[var(--border)] px-3 py-2 text-center">Заказов 30 дней</th><th className="border-b border-[var(--border)] px-3 py-2">Статус</th></tr></thead>
                    <tbody>{warehouses.map((warehouse) => {
                      const matches = warehouse.confirmed_quantity === warehouse.target_quantity && !warehouse.last_error;
                      return <tr key={warehouse.warehouse_id}><td className="border-b border-[var(--border)]/60 px-3 py-2">{warehouse.warehouse_name}</td><td className="border-b border-[var(--border)]/60 px-3 py-2 text-center font-semibold tabular-nums">{warehouse.target_quantity}</td><td className="border-b border-[var(--border)]/60 px-3 py-2 text-center tabular-nums">{warehouse.confirmed_quantity ?? "—"}</td><td className="border-b border-[var(--border)]/60 px-3 py-2 text-center tabular-nums">{warehouse.orders_30d}</td><td className={`border-b border-[var(--border)]/60 px-3 py-2 ${matches ? "text-emerald-300" : "text-amber-300"}`}>{warehouse.last_error || (matches ? "Совпадает" : "Ожидает сверки")}</td></tr>;
                    })}</tbody>
                  </table>
                </div>
              )}
            </article>
          );
        })}
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-5">
        <h2 className="text-lg font-semibold">Последние операции</h2>
        <div className="mt-3 max-h-80 overflow-auto">
          {snapshot.audit.length === 0 ? <div className="py-6 text-center text-sm text-[var(--text-muted)]">Операций пока нет.</div> : (
            <table className="w-full min-w-[700px] text-sm">
              <thead><tr className="text-left text-xs text-[var(--text-muted)]"><th className="px-2 py-2">Время</th><th className="px-2 py-2">Операция</th><th className="px-2 py-2">Заказ</th><th className="px-2 py-2">Результат</th></tr></thead>
              <tbody>{snapshot.audit.map((row) => <tr key={row.id}><td className="border-t border-[var(--border)]/60 px-2 py-2 whitespace-nowrap">{formatDate(row.created_at)}</td><td className="border-t border-[var(--border)]/60 px-2 py-2">{actionLabel(row.action)}</td><td className="border-t border-[var(--border)]/60 px-2 py-2 font-mono text-xs">{row.order_id || "—"}</td><td className={`border-t border-[var(--border)]/60 px-2 py-2 ${row.status === "error" ? "text-red-300" : ""}`}>{row.message || row.status}</td></tr>)}</tbody>
            </table>
          )}
        </div>
      </section>

      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
        <strong>Правило безопасности:</strong> автоматизация не забирает последнюю единицу со склада. Если второй склад имеет больше одной единицы, одна единица переносится на нулевой склад. Поздние возвраты и дефекты не добавляются автоматически — только ранняя отмена или отмена продавцом.
      </div>
    </div>
  );
}
