"use client";

import { useMemo } from "react";
import { useData } from "@/components/DataProvider";
import { StatCard } from "@/components/StatCard";
import { calculateShipment, calculateDeficit, getOrderStats } from "@/lib/calculation-engine";
import { formatNumber, formatPercent } from "@/lib/utils";
import { SizeBarChart, DeficitBarChart } from "@/components/Charts";
import Link from "next/link";

export default function DashboardPage() {
  const { stock, orders, products, settings, isLoaded, uploadDate } = useData();

  const stats = useMemo(() => {
    if (!orders.length) return null;
    return getOrderStats(orders);
  }, [orders]);

  const calculations = useMemo(() => {
    if (!products.length || !stock.length) return [];
    return products.map((p) =>
      calculateShipment(p, stock, orders, settings.buyoutRate, settings.regions)
    );
  }, [products, stock, orders, settings]);

  const totalDeficit = useMemo(() => {
    return calculations.reduce(
      (sum, calc) =>
        sum + calc.rows.reduce((s, row) => s + calculateDeficit(row), 0),
      0
    );
  }, [calculations]);

  const deficitData = useMemo(() => {
    if (!calculations.length) return [];
    const calc = calculations[0];
    return calc.rows.map((row) => ({
      size: row.size,
      plan: Math.round(row.regions.reduce((s, r) => s + r.plan, 0)),
      fact: Math.round(row.regions.reduce((s, r) => s + r.fact, 0)),
    }));
  }, [calculations]);

  if (!isLoaded) {
    return <div className="flex items-center justify-center h-screen text-[var(--text-muted)]">Загрузка...</div>;
  }

  if (!orders.length && !stock.length) {
    return (
      <div className="flex flex-col items-center justify-center h-[80vh] text-center">
        <p className="text-6xl mb-6">📦</p>
        <h2 className="text-2xl font-bold mb-2">Добро пожаловать в WB Отгрузка</h2>
        <p className="text-[var(--text-muted)] mb-6 max-w-md">
          Загрузите файл с данными Wildberries, чтобы начать расчёт отгрузки на региональные склады
        </p>
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
          <h2 className="text-2xl font-bold">Дашборд</h2>
          {uploadDate && (
            <p className="text-sm text-[var(--text-muted)] mt-1">
              Данные от {new Date(uploadDate).toLocaleDateString("ru-RU")}
            </p>
          )}
        </div>
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Товаров"
          value={products.length}
          subtitle={`${stock.length} позиций на складах`}
        />
        <StatCard
          title="Заказов за 30 дней"
          value={formatNumber(stats?.total || 0)}
          subtitle={`Отмены: ${formatPercent(stats?.cancelRate || 0)}`}
          color={stats && stats.cancelRate > 0.15 ? "warning" : "default"}
        />
        <StatCard
          title="Общий дефицит"
          value={formatNumber(Math.round(totalDeficit)) + " шт"}
          subtitle="Требуется дозаказ"
          color={totalDeficit > 0 ? "danger" : "success"}
        />
        <StatCard
          title="Артикулов WB"
          value={products.length}
          subtitle={`${new Set(stock.map((s) => s.barcode)).size} уник. баркодов`}
        />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {stats?.bySize && Object.keys(stats.bySize).length > 0 && (
          <SizeBarChart data={stats.bySize} />
        )}
        {deficitData.length > 0 && <DeficitBarChart data={deficitData} />}
      </div>

      {/* Top deficits */}
      {calculations.length > 0 && (
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-5">
          <h3 className="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wide mb-4">
            Топ потребностей в отгрузке
          </h3>
          <div className="space-y-2">
            {calculations
              .flatMap((calc) =>
                calc.rows.map((row) => ({
                  product: calc.product.name,
                  size: row.size,
                  deficit: calculateDeficit(row),
                }))
              )
              .sort((a, b) => b.deficit - a.deficit)
              .slice(0, 8)
              .map((item, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between py-2 px-3 rounded-lg hover:bg-[var(--bg-card-hover)]"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-[var(--text-muted)] w-6">{i + 1}.</span>
                    <span className="text-sm font-medium">{item.size}</span>
                    <span className="text-xs text-[var(--text-muted)]">{item.product}</span>
                  </div>
                  <span className={`text-sm font-bold ${item.deficit > 0 ? "cell-negative" : "cell-positive"}`}>
                    {item.deficit > 0 ? `-${formatNumber(Math.round(item.deficit))}` : "OK"}
                  </span>
                </div>
              ))}
          </div>
        </div>
      )}
    </div>
  );
}
