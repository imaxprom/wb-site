"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import type { StockItem, Product, ProductOverrides } from "@/types";
import type { AppSettings } from "@/types";
import { getDefaultRegions, getDefaultRegionGroups } from "@/modules/analytics/lib/engine";

/**
 * Провайдер данных для Аналитики.
 * Независим от DataProvider (Отгрузка).
 * Загружает: settings, stock, products, overrides.
 */

interface AnalyticsData {
  stock: StockItem[];
  products: Product[];
  settings: AppSettings;
  overrides: ProductOverrides;
  isLoaded: boolean;
}

const AnalyticsContext = createContext<AnalyticsData | null>(null);

async function readJsonResponse<T>(response: Response, fallback: T): Promise<T> {
  if (!response.ok) return fallback;
  const text = await response.text();
  if (!text.trim()) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function useAnalyticsData() {
  const ctx = useContext(AnalyticsContext);
  if (!ctx) throw new Error("useAnalyticsData must be used within AnalyticsProvider");
  return ctx;
}

export function AnalyticsProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<AnalyticsData>({
    stock: [],
    products: [],
    settings: {
      buyoutRate: 0.75,
      regions: getDefaultRegions(),
      regionGroups: getDefaultRegionGroups(),
      buyoutMode: "auto",
      regionMode: "auto",
    },
    overrides: {},
    isLoaded: false,
  });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [settingsRes, overridesRes, stockRes, productsRes] = await Promise.all([
          fetch("/api/settings"),
          fetch("/api/overrides"),
          fetch("/api/data/stock"),
          fetch("/api/data/products"),
        ]);

        if (cancelled) return;

        let settings: AppSettings = data.settings;
        if (settingsRes.ok) {
          const raw = await readJsonResponse<Record<string, unknown>>(settingsRes, {});
          settings = {
            buyoutRate: typeof raw.buyoutRate === "number" ? raw.buyoutRate : 0.75,
            buyoutMode: (raw.buyoutMode as "manual" | "auto") || "auto",
            regionMode: (raw.regionMode as "manual" | "auto") || "auto",
            regions: (raw.regions as typeof settings.regions) || getDefaultRegions(),
            regionGroups: (raw.regionGroups as typeof settings.regionGroups) || getDefaultRegionGroups(),
          };
        }

        const overrides = await readJsonResponse<ProductOverrides>(overridesRes, {});
        const stock = await readJsonResponse<StockItem[]>(stockRes, []);
        const products = await readJsonResponse<Product[]>(productsRes, []);

        if (cancelled) return;
        setData({ stock, products, settings, overrides, isLoaded: true });
      } catch (err) {
        console.warn("[AnalyticsProvider] Failed to load:", err);
        if (!cancelled) setData(prev => ({ ...prev, isLoaded: true }));
      }
    }

    load();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <AnalyticsContext.Provider value={data}>
      {children}
    </AnalyticsContext.Provider>
  );
}
