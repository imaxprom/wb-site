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

export function loadStatus(): SyncStatus {
  try {
    if (fs.existsSync(STATUS_PATH)) {
      return JSON.parse(fs.readFileSync(STATUS_PATH, "utf-8"));
    }
  } catch { /* ignore */ }
  return { today: null, lastRun: null, nextRun: null, running: false, history: [] };
}

export function saveStatus(status: SyncStatus): void {
  const dir = path.dirname(STATUS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(STATUS_PATH, JSON.stringify(status, null, 2));
}

export function yesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}
