"use client";

import React, { createContext, useContext, useReducer, useEffect, useCallback } from "react";
import type { StockItem, OrderRecord, Product } from "@/types";
import { loadData, saveData, clearData, loadSettings, saveSettings, type AppSettings } from "@/lib/store";
import { getDefaultRegions } from "@/lib/calculation-engine";
import { detectProducts } from "@/lib/excel-parser";
import { mergeStock, mergeOrders } from "@/lib/merge-utils";

// --- State ---

interface DataState {
  stock: StockItem[];
  orders: OrderRecord[];
  products: Product[];
  uploadDate: string | null;
  settings: AppSettings;
  isLoaded: boolean;
}

const INITIAL_STATE: DataState = {
  stock: [],
  orders: [],
  products: [],
  uploadDate: null,
  settings: { buyoutRate: 0.75, regions: getDefaultRegions() },
  isLoaded: false,
};

// --- Actions ---

type DataAction =
  | { type: "INIT"; data: Omit<DataState, "isLoaded"> }
  | { type: "SET_DATA"; stock: StockItem[]; orders: OrderRecord[]; products: Product[]; uploadDate: string }
  | { type: "MERGE_DATA"; stock: StockItem[]; orders: OrderRecord[]; uploadDate: string }
  | { type: "UPDATE_PER_BOX"; articleWB: string; barcode: string; perBox: number }
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

    case "MERGE_DATA": {
      const mergedStock = mergeStock(state.stock, action.stock);
      const mergedOrders = mergeOrders(state.orders, action.orders);
      const mergedProducts = detectProducts(mergedStock);
      return {
        ...state,
        stock: mergedStock,
        orders: mergedOrders,
        products: mergedProducts,
        uploadDate: action.uploadDate,
      };
    }

    case "UPDATE_PER_BOX":
      return {
        ...state,
        products: state.products.map((p) => {
          if (p.articleWB !== action.articleWB) return p;
          return {
            ...p,
            sizes: p.sizes.map((s) =>
              s.barcode === action.barcode ? { ...s, perBox: action.perBox } : s
            ),
          };
        }),
      };

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
  isLoaded: boolean;
  setUploadedData: (data: { stock: StockItem[]; orders: OrderRecord[]; products: Product[] }) => void;
  mergeUploadedData: (data: { stock: StockItem[]; orders: OrderRecord[] }) => void;
  updateProductPerBox: (articleWB: string, barcode: string, perBox: number) => void;
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

  // Load persisted data on mount (async — IndexedDB)
  useEffect(() => {
    let cancelled = false;
    async function init() {
      const data = await loadData();
      const settings = loadSettings();
      if (cancelled) return;
      dispatch({
        type: "INIT",
        data: {
          stock: data?.stock || [],
          orders: data?.orders || [],
          products: data?.products || [],
          uploadDate: data?.uploadDate || null,
          settings,
        },
      });
    }
    init();
    return () => { cancelled = true; };
  }, []);

  // Persist data whenever stock/orders/products/uploadDate change
  const prevUploadDateRef = React.useRef(state.uploadDate);
  useEffect(() => {
    if (state.isLoaded && state.uploadDate !== prevUploadDateRef.current) {
      prevUploadDateRef.current = state.uploadDate;
      saveData({
        stock: state.stock,
        orders: state.orders,
        products: state.products,
        uploadDate: state.uploadDate || new Date().toISOString(),
      });
    }
  }, [state.isLoaded, state.uploadDate, state.stock, state.orders, state.products]);

  // Persist products when perBox changes (uploadDate stays same)
  const prevProductsRef = React.useRef(state.products);
  useEffect(() => {
    if (state.isLoaded && state.products !== prevProductsRef.current) {
      prevProductsRef.current = state.products;
      saveData({
        stock: state.stock,
        orders: state.orders,
        products: state.products,
        uploadDate: state.uploadDate || new Date().toISOString(),
      });
    }
  }, [state.isLoaded, state.products, state.stock, state.orders, state.uploadDate]);

  // Persist settings
  const prevSettingsRef = React.useRef(state.settings);
  useEffect(() => {
    if (state.isLoaded && state.settings !== prevSettingsRef.current) {
      prevSettingsRef.current = state.settings;
      saveSettings(state.settings);
    }
  }, [state.isLoaded, state.settings]);

  const setUploadedData = useCallback(
    (data: { stock: StockItem[]; orders: OrderRecord[]; products: Product[] }) => {
      const uploadDate = new Date().toISOString();
      dispatch({ type: "SET_DATA", ...data, uploadDate });
    },
    []
  );

  const mergeUploadedData = useCallback(
    (incoming: { stock: StockItem[]; orders: OrderRecord[] }) => {
      const uploadDate = new Date().toISOString();
      dispatch({ type: "MERGE_DATA", ...incoming, uploadDate });
    },
    []
  );

  const updateProductPerBox = useCallback(
    (articleWB: string, barcode: string, perBox: number) => {
      dispatch({ type: "UPDATE_PER_BOX", articleWB, barcode, perBox });
    },
    []
  );

  const updateSettings = useCallback(
    (partial: Partial<AppSettings>) => {
      dispatch({ type: "UPDATE_SETTINGS", settings: partial });
    },
    []
  );

  const clearAllData = useCallback(() => {
    dispatch({ type: "CLEAR" });
    clearData();
  }, []);

  return (
    <DataContext.Provider
      value={{
        stock: state.stock,
        orders: state.orders,
        products: state.products,
        uploadDate: state.uploadDate,
        settings: state.settings,
        isLoaded: state.isLoaded,
        setUploadedData,
        mergeUploadedData,
        updateProductPerBox,
        updateSettings,
        clearAllData,
      }}
    >
      {children}
    </DataContext.Provider>
  );
}
