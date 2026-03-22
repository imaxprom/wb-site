"use client";

import { useMemo } from "react";
import { useData } from "@/components/DataProvider";
import { getOrderStats } from "@/lib/calculation-engine";
import { StatCard } from "@/components/StatCard";
import { SizeBarChart, RegionPieChart, OrdersLineChart } from "@/components/Charts";
import { formatNumber, formatPercent } from "@/lib/utils";
import Link from "next/link";

export default function AnalyticsPage() {
  const { orders, stock, isLoaded } = useData();

  const stats = useMemo(() => {
    if (!orders.length) return null;
    return getOrderStats(orders);
  }, [orders]);

  const warehouseTop = useMemo(() => {
    if (!stats) return [];
    return Object.entries(stats.byWarehouse)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);
  }, [stats]);

  if (!isLoaded) {
    return <div className="flex items-center justify-center h-screen text-[var(--text-muted)]">Загрузка...</div>;
  }

  if (!orders.length) {
    return (
      <div className="flex flex-col items-center justify-center h-[80vh] text-center">
        <p className="text-6xl mb-6">📈</p>
        <h2 className="text-2xl font-bold mb-2">Нет данных для анализа</h2>
        <p className="text-[var(--text-muted)] mb-6">Загрузите файл с заказами</p>
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
      <div>
        <h2 className="text-2xl font-bold">Аналитика</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Анализ заказов и остатков Wildberries
        </p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard title="Всего заказов" value={formatNumber(stats!.total)} />
        <StatCard
          title="Без отмен"
          value={formatNumber(stats!.total - stats!.cancels)}
          color="success"
        />
        <StatCard
          title="Отмены"
          value={formatNumber(stats!.cancels)}
          subtitle={formatPercent(stats!.cancelRate)}
          color={stats!.cancelRate > 0.15 ? "danger" : "warning"}
        />
        <StatCard
          title="Уник. размеров"
          value={Object.keys(stats!.bySize).length}
        />
        <StatCard
          title="Складов"
          value={Object.keys(stats!.byWarehouse).length}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SizeBarChart data={stats!.bySize} />
        <RegionPieChart data={stats!.byRegion} />
      </div>

      <OrdersLineChart data={stats!.byDate} />

      {/* Warehouse table */}
      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
        <h3 className="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wide mb-4">
          Топ-10 складов по заказам
        </h3>
        <table className="data-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Склад</th>
              <th className="num">Заказов</th>
              <th className="num">% от общего</th>
            </tr>
          </thead>
          <tbody>
            {warehouseTop.map(([wh, count], i) => (
              <tr key={wh}>
                <td className="text-[var(--text-muted)]">{i + 1}</td>
                <td className="font-medium">{wh}</td>
                <td className="num">{formatNumber(count)}</td>
                <td className="num text-[var(--text-muted)]">
                  {formatPercent(count / (stats!.total - stats!.cancels))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Stock summary */}
      {stock.length > 0 && (
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
          <h3 className="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wide mb-4">
            Сводка по остаткам
          </h3>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <p className="text-[var(--text-muted)] text-sm">Всего на складах</p>
              <p className="text-2xl font-bold">
                {formatNumber(stock.reduce((s, i) => s + i.totalOnWarehouses, 0))}
              </p>
            </div>
            <div>
              <p className="text-[var(--text-muted)] text-sm">В пути к покупателям</p>
              <p className="text-2xl font-bold text-[var(--warning)]">
                {formatNumber(stock.reduce((s, i) => s + i.inTransitToCustomers, 0))}
              </p>
            </div>
            <div>
              <p className="text-[var(--text-muted)] text-sm">Возвраты в пути</p>
              <p className="text-2xl font-bold text-[var(--accent)]">
                {formatNumber(stock.reduce((s, i) => s + i.inTransitReturns, 0))}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
