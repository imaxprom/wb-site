"use client";

import React, { createContext, useContext, useReducer, useEffect, useCallback } from "react";
import type { StockItem, OrderRecord, Product, ProductOverrides } from "@/types";
import type { AppSettings } from "@/types";
import { getDefaultRegions, getDefaultRegionGroups } from "@/lib/calculation-engine";

// --- State ---

interface DataState {
  stock: StockItem[];
  orders: OrderRecord[];
  products: Product[];
  uploadDate: string | null;
  settings: AppSettings;
  overrides: ProductOverrides;
  isLoaded: boolean;
}

const INITIAL_STATE: DataState = {
  stock: [],
  orders: [],
  products: [],
  uploadDate: null,
  settings: { buyoutRate: 0.75, regions: getDefaultRegions(), regionGroups: getDefaultRegionGroups(), buyoutMode: "auto", regionMode: "auto" },
  overrides: {},
  isLoaded: false,
};

// --- Actions ---

type DataAction =
  | { type: "INIT"; data: Omit<DataState, "isLoaded"> }
  | { type: "SET_DATA"; stock: StockItem[]; orders: OrderRecord[]; products: Product[]; uploadDate: string }
  | { type: "UPDATE_OVERRIDE"; articleWB: string; customName?: string; barcode?: string; perBox?: number; disabled?: boolean }
  | { type: "UPDATE_SETTINGS"; settings: Partial<AppSettings> }
  | { type: "CLEAR" };

function dataReducer(state: DataState, action: DataAction): DataState {
  switch (action.type) {
    case "INIT":
      return { ...action.data, isLoaded: true };

    case "SET_DATA":
      return {
        ...state,
        stock: action.stock,
        orders: action.orders,
        products: action.products,
        uploadDate: action.uploadDate,
      };

    case "UPDATE_OVERRIDE": {
      const prev = state.overrides[action.articleWB] || { customName: "", perBox: {} };
      const updated = { ...prev };
      if (action.customName !== undefined) {
        updated.customName = action.customName;
      }
      if (action.barcode && action.perBox !== undefined) {
        updated.perBox = { ...updated.perBox, [action.barcode]: action.perBox };
      }
      if (action.barcode && action.disabled !== undefined) {
        updated.disabledSizes = { ...(updated.disabledSizes || {}), [action.barcode]: action.disabled };
      }
      return {
        ...state,
        overrides: { ...state.overrides, [action.articleWB]: updated },
      };
    }

    case "UPDATE_SETTINGS":
      return {
        ...state,
        settings: { ...state.settings, ...action.settings },
      };

    case "CLEAR":
      return {
        ...state,
        stock: [],
        orders: [],
        products: [],
        uploadDate: null,
        // ВАЖНО: overrides НЕ сбрасываются!
      };

    default:
      return state;
  }
}

// --- Context ---

interface DataContextType {
  stock: StockItem[];
  orders: OrderRecord[];
  products: Product[];
  uploadDate: string | null;
  settings: AppSettings;
  overrides: ProductOverrides;
  isLoaded: boolean;
  refreshData: () => Promise<void>;
  syncFromWB: (days: number) => Promise<void>;
  updateProductPerBox: (articleWB: string, barcode: string, perBox: number) => void;
  updateCustomName: (articleWB: string, customName: string) => void;
  toggleSizeDisabled: (articleWB: string, barcode: string, disabled: boolean) => void;
  updateSettings: (settings: Partial<AppSettings>) => void;
  clearAllData: () => void;
}

const DataContext = createContext<DataContextType | null>(null);

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}

