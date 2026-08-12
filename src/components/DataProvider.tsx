"use client";

import React, { createContext, useContext, useReducer, useEffect, useCallback, useRef, useState } from "react";
import type { StockItem, OrderRecord, OrderAggregates, Product, ProductOverrides, WarehouseReadyStockRow } from "@/types";
import type { AppSettings } from "@/types";
import { getDefaultRegions, getDefaultRegionGroups } from "@/modules/shipment/lib/engine";
import { normalizeExcludedWarehouseNames } from "@/modules/shipment/lib/warehouse-stock-exclusions";

// --- State ---

interface DataState {
  stock: StockItem[];
  orders: OrderRecord[];
  orderAggregates: OrderAggregates | null;
  products: Product[];
  warehouseReadyStock: WarehouseReadyStockRow[];
  uploadDate: string | null;
  settings: AppSettings;
  overrides: ProductOverrides;
  isLoaded: boolean;
}

const INITIAL_STATE: DataState = {
  stock: [],
  orders: [],
  orderAggregates: null,
  products: [],
  warehouseReadyStock: [],
  uploadDate: null,
  settings: { buyoutRate: 0.75, regions: getDefaultRegions(), regionGroups: getDefaultRegionGroups(), buyoutMode: "auto", regionMode: "auto" },
  overrides: {},
  isLoaded: false,
};

// --- Actions ---

type DataAction =
  | { type: "INIT"; data: Omit<DataState, "isLoaded"> }
  | { type: "SET_DATA"; stock: StockItem[]; orders: OrderRecord[]; orderAggregates: OrderAggregates | null; products: Product[]; warehouseReadyStock: WarehouseReadyStockRow[]; uploadDate: string }
  | { type: "SET_WAREHOUSE_READY_STOCK"; warehouseReadyStock: WarehouseReadyStockRow[] }
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
        orderAggregates: action.orderAggregates,
        products: action.products,
        warehouseReadyStock: action.warehouseReadyStock,
        uploadDate: action.uploadDate,
      };

    case "SET_WAREHOUSE_READY_STOCK":
      return {
        ...state,
        warehouseReadyStock: action.warehouseReadyStock,
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
        orderAggregates: null,
        products: [],
        warehouseReadyStock: [],
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
  orderAggregates: OrderAggregates | null;
  products: Product[];
  warehouseReadyStock: WarehouseReadyStockRow[];
  uploadDate: string | null;
  settings: AppSettings;
  overrides: ProductOverrides;
  isLoaded: boolean;
  isWarehouseReadyStockRefreshing: boolean;
  refreshData: () => Promise<void>;
  refreshWarehouseReadyStock: () => Promise<void>;
  syncFromWB: (days: number) => Promise<void>;
  updateProductPerBox: (articleWB: string, barcode: string, perBox: number) => void;
  updateCustomName: (articleWB: string, customName: string) => void;
  toggleSizeDisabled: (articleWB: string, barcode: string, disabled: boolean) => void;
  updateSettings: (settings: Partial<AppSettings>) => Promise<void>;
  clearAllData: () => void;
}

const DataContext = createContext<DataContextType | null>(null);

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}

async function fetchWarehouseReadyStock(): Promise<WarehouseReadyStockRow[] | null> {
  const res = await fetch("/api/warehouse/stock", { cache: "no-store" });
  if (!res.ok) return null;
  const payload = await res.json().catch(() => ({ rows: [] })) as { rows?: WarehouseReadyStockRow[] };
  return Array.isArray(payload.rows) ? payload.rows : [];
}

// --- Provider ---

