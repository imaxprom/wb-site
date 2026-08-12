import fs from "fs";
import { getWbApiKey } from "../wb-api-key";
import { getOrganizationDataDir, getOrganizationDataPath } from "../organization-paths";

export function getSyncStatusPath(): string {
  return getOrganizationDataPath("daily-sync-status.json");
}

export function getSyncTokensPath(): string {
  return getOrganizationDataPath("wb-tokens.json");
}

export interface SourceStatus {
  ok: boolean;
  value: number;
  stable: boolean;
  prevValue: number;
  lastAttempt: string;
  error?: string;
}

export interface DaySyncStatus {
  date: string;
  report: SourceStatus;
  advertising: SourceStatus;
  orders: SourceStatus;
  storage: SourceStatus;
  complete: boolean;
}

export interface OrdersRefreshStatus {
  ok: boolean;
  lastAttempt: string;
  checked: number;
  updated: number;
  windowDays: number;
  error?: string;
}

export interface SyncStatus {
  today: DaySyncStatus | null;
  lastRun: string | null;
  nextRun: string | null;
  running: boolean;
  history: DaySyncStatus[];
  ordersRefresh?: OrdersRefreshStatus | null;
}

export function emptySource(): SourceStatus {
  return { ok: false, value: 0, stable: false, prevValue: 0, lastAttempt: "", error: undefined };
}

export function getApiKey(): string {
  return getWbApiKey() || "";
}

export function dateInMoscow(date: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function hourInMoscow(date: Date = new Date()): number {
  const value = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    hour12: false,
  }).format(date);
  return Number(value);
}

export function shiftIsoDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().slice(0, 10);
}

// --- State persistence с 4 слоями защиты (см. scripts/daily-sync.js) ---

function validateStatus(s: unknown): s is SyncStatus {
  if (!s || typeof s !== "object") return false;
  const obj = s as Record<string, unknown>;
  if (!Array.isArray(obj.history)) return false;
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const todayIso = dateInMoscow();
  if (obj.today) {
    if (typeof obj.today !== "object") return false;
    const d = (obj.today as Record<string, unknown>).date;
    if (typeof d !== "string" || !dateRe.test(d)) return false;
    if (d > todayIso) return false;
  }
  for (const h of obj.history as { date?: unknown }[]) {
    if (!h || typeof h.date !== "string" || !dateRe.test(h.date)) return false;
  }
  return true;
}

export function loadStatus(): SyncStatus {
  const emptyStatus: SyncStatus = { today: null, lastRun: null, nextRun: null, running: false, history: [] };
  const statusPath = getSyncStatusPath();

  if (fs.existsSync(statusPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(statusPath, "utf-8"));
      if (validateStatus(parsed)) return parsed;
    } catch { /* try backup */ }
  }

  const bakPath = statusPath + ".bak";
  if (fs.existsSync(bakPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(bakPath, "utf-8"));
      if (validateStatus(parsed)) {
        console.log("[sync/types] state восстановлен из .bak");
        return parsed;
      }
    } catch { /* fall through */ }
  }

  console.log("[sync/types] state файлы потеряны — использую пустое состояние (cron daily-sync восстановит из БД)");
  return emptyStatus;
}

export function saveStatus(status: SyncStatus): void {
  const statusPath = getSyncStatusPath();
  const dir = getOrganizationDataDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Слой 1: бэкап
  if (fs.existsSync(statusPath)) {
    try { fs.copyFileSync(statusPath, statusPath + ".bak"); } catch { /* не критично */ }
  }
  // Слой 2: атомарная запись
  const tmpPath = statusPath + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(status, null, 2));
  fs.renameSync(tmpPath, statusPath);
}

export function yesterday(): string {
  return shiftIsoDate(dateInMoscow(), -1);
}