// --- Provider ---

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(dataReducer, INITIAL_STATE);

  const refreshData = useCallback(async () => {
    // Get uploadDays from settings API
    const settingsRes = await fetch("/api/settings").catch(() => null);
    let days = 28;
    if (settingsRes?.ok) {
      const raw = await settingsRes.json().catch(() => ({})) as Record<string, unknown>;
      if (typeof raw.uploadDays === "number" && [28, 35, 42, 49, 56].includes(raw.uploadDays)) {
        days = raw.uploadDays;
      }
    }

    const [ordersRes, stockRes, productsRes, metaRes] = await Promise.all([
      fetch(`/api/data/orders?days=${days}`),
      fetch("/api/data/stock"),
      fetch("/api/data/products"),
      fetch("/api/data/meta"),
    ]);

    const [orders, stock, products, meta] = await Promise.all([
      ordersRes.ok ? (ordersRes.json() as Promise<OrderRecord[]>) : Promise.resolve([]),
      stockRes.ok ? (stockRes.json() as Promise<StockItem[]>) : Promise.resolve([]),
      productsRes.ok ? (productsRes.json() as Promise<Product[]>) : Promise.resolve([]),
      metaRes.ok ? (metaRes.json() as Promise<{ uploadDate: string | null }>) : Promise.resolve({ uploadDate: null }),
    ]);

    dispatch({
      type: "SET_DATA",
      stock,
      orders,
      products,
      uploadDate: meta.uploadDate || new Date().toISOString(),
    });
  }, []);

  const syncFromWB = useCallback(async (days: number) => {
    const res = await fetch("/api/data/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ days }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "Unknown error" })) as { error?: string };
      throw new Error(err.error || `Sync failed: ${res.status}`);
    }
    await refreshData();
  }, [refreshData]);

  // Load data from server on mount
  useEffect(() => {
    let cancelled = false;

    async function init() {
      // Clean up legacy IndexedDB
      if (typeof window !== "undefined") {
        try {
          const dbs = await indexedDB.databases?.() || [];
          for (const db of dbs) {
            if (db.name === "wb-shipment") {
              indexedDB.deleteDatabase("wb-shipment");
            }
          }
        } catch { /* ignore */ }
      }

      // 1. Fetch auth user (to confirm logged in)
      const meRes = await fetch("/api/auth/me");
      if (!meRes.ok) {
        // Middleware will redirect, just stop loading
        return;
      }

      // 2. Fetch settings and overrides from API
      const [settingsRes, overridesRes] = await Promise.all([
        fetch("/api/settings"),
        fetch("/api/overrides"),
      ]);

      if (cancelled) return;

      let settings: AppSettings = {
        buyoutRate: 0.75,
        regions: getDefaultRegions(),
        regionGroups: getDefaultRegionGroups(),
        buyoutMode: "auto",
        regionMode: "auto",
      };

      let overrides: ProductOverrides = {};
      let uploadDays = 28;

      if (settingsRes.ok) {
        const raw = await settingsRes.json() as Record<string, unknown>;
        if (typeof raw.uploadDays === "number") {
          uploadDays = raw.uploadDays;
        }
        settings = {
          buyoutRate: typeof raw.buyoutRate === "number" ? raw.buyoutRate : 0.75,
          buyoutMode: (raw.buyoutMode as "manual" | "auto") || "auto",
          regionMode: (raw.regionMode as "manual" | "auto") || "auto",
          regions: (raw.regions as typeof settings.regions) || getDefaultRegions(),
          regionGroups: (raw.regionGroups as typeof settings.regionGroups) || getDefaultRegionGroups(),
          boxLengthCm: typeof raw.boxLengthCm === "number" ? raw.boxLengthCm : 60,
          boxWidthCm: typeof raw.boxWidthCm === "number" ? raw.boxWidthCm : 40,
          boxHeightCm: typeof raw.boxHeightCm === "number" ? raw.boxHeightCm : 40,
        };
      }

      if (overridesRes.ok) {
        overrides = await overridesRes.json() as ProductOverrides;
      }

      if (cancelled) return;

      // Init state
      dispatch({
        type: "INIT",
        data: {
          stock: [],
          orders: [],
          products: [],
          uploadDate: null,
          settings,
          overrides,
        },
      });

      // 3. Load data from server
      try {
        const days = [28, 35, 42, 49, 56].includes(uploadDays) ? uploadDays : 28;

        const [ordersRes2, stockRes, productsRes, metaRes] = await Promise.all([
          fetch(`/api/data/orders?days=${days}`),
          fetch("/api/data/stock"),
          fetch("/api/data/products"),
          fetch("/api/data/meta"),
        ]);

        if (cancelled) return;

        const [orders, stock, products, meta] = await Promise.all([
          ordersRes2.ok ? (ordersRes2.json() as Promise<OrderRecord[]>) : Promise.resolve([]),
          stockRes.ok ? (stockRes.json() as Promise<StockItem[]>) : Promise.resolve([]),
          productsRes.ok ? (productsRes.json() as Promise<Product[]>) : Promise.resolve([]),
          metaRes.ok ? (metaRes.json() as Promise<{ uploadDate: string | null }>) : Promise.resolve({ uploadDate: null }),
        ]);

        if (cancelled) return;
        dispatch({
          type: "SET_DATA",
          stock,
          orders,
          products,
          uploadDate: meta.uploadDate || "",
        });
      } catch (err) {
        console.warn("Failed to load data from server API:", err);
      }
    }

    init();
    return () => { cancelled = true; };
  }, []);

  const updateProductPerBox = useCallback(
    (articleWB: string, barcode: string, perBox: number) => {
      dispatch({ type: "UPDATE_OVERRIDE", articleWB, barcode, perBox });
      // Persist to API
      fetch("/api/overrides", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articleWB, barcode, perBox }),
      }).catch(console.warn);
    },
    []
  );

  const updateCustomName = useCallback(
    (articleWB: string, customName: string) => {
      dispatch({ type: "UPDATE_OVERRIDE", articleWB, customName });
      // Persist to API (empty barcode for customName)
      fetch("/api/overrides", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articleWB, barcode: "", customName }),
      }).catch(console.warn);
    },
    []
  );

  const toggleSizeDisabled = useCallback(
    (articleWB: string, barcode: string, disabled: boolean) => {
      dispatch({ type: "UPDATE_OVERRIDE", articleWB, barcode, disabled });
      // Persist to API
      fetch("/api/overrides", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ articleWB, barcode, disabled }),
      }).catch(console.warn);
    },
    []
  );

  const updateSettings = useCallback(
    (partial: Partial<AppSettings>) => {
      dispatch({ type: "UPDATE_SETTINGS", settings: partial });
      // Persist to API
      fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(partial),
      }).catch(console.warn);
    },
    []
  );

  const clearAllData = useCallback(() => {
    dispatch({ type: "CLEAR" });
  }, []);

  return (
    <DataContext.Provider
      value={{
        stock: state.stock,
        orders: state.orders,
        products: state.products,
        uploadDate: state.uploadDate,
        settings: state.settings,
        overrides: state.overrides,
        isLoaded: state.isLoaded,
        refreshData,
        syncFromWB,
        updateProductPerBox,
        updateCustomName,
        toggleSizeDisabled,
        updateSettings,
        clearAllData,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}
