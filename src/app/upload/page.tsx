"use client";

import { useState, useCallback, useEffect } from "react";
import { useData } from "@/components/DataProvider";
import { formatNumber } from "@/lib/utils";
import {
  getApiKey,
  fetchCards,
  fetchStocks,
  fetchOrders,
} from "@/lib/wb-api";
import { transformCards, transformStocks, transformOrders } from "@/lib/wb-transformers";
import Link from "next/link";

type StepState = "idle" | "loading" | "success" | "error";

interface WbStep {
  state: StepState;
  message: string;
}

export default function UploadPage() {
  const { stock, orders, products, uploadDate, clearAllData, mergeUploadedData } = useData();
  const hasData = stock.length > 0 || orders.length > 0;
  const [hasKey, setHasKey] = useState(false);
  const [days, setDays] = useState(30);
  const [steps, setSteps] = useState<{ cards: WbStep; stocks: WbStep; orders: WbStep }>({
    cards: { state: "idle", message: "" },
    stocks: { state: "idle", message: "" },
    orders: { state: "idle", message: "" },
  });
  const isLoading = steps.cards.state === "loading" || steps.stocks.state === "loading" || steps.orders.state === "loading";

  useEffect(() => {
    setHasKey(!!getApiKey());
  }, []);

  const loadAll = useCallback(async () => {
    // Cards
    setSteps((s) => ({ ...s, cards: { state: "loading", message: "Загрузка карточек..." } }));
    try {
      const cards = await fetchCards();
      const stubStock = cards.flatMap((card) =>
        card.sizes.map((size) => ({
          brand: card.brand,
          subject: "",
          articleSeller: card.vendorCode,
          articleWB: String(card.nmID),
          volume: "",
          barcode: size.skus[0] || "",
          size: size.techSize,
          inTransitToCustomers: 0,
          inTransitReturns: 0,
          totalOnWarehouses: 0,
          warehouseStock: {},
        }))
      );
      mergeUploadedData({ stock: stubStock, orders: [] });
      const transformed = transformCards(cards);
      setSteps((s) => ({
        ...s,
        cards: {
          state: "success",
          message: `${cards.length} карточек (${transformed.reduce((n, p) => n + p.sizes.length, 0)} размеров)`,
        },
      }));
    } catch (err) {
      setSteps((s) => ({
        ...s,
        cards: { state: "error", message: err instanceof Error ? err.message : "Ошибка" },
      }));
      return;
    }

    // Stocks
    setSteps((s) => ({ ...s, stocks: { state: "loading", message: "Загрузка остатков..." } }));
    try {
      const raw = await fetchStocks();
      const transformed = transformStocks(raw);
      mergeUploadedData({ stock: transformed, orders: [] });
      const whCount = new Set(raw.map((r) => r.warehouseName)).size;
      setSteps((s) => ({
        ...s,
        stocks: { state: "success", message: `${transformed.length} позиций с ${whCount} складов` },
      }));
    } catch (err) {
      setSteps((s) => ({
        ...s,
        stocks: { state: "error", message: err instanceof Error ? err.message : "Ошибка" },
      }));
      return;
    }

    // Orders
    setSteps((s) => ({ ...s, orders: { state: "loading", message: `Загрузка заказов за ${days} дней...` } }));
    try {
      const raw = await fetchOrders(days);
      const transformed = transformOrders(raw);
      mergeUploadedData({ stock: [], orders: transformed });
      setSteps((s) => ({
        ...s,
        orders: { state: "success", message: `${formatNumber(transformed.length)} заказов за ${days} дней` },
      }));
    } catch (err) {
      setSteps((s) => ({
        ...s,
        orders: { state: "error", message: err instanceof Error ? err.message : "Ошибка" },
      }));
    }
  }, [mergeUploadedData, days]);

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h2 className="text-2xl font-bold">Загрузка данных</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Загрузите данные из Wildberries API
        </p>
      </div>

      {/* WB API section */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
        <h3 className="font-medium mb-1">Загрузка из WB API</h3>
        <p className="text-xs text-[var(--text-muted)] mb-4">
          Автоматическая загрузка карточек, остатков и заказов из Wildberries
        </p>

        {!hasKey ? (
          <div className="bg-[var(--warning)]/10 border border-[var(--warning)]/30 rounded-lg p-3 text-sm">
            <p className="font-medium text-[var(--warning)]">API-ключ не задан</p>
            <p className="text-[var(--text-muted)] mt-1">
              Добавьте ключ в{" "}
              <Link href="/settings" className="text-[var(--accent)] hover:underline">
                Настройках
              </Link>
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <button
                onClick={loadAll}
                disabled={isLoading}
                className="px-5 py-2.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-40"
              >
                {isLoading ? "Загрузка..." : "Загрузить всё из WB"}
              </button>

              <div className="flex items-center gap-2 text-sm">
                <span className="text-[var(--text-muted)]">Заказы за</span>
                <input
                  type="number"
                  value={days}
                  onChange={(e) => setDays(Math.max(1, Math.min(90, Number(e.target.value) || 30)))}
                  className="w-16 bg-[var(--bg)] border border-[var(--border)] rounded px-2 py-1.5 text-center text-sm focus:outline-none focus:border-[var(--accent)]"
                  min="1"
                  max="90"
                />
                <span className="text-[var(--text-muted)]">дней</span>
              </div>
            </div>

            {/* Step statuses */}
            {(steps.cards.state !== "idle" || steps.stocks.state !== "idle" || steps.orders.state !== "idle") && (
              <div className="space-y-2">
                <StepStatus label="Карточки" step={steps.cards} />
                <StepStatus label="Остатки" step={steps.stocks} />
                <StepStatus label="Заказы" step={steps.orders} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Current data summary */}
      {hasData && (
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-medium">Текущие данные</h3>
            <button
              onClick={clearAllData}
              className="text-sm text-[var(--danger)] hover:text-[var(--danger)]/80 transition-colors"
            >
              Очистить всё
            </button>
          </div>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-[var(--text-muted)]">Остатки</p>
              <p className="text-lg font-bold">{formatNumber(stock.length)}</p>
              <p className="text-xs text-[var(--text-muted)]">позиций</p>
            </div>
            <div>
              <p className="text-[var(--text-muted)]">Заказы</p>
              <p className="text-lg font-bold">{formatNumber(orders.length)}</p>
              <p className="text-xs text-[var(--text-muted)]">записей</p>
            </div>
            <div>
              <p className="text-[var(--text-muted)]">Товары</p>
              <p className="text-lg font-bold">{products.length}</p>
              <p className="text-xs text-[var(--text-muted)]">артикулов</p>
            </div>
          </div>
          {uploadDate && (
            <p className="text-xs text-[var(--text-muted)] mt-3">
              Загружено: {new Date(uploadDate).toLocaleString("ru-RU")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function StepStatus({ label, step }: { label: string; step: WbStep }) {
  if (step.state === "idle") return null;

  const icon = step.state === "loading" ? "⏳" : step.state === "success" ? "✅" : "❌";
  const color =
    step.state === "loading"
      ? "text-[var(--accent)]"
      : step.state === "success"
      ? "text-[var(--success)]"
      : "text-[var(--danger)]";

  return (
    <div className={`flex items-center gap-2 text-sm ${color}`}>
      <span>{icon}</span>
      <span className="font-medium">{label}:</span>
      <span>{step.message}</span>
    </div>
  );
}
