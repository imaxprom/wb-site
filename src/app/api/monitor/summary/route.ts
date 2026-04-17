import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

/**
 * GET /api/monitor/summary — сводный статус всех sync-систем.
 * Читает state-файлы и возвращает один компактный JSON для UI-виджета.
 */

interface DaySyncRow {
  date?: string;
  report?: { ok?: boolean; value?: number };
  advertising?: { ok?: boolean; value?: number; stable?: boolean };
  orders?: { ok?: boolean; value?: number; stable?: boolean };
  complete?: boolean;
}

interface SyncStatus {
  lastRun?: string | null;
  today?: DaySyncRow | null;
  history?: DaySyncRow[];
}

interface AuthStatus {
  api?: "ok" | "dead" | null;
  lk?: "ok" | "dead" | null;
  apiReason?: string | null;
  lkReason?: string | null;
  checkedAt?: string | null;
}

function readJson<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

function hoursAgo(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (!isFinite(ms) || ms < 0) return null;
  return Math.round(ms / 36e5 * 10) / 10;
}

function tailLog(logPath: string, lines: number, grepRegex?: RegExp): string[] {
  try {
    if (!fs.existsSync(logPath)) return [];
    const content = fs.readFileSync(logPath, "utf-8");
    const arr = content.split("\n").filter(l => l.trim());
    const filtered = grepRegex ? arr.filter(l => grepRegex.test(l)) : arr;
    return filtered.slice(-lines);
  } catch {
    return [];
  }
}

export async function GET() {
  const dataDir = path.join(process.cwd(), "data");
  const monitorDir = path.join(process.cwd(), "public", "data", "monitor");

  const sync = readJson<SyncStatus>(path.join(dataDir, "daily-sync-status.json"));
  const auth = readJson<AuthStatus>(path.join(monitorDir, "auth-status.json"));

  const today = sync?.today || null;
  const lastSyncIso = sync?.lastRun || null;
  const lastAlerts = tailLog(path.join(dataDir, "watchdog.log"), 5, /Telegram \[\w+\] sent/);

  // Data freshness: насколько свежая "вчерашняя" дата в БД
  let dataLagDays: number | null = null;
  if (today?.date) {
    const todayMsk = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 10);
    const daysDiff = Math.round(
      (new Date(todayMsk).getTime() - new Date(today.date).getTime()) / 86400000
    );
    dataLagDays = daysDiff;
  }

  // Общий статус:
  // - crit: один из auth-каналов явно "dead"
  // - warn: вчерашний sync ещё не complete
  // - ok: всё зелёное
  const syncComplete = !!today?.complete;
  const authHasDead = auth?.api === "dead" || auth?.lk === "dead";
  const overall: "ok" | "warn" | "crit" =
    authHasDead ? "crit"
    : !syncComplete ? "warn"
    : "ok";

  return NextResponse.json({
    overall,
    sync: {
      lastRun: lastSyncIso,
      lastRunHoursAgo: hoursAgo(lastSyncIso),
      today: today ? {
        date: today.date,
        complete: today.complete,
        reportValue: today.report?.value || 0,
        advertisingValue: today.advertising?.value || 0,
        ordersValue: today.orders?.value || 0,
      } : null,
      dataLagDays,
    },
    auth: {
      api: auth?.api || null,
      lk: auth?.lk || null,
      apiReason: auth?.apiReason || null,
      lkReason: auth?.lkReason || null,
      checkedAt: auth?.checkedAt || null,
    },
    alertsRecent: lastAlerts,
  });
}
