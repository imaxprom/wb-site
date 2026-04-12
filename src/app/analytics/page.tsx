"use client";

import { useMemo, useState, useEffect, useCallback } from "react";
import { useData } from "@/components/DataProvider";
import { calculateShipment, calculateDeficit, getOrderStats } from "@/modules/analytics/lib/engine";
import { StatCard } from "@/components/StatCard";
import { RegionPieChart, OrdersLineChart } from "@/components/Charts";
import { RegionalMatrix } from "@/modules/analytics/components/RegionalMatrix";
import DateRangePicker from "@/components/DateRangePicker";
import { formatNumber, formatPercent } from "@/lib/utils";
import Link from "next/link";
import type { OrderRecord } from "@/types";

function fmt(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function AnalyticsPage() {
  const { stock, products, settings, overrides, isLoaded, uploadDate } = useData();

  // Date range state — default 30 days ending yesterday
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return fmt(d);
  });
  const [dateTo, setDateTo] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return fmt(d);
  });
  const [showPicker, setShowPicker] = useState(false);

  // Local orders loaded by date range
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [weeklyStats, setWeeklyStats] = useState<{ orders: number; deliveries: number; returns: number; returnRate: number; buyouts: number } | null>(null);

  const fetchOrders = useCallback(async (from: string, to: string) => {
    setLoadingOrders(true);
    try {
      const [ordersRes, statsRes] = await Promise.all([
        fetch(`/api/data/orders?from=${from}&to=${to}`),
        fetch(`/api/data/order-stats?from=${from}&to=${to}`),
      ]);
      const data = await ordersRes.json();
      if (Array.isArray(data)) setOrders(data);
      if (statsRes.ok) {
        const s = await statsRes.json();
        if (s.deliveries > 0 || s.orders > 0) setWeeklyStats(s);
        else setWeeklyStats(null);
      }
    } catch (e) {
      console.error("Failed to fetch orders:", e);
    } finally {
      setLoadingOrders(false);
    }
  }, []);

  useEffect(() => {
    if (dateFrom && dateTo) fetchOrders(dateFrom, dateTo);
  }, [dateFrom, dateTo, fetchOrders]);

  const stats = useMemo(() => {
    if (!orders.length) return null;
    return getOrderStats(orders);
  }, [orders]);

  const calculations = useMemo(() => {
    if (!products.length || !stock.length) return [];
    return products.map((p) =>
      calculateShipment(p, stock, orders, settings.buyoutRate, settings.regions, overrides[p.articleWB])
    );
  }, [products, stock, orders, settings, overrides]);

  const totalDeficit = useMemo(() => {
    return calculations.reduce(
      (sum, calc) =>
        sum + calc.rows.reduce((s, row) => s + calculateDeficit(row), 0),
      0
    );
  }, [calculations]);


  // Format date for display
  const formatDisplayDate = (d: string) => {
    const date = new Date(d);
    return date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
  };

  if (!isLoaded) {
    return <div className="flex items-center justify-center h-screen text-[var(--text-muted)]">Загрузка...</div>;
  }

  if (!orders.length && !stock.length && !loadingOrders) {
    return (
      <div className="flex flex-col items-center justify-center h-[80vh] text-center">
        <h2 className="text-2xl font-bold mb-2">Нет данных для анализа</h2>
        <p className="text-[var(--text-muted)] mb-6">Загрузите данные из Wildberries API</p>
        <Link
          href="/upload"
          className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white px-6 py-3 rounded-lg font-medium transition-colors"
        >
          Загрузить данные
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Аналитика</h2>
          <div className="relative">
            <button
              onClick={() => setShowPicker(!showPicker)}
              className="flex items-center gap-2 text-sm text-[var(--text-muted)] mt-1.5 px-3 py-1.5 border border-[var(--border)] rounded-lg hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
            >
              {formatDisplayDate(dateFrom)} — {formatDisplayDate(dateTo)}
              <svg className="w-4 h-4 opacity-40" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="18" rx="2" /><path d="M16 2v4M8 2v4M3 10h18" /></svg>
            </button>
            {showPicker && (
              <div className="absolute left-0 top-full mt-2 z-50">
                <DateRangePicker
                  dateFrom={dateFrom}
                  dateTo={dateTo}
                  onChange={(from: string, to: string) => {
                    setDateFrom(from);
                    setDateTo(to);
                  }}
                  onClose={() => setShowPicker(false)}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {loadingOrders && (
        <div className="text-center py-4 text-[var(--text-muted)] text-sm animate-pulse">
          Загрузка заказов...
        </div>
      )}

      {/* Main stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard
          title="Заказы"
          value={formatNumber(weeklyStats?.orders || stats?.total || 0)}
          color="warning"
        />
        <StatCard
          title="Доставки"
          value={formatNumber(weeklyStats?.deliveries || 0)}
          color="default"
        />
        <StatCard
          title="Отказы"
          value={formatNumber(weeklyStats?.returns || stats?.cancels || 0)}
          subtitle={formatPercent(weeklyStats?.returnRate || stats?.cancelRate || 0)}
          color={weeklyStats ? (weeklyStats.returnRate > 0.2 ? "danger" : "warning") : stats && stats.cancelRate > 0.15 ? "danger" : "warning"}
        />
        <StatCard
          title="Выкупы"
          value={formatNumber(weeklyStats?.buyouts || (stats?.total || 0) - (stats?.cancels || 0))}
          color="success"
        />
        <StatCard
          title="Остатки на складах"
          value={formatNumber(stock.reduce((s, i) => s + i.totalOnWarehouses, 0)) + " шт"}
          color="default"
        />
      </div>

      {/* Region pie (1/4) + Regional matrix (3/4) */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-stretch">
        {stats && (
          <div className="h-full">
            <RegionPieChart data={stats.byRegion} />
          </div>
        )}

        {orders.length > 0 && (
          <div className="lg:col-span-3 h-full">
            <RegionalMatrix orders={orders} />
          </div>
        )}
      </div>

      {/* Orders chart */}
      {stats && <OrdersLineChart data={stats.byDate} />}
    </div>
  );
}
