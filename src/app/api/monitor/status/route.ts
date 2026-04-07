import { NextResponse } from "next/server";
import { execSync } from "child_process";
import { readFileSync, statSync } from "fs";
import { join } from "path";

const STATUS_PATH = join(process.cwd(), "public/data/monitor/status.json");
const COLLECTOR_PATH = join(process.cwd(), "scripts/health-collector.py");
const MAX_AGE_MS = 30_000; // 30 seconds

export async function GET() {
  try {
    // Check if status.json is fresh enough
    let needsRefresh = true;
    try {
      const stat = statSync(STATUS_PATH);
      const age = Date.now() - stat.mtimeMs;
      if (age < MAX_AGE_MS) {
        needsRefresh = false;
      }
    } catch {
      // File doesn't exist, need to collect
    }

    if (needsRefresh) {
      try {
        execSync(`python3 "${COLLECTOR_PATH}"`, {
          timeout: 30_000,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (e: unknown) {
        const stderr = e instanceof Error && "stderr" in e ? String((e as { stderr: unknown }).stderr) : "";
        console.error("health-collector failed:", stderr);
        // Try to return stale data if available
      }
    }

    const data = readFileSync(STATUS_PATH, "utf-8");
    return NextResponse.json(JSON.parse(data));
  } catch {
    return NextResponse.json(
      { error: "Failed to load status", timestamp: new Date().toISOString(), machine: "MacBook Air", services: [] },
      { status: 500 }
    );
  }
}
