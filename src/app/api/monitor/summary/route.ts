import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import { activateMonitorOrganizationContext, requireMonitorAdmin } from "@/lib/monitor-auth";
import { isPostgresReadonlyConnection } from "@/lib/postgres";
import { getMonitorSummaryPath, getWatchdogLogPath, sanitizeMonitorLogLine } from "@/lib/monitor-paths";

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

function lastWatchdogCycleAlerts(logPath: string): string[] {
  try {
    if (!fs.existsSync(logPath)) return [];
    const lines = fs.readFileSync(logPath, "utf-8").split("\n").filter(Boolean);
    const startIndex = lines.findLastIndex((line) => line.includes("=== VPS Watchdog started ==="));
    const cycle = startIndex >= 0 ? lines.slice(startIndex) : lines.slice(-100);
    return cycle.filter((line) => /Telegram \[\w+\] sent/.test(line)).map(sanitizeMonitorLogLine);
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  const authError = await requireMonitorAdmin(req);
  if (authError) return authError;
  activateMonitorOrganizationContext(req);

  if (isPostgresReadonlyConnection()) {
    return NextResponse.json({
      overall: "warn",
      mode: "local_postgres_readonly",
      message: "Runtime monitoring is disabled in local PostgreSQL readonly mode. Localhost reads production business data only.",
      sync: {
        lastRun: null,
        lastRunHoursAgo: null,
        today: null,
        dataLagDays: null,
      },
      auth: {
        api: null,
        lk: null,
        apiReason: null,
        lkReason: null,
        checkedAt: null,
      },
      alertsRecent: [],
    });
  }

  const sync = readJson<SyncStatus>(getMonitorSummaryPath("daily-sync-status.json"));
  const auth = readJson<AuthStatus>(getMonitorSummaryPath("auth-status.json"));

  const today = sync?.today || null;
  const lastSyncIso = sync?.lastRun || null;
  const lastAlerts = lastWatchdogCycleAlerts(getWatchdogLogPath());

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
