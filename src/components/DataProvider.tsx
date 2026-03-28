"use client";

import React, { createContext, useContext, useReducer, useEffect, useCallback } from "react";
import type { StockItem, OrderRecord, Product, ProductOverrides } from "@/types";
import { loadSettings, saveSettings, loadOverrides, saveOverrides, type AppSettings } from "@/lib/store";
import { getDefaultRegions } from "@/lib/calculation-engine";

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
  settings: { buyoutRate: 0.75, regions: getDefaultRegions() },
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
    const days = (() => {
      if (typeof window === "undefined") return 28;
      const saved = Number(localStorage.getItem("wb-upload-days"));
      return [28, 35, 42, 49, 56].includes(saved) ? saved : 28;
    })();

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
      const [settings, overrides] = await Promise.all([
        Promise.resolve(loadSettings()),
        loadOverrides(),
      ]);
      if (cancelled) return;

      // Init state with settings/overrides first
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

      // Then load data from server API
      try {
        const days = (() => {
          if (typeof window === "undefined") return 28;
          const saved = Number(localStorage.getItem("wb-upload-days"));
          return [28, 35, 42, 49, 56].includes(saved) ? saved : 28;
        })();

        const [ordersRes, stockRes, productsRes, metaRes] = await Promise.all([
          fetch(`/api/data/orders?days=${days}`),
          fetch("/api/data/stock"),
          fetch("/api/data/products"),
          fetch("/api/data/meta"),
        ]);

        if (cancelled) return;

        const [orders, stock, products, meta] = await Promise.all([
          ordersRes.ok ? (ordersRes.json() as Promise<OrderRecord[]>) : Promise.resolve([]),
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

  // Persist settings
  const prevSettingsRef = React.useRef(state.settings);
  useEffect(() => {
    if (state.isLoaded && state.settings !== prevSettingsRef.current) {
      prevSettingsRef.current = state.settings;
      saveSettings(state.settings);
    }
  }, [state.isLoaded, state.settings]);

  const updateProductPerBox = useCallback(
    (articleWB: string, barcode: string, perBox: number) => {
      dispatch({ type: "UPDATE_OVERRIDE", articleWB, barcode, perBox });
    },
    []
  );

  const updateCustomName = useCallback(
    (articleWB: string, customName: string) => {
      dispatch({ type: "UPDATE_OVERRIDE", articleWB, customName });
    },
    []
  );

  const toggleSizeDisabled = useCallback(
    (articleWB: string, barcode: string, disabled: boolean) => {
      dispatch({ type: "UPDATE_OVERRIDE", articleWB, barcode, disabled });
    },
    []
  );

  // Persist overrides
  const prevOverridesRef = React.useRef(state.overrides);
  useEffect(() => {
    if (state.isLoaded && state.overrides !== prevOverridesRef.current) {
      prevOverridesRef.current = state.overrides;
      saveOverrides(state.overrides);
    }
  }, [state.isLoaded, state.overrides]);

  const updateSettings = useCallback(
    (partial: Partial<AppSettings>) => {
      dispatch({ type: "UPDATE_SETTINGS", settings: partial });
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
