import path from "node:path";
import { DATA_ROOT, getOrganizationDataPath } from "@/lib/organization-paths";

const GLOBAL_LOG_SERVICE_IDS = new Set(["mphub-website", "mphub-watchdog"]);

export function getMonitorStatusPath(): string {
  return getOrganizationDataPath("monitor-status.json");
}

export function getMonitorSummaryPath(fileName: string): string {
  return getOrganizationDataPath(fileName);
}

export function getWatchdogLogPath(): string {
  return path.join(DATA_ROOT, "watchdog.log");
}

export function resolveMonitorLogPath(service: { id: string; logPath?: string | null }): string | null {
  if (!service.logPath) return null;
  if (GLOBAL_LOG_SERVICE_IDS.has(service.id)) return service.logPath;

  const fileName = path.basename(service.logPath);
  if (!fileName || fileName === "." || fileName === path.sep) return null;
  return getOrganizationDataPath(fileName);
}

export function sanitizeMonitorLogLine(line: string): string {
  return line
    .replace(/https:\/\/api\.telegram\.org\/bot[^/\s]+/gi, "https://api.telegram.org/bot[redacted]")
    .replace(/\bBearer\s+[^\s,}\]]+/gi, "Bearer [redacted]")
    .replace(/((?:token|cookie|authorization|api[_ -]?key|secret)\s*[=:]\s*["']?)[^\s,"'}\]]+/gi, "$1[redacted]");
}