export function DataProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(dataReducer, INITIAL_STATE);
  const [isWarehouseReadyStockRefreshing, setIsWarehouseReadyStockRefreshing] = useState(false);
  const warehouseRefreshPromiseRef = useRef<Promise<void> | null>(null);

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

    const [aggRes, stockRes, productsRes, warehouseRes, metaRes] = await Promise.all([
      fetch(`/api/data/orders-aggregated?days=${days}`),
      fetch("/api/data/stock"),
      fetch("/api/data/products"),
      fetch("/api/warehouse/stock"),
      fetch("/api/data/meta"),
    ]);

    const [orderAggregates, stock, products, warehouse, meta] = await Promise.all([
      aggRes.ok ? (aggRes.json() as Promise<OrderAggregates>) : Promise.resolve(null),
      stockRes.ok ? (stockRes.json() as Promise<StockItem[]>) : Promise.resolve([]),
      productsRes.ok ? (productsRes.json() as Promise<Product[]>) : Promise.resolve([]),
      warehouseRes.ok ? (warehouseRes.json() as Promise<{ rows?: WarehouseReadyStockRow[] }>) : Promise.resolve({ rows: [] }),
      metaRes.ok ? (metaRes.json() as Promise<{ uploadDate: string | null }>) : Promise.resolve({ uploadDate: null }),
    ]);

    dispatch({
      type: "SET_DATA",
      stock,
      orders: [],
      orderAggregates,
      products,
      warehouseReadyStock: warehouse.rows || [],
      uploadDate: meta.uploadDate || new Date().toISOString(),
    });
  }, []);

  const refreshWarehouseReadyStock = useCallback(async () => {
    if (warehouseRefreshPromiseRef.current) {
      return warehouseRefreshPromiseRef.current;
    }

    setIsWarehouseReadyStockRefreshing(true);
    const task = (async () => {
      try {
        const syncRes = await fetch("/api/warehouse/sync", { method: "POST" });
        if (!syncRes.ok) {
          const payload = await syncRes.json().catch(() => ({})) as { error?: string };
          const isLocalReadonly = syncRes.status === 403 && payload.error?.includes("local PostgreSQL readonly mode");
          if (!isLocalReadonly) {
            console.warn("Warehouse Google sync failed:", payload.error || `HTTP ${syncRes.status}`);
          }
        }
      } catch (err) {
        console.warn("Warehouse Google sync failed:", err);
      }

      const warehouseReadyStock = await fetchWarehouseReadyStock();
      if (warehouseReadyStock) {
        dispatch({ type: "SET_WAREHOUSE_READY_STOCK", warehouseReadyStock });
      }
    })();

    warehouseRefreshPromiseRef.current = task;
    try {
      await task;
    } finally {
      if (warehouseRefreshPromiseRef.current === task) {
        warehouseRefreshPromiseRef.current = null;
        setIsWarehouseReadyStockRefreshing(false);
      }
    }
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
          uploadDays: typeof raw.uploadDays === "number" ? raw.uploadDays : 28,
          shipmentExcludedWarehouseNames: normalizeExcludedWarehouseNames(raw.shipmentExcludedWarehouseNames),
          maxArticlesPerBox: typeof raw.maxArticlesPerBox === "number" ? raw.maxArticlesPerBox : undefined,
          shipmentsPerMonth: typeof raw.shipmentsPerMonth === "number" ? raw.shipmentsPerMonth : undefined,
          minUnits: typeof raw.minUnits === "number" ? raw.minUnits : undefined,
          roundTo: typeof raw.roundTo === "number" ? raw.roundTo : undefined,
          packingVariant: typeof raw.packingVariant === "string" ? raw.packingVariant : undefined,
          v2ShipmentsPerMonth: typeof raw.v2ShipmentsPerMonth === "number" ? raw.v2ShipmentsPerMonth : undefined,
          v2MinUnits: typeof raw.v2MinUnits === "number" ? raw.v2MinUnits : undefined,
          v2RoundTo: typeof raw.v2RoundTo === "number" ? raw.v2RoundTo : undefined,
          v2MaxArticlesPerBox: typeof raw.v2MaxArticlesPerBox === "number" ? raw.v2MaxArticlesPerBox : undefined,
          v2ViewMode: typeof raw.v2ViewMode === "string" ? raw.v2ViewMode : undefined,
          v2UnitRounding: typeof raw.v2UnitRounding === "number" ? raw.v2UnitRounding : undefined,
          shipmentCalcMode: typeof raw.shipmentCalcMode === "string" ? raw.shipmentCalcMode : undefined,
        };
      }

      if (overridesRes.ok) {
        overrides = await overridesRes.json() as ProductOverrides;
      }

      if (cancelled) return;

      // 3. Load data from server
      try {
        const days = [28, 35, 42, 49, 56].includes(uploadDays) ? uploadDays : 28;

        const [aggRes, stockRes, productsRes, warehouseRes, metaRes] = await Promise.all([
          fetch(`/api/data/orders-aggregated?days=${days}`),
          fetch("/api/data/stock"),
          fetch("/api/data/products"),
          fetch("/api/warehouse/stock", { cache: "no-store" }),
          fetch("/api/data/meta"),
        ]);

        if (cancelled) return;

        const [orderAggregates, stock, products, warehouse, meta] = await Promise.all([
          aggRes.ok ? (aggRes.json() as Promise<OrderAggregates>) : Promise.resolve(null),
          stockRes.ok ? (stockRes.json() as Promise<StockItem[]>) : Promise.resolve([]),
          productsRes.ok ? (productsRes.json() as Promise<Product[]>) : Promise.resolve([]),
          warehouseRes.ok ? (warehouseRes.json() as Promise<{ rows?: WarehouseReadyStockRow[] }>) : Promise.resolve({ rows: [] }),
          metaRes.ok ? (metaRes.json() as Promise<{ uploadDate: string | null }>) : Promise.resolve({ uploadDate: null }),
        ]);

        if (cancelled) return;

        // Init with ALL data at once — no intermediate empty state
        dispatch({
          type: "INIT",
          data: {
            stock,
            orders: [],
            orderAggregates,
            products,
            warehouseReadyStock: warehouse.rows || [],
            uploadDate: meta.uploadDate || "",
            settings,
            overrides,
          },
        });
      } catch (err) {
        // If data load fails, still init with settings so UI is usable
        dispatch({
          type: "INIT",
          data: {
            stock: [],
            orders: [],
            orderAggregates: null,
            products: [],
            warehouseReadyStock: [],
            uploadDate: null,
            settings,
            overrides,
          },
        });
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
    async (partial: Partial<AppSettings>) => {
      dispatch({ type: "UPDATE_SETTINGS", settings: partial });
      // Persist to API
      try {
        const response = await fetch("/api/settings", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(partial),
        });
        if (!response.ok) {
          throw new Error(`Settings save failed: HTTP ${response.status}`);
        }
      } catch (error) {
        console.warn(error);
      }
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
        orderAggregates: state.orderAggregates,
        products: state.products,
        warehouseReadyStock: state.warehouseReadyStock,
        uploadDate: state.uploadDate,
        settings: state.settings,
        overrides: state.overrides,
        isLoaded: state.isLoaded,
        isWarehouseReadyStockRefreshing,
        refreshData,
        refreshWarehouseReadyStock,
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
