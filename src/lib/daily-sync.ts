/**
 * Daily auto-sync orchestrator.
 * Вызывает независимые sync-модули, каждый в своём try/catch.
 * Ошибка в одном модуле не блокирует остальные.
 */
import { type SyncStatus, type DaySyncStatus, emptySource, loadStatus, saveStatus, yesterday } from "./sync/types";
import { syncReport } from "./sync/realization";
import { syncAdvertising } from "./sync/advertising";
import { syncOrders } from "./sync/orders";
import { syncPaidStorage } from "./sync/storage";

export type { SyncStatus, DaySyncStatus };

const CRON_START_HOUR = 6;
const CRON_END_HOUR = 23;

export function getSyncStatus(): SyncStatus {
  return loadStatus();
}

export async function syncAll(date?: string): Promise<DaySyncStatus> {
  const targetDate = date || yesterday();
  const status = loadStatus();

  let day = status.today;
  if (!day || day.date !== targetDate) {
    day = {
      date: targetDate,
      report: emptySource(),
      advertising: emptySource(),
      orders: emptySource(),
      storage: emptySource(),
      complete: false,
    };
  }

  status.running = true;
  status.lastRun = new Date().toISOString();
  saveStatus(status);

  console.log(`[daily-sync] Syncing ${targetDate}...`);

  // Каждый источник в отдельном try/catch — ошибка одного не блокирует остальные
  if (!day.report.ok) {
    try {
      console.log("[daily-sync] Syncing report...");
      day.report = await syncReport(targetDate);
      console.log(`[daily-sync] Report: ${day.report.ok ? "OK (" + day.report.value + " rows)" : "FAIL: " + day.report.error}`);
    } catch (err) {
      day.report.error = `CRASH: ${err instanceof Error ? err.message : String(err)}`;
      console.error("[daily-sync] Report CRASHED:", err);
    }
  }

  if (!day.advertising.ok || !day.advertising.stable) {
    try {
      console.log("[daily-sync] Syncing advertising...");
      day.advertising = await syncAdvertising(targetDate, day.advertising.value);
      console.log(`[daily-sync] Advertising: ${day.advertising.ok ? "OK (" + day.advertising.value + " руб" + (day.advertising.stable ? ", stable" : ", pending stable") + ")" : "FAIL: " + day.advertising.error}`);
    } catch (err) {
      day.advertising.error = `CRASH: ${err instanceof Error ? err.message : String(err)}`;
      console.error("[daily-sync] Advertising CRASHED:", err);
    }
  }

  if (!day.orders.ok || !day.orders.stable) {
    try {
      console.log("[daily-sync] Syncing orders...");
      day.orders = await syncOrders(targetDate, day.orders.value);
      console.log(`[daily-sync] Orders: ${day.orders.ok ? day.orders.value + " руб" + (day.orders.stable ? " (stable)" : " (updating)") : "FAIL: " + day.orders.error}`);
    } catch (err) {
      day.orders.error = `CRASH: ${err instanceof Error ? err.message : String(err)}`;
      console.error("[daily-sync] Orders CRASHED:", err);
    }
  }

  if (!day.storage?.ok) {
    try {
      console.log("[daily-sync] Syncing paid storage...");
      day.storage = await syncPaidStorage(targetDate);
      console.log(`[daily-sync] Storage: ${day.storage.ok ? "OK (" + day.storage.value + " руб)" : "FAIL: " + (day.storage.error || "unknown")}`);
    } catch (err) {
      day.storage.error = `CRASH: ${err instanceof Error ? err.message : String(err)}`;
      console.error("[daily-sync] Storage CRASHED:", err);
    }
  }

  day.complete = day.report.ok && day.advertising.ok && day.advertising.stable && day.orders.ok && day.orders.stable;

  status.today = day;
  status.running = false;

  const existingIdx = status.history.findIndex(h => h.date === targetDate);
  if (existingIdx >= 0) {
    status.history[existingIdx] = day;
  } else {
    status.history.unshift(day);
    if (status.history.length > 30) status.history = status.history.slice(0, 30);
  }

  saveStatus(status);
  return day;
}

export async function syncDailyReport(date: string) {
  const day = await syncAll(date);
  return {
    date: day.date,
    timestamp: new Date().toISOString(),
    rows: day.report.value,
    ok: day.report.ok,
    error: day.report.error,
  };
}

export async function syncYesterday() {
  return syncDailyReport(yesterday());
}

// --- Cron ---

let cronTimer: ReturnType<typeof setInterval> | null = null;

export function startDailyCron(): void {
  if (cronTimer) return;

  async function tick() {
    const hour = new Date().getHours();
    if (hour < CRON_START_HOUR || hour > CRON_END_HOUR) return;

    const status = loadStatus();
    const targetDate = yesterday();

    if (status.today?.date === targetDate && status.today.complete) {
      console.log(`[daily-sync] ${targetDate} already complete, skipping`);
      return;
    }

    await syncAll(targetDate);
  }

  const now = new Date();
  const msToNextHour = (60 - now.getMinutes()) * 60000 - now.getSeconds() * 1000;

  setTimeout(() => {
    tick();
    cronTimer = setInterval(tick, 3600000);
  }, msToNextHour);

  const nextRun = new Date(Date.now() + msToNextHour).toISOString();
  const status = loadStatus();
  status.nextRun = nextRun;
  saveStatus(status);

  console.log(`[daily-sync] Cron started. Next run at ${nextRun} (every hour ${CRON_START_HOUR}:00–${CRON_END_HOUR}:00)`);
}

export function stopDailyCron(): void {
  if (cronTimer) { clearInterval(cronTimer); cronTimer = null; }
}
