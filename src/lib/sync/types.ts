import fs from "fs";
import path from "path";
import { getWbApiKey } from "../wb-api-key";

export const STATUS_PATH = path.join(process.cwd(), "data", "daily-sync-status.json");
export const DB_PATH = path.join(process.cwd(), "data", "finance.db");
export const TOKENS_PATH = path.join(process.cwd(), "data", "wb-tokens.json");

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

export interface SyncStatus {
  today: DaySyncStatus | null;
  lastRun: string | null;
  nextRun: string | null;
  running: boolean;
  history: DaySyncStatus[];
}

export function emptySource(): SourceStatus {
  return { ok: false, value: 0, stable: false, prevValue: 0, lastAttempt: "", error: undefined };
}

export function getApiKey(): string {
  return getWbApiKey() || "";
}

// --- State persistence с 4 слоями защиты (см. scripts/daily-sync.js) ---

function validateStatus(s: unknown): s is SyncStatus {
  if (!s || typeof s !== "object") return false;
  const obj = s as Record<string, unknown>;
  if (!Array.isArray(obj.history)) return false;
  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  const todayIso = new Date().toISOString().slice(0, 10);
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

  if (fs.existsSync(STATUS_PATH)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(STATUS_PATH, "utf-8"));
      if (validateStatus(parsed)) return parsed;
    } catch { /* try backup */ }
  }

  const bakPath = STATUS_PATH + ".bak";
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
  const dir = path.dirname(STATUS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  // Слой 1: бэкап
  if (fs.existsSync(STATUS_PATH)) {
    try { fs.copyFileSync(STATUS_PATH, STATUS_PATH + ".bak"); } catch { /* не критично */ }
  }
  // Слой 2: атомарная запись
  const tmpPath = STATUS_PATH + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(status, null, 2));
  fs.renameSync(tmpPath, STATUS_PATH);
}

export function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}
