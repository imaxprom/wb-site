import type { StockItem, OrderRecord, Product, RegionConfig } from "@/types";
import { getDefaultRegions } from "./calculation-engine";
import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "wb-shipment";
const DB_VERSION = 1;
const STORE_NAME = "app-data";
const SETTINGS_KEY = "wb-shipment-settings";

export interface AppData {
  stock: StockItem[];
  orders: OrderRecord[];
  products: Product[];
  uploadDate: string;
}

export interface AppSettings {
  buyoutRate: number;
  regions: RegionConfig[];
}

// --- IndexedDB for large data (orders can be 50+ MB) ---

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("No IndexedDB on server"));
  }
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      },
    });
  }
  return dbPromise;
}

export async function saveData(data: AppData): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const db = await getDB();
    // Store each piece separately to avoid single huge write
    await db.put(STORE_NAME, data.stock, "stock");
    await db.put(STORE_NAME, data.orders, "orders");
    await db.put(STORE_NAME, data.products, "products");
    await db.put(STORE_NAME, data.uploadDate, "uploadDate");
  } catch (err) {
    console.warn("Failed to save data to IndexedDB:", err);
  }
}

export async function loadData(): Promise<AppData | null> {
  if (typeof window === "undefined") return null;
  try {
    const db = await getDB();
    const stock = await db.get(STORE_NAME, "stock");
    const orders = await db.get(STORE_NAME, "orders");
    const products = await db.get(STORE_NAME, "products");
    const uploadDate = await db.get(STORE_NAME, "uploadDate");
    if (!stock && !orders && !products) return null;
    return {
      stock: stock || [],
      orders: orders || [],
      products: products || [],
      uploadDate: uploadDate || "",
    };
  } catch (err) {
    console.warn("Failed to load data from IndexedDB:", err);
    // Try fallback to localStorage (old data)
    return loadDataFromLocalStorage();
  }
}

export async function clearData(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const db = await getDB();
    await db.clear(STORE_NAME);
  } catch {
    // ignore
  }
  // Also clear old localStorage data
  localStorage.removeItem("wb-shipment-data");
}

// --- Migrate from localStorage (one-time) ---

function loadDataFromLocalStorage(): AppData | null {
  try {
    const raw = localStorage.getItem("wb-shipment-data");
    if (!raw) return null;
    const data = JSON.parse(raw) as AppData;
    // Migrate to IndexedDB
    saveData(data).then(() => {
      localStorage.removeItem("wb-shipment-data");
    });
    return data;
  } catch {
    return null;
  }
}

// --- Settings (small, stays in localStorage) ---

export function saveSettings(settings: AppSettings): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadSettings(): AppSettings {
  if (typeof window === "undefined") {
    return { buyoutRate: 0.75, regions: getDefaultRegions() };
  }
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // fallback
  }
  return { buyoutRate: 0.75, regions: getDefaultRegions() };
}
