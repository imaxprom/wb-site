import { NextRequest, NextResponse } from "next/server";
import { execSync, spawn } from "child_process";
import { readFileSync } from "fs";
import { join } from "path";

const REGISTRY_PATH = join(process.cwd(), "public/data/monitor/monitor-registry.json");

interface RegistryEntry {
  id: string;
  plistLabel?: string;
  scriptPath?: string | null;
  type?: string;
  [key: string]: unknown;
}

export async function POST(req: NextRequest) {
  try {
    const { id } = await req.json();

    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    // Find service in registry (security: only registered scripts)
    const registry: RegistryEntry[] = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));
    const svc = registry.find((s) => s.id === id);

    if (!svc) {
      return NextResponse.json({ error: "Service not found in registry" }, { status: 404 });
    }

    const label = svc.plistLabel;
    const scriptPath = svc.scriptPath;
    const svcType = svc.type || "unknown";

    // Strategy 1: launchctl kickstart (for launchd-managed services)
    if (label) {
      try {
        const uid = execSync("id -u", { encoding: "utf-8" }).trim();
        execSync(`launchctl kickstart gui/${uid}/${label}`, {
          timeout: 10_000,
          stdio: ["pipe", "pipe", "pipe"],
        });
        return NextResponse.json({
          ok: true,
          method: "launchctl",
          message: `Сервис ${label} запущен через launchctl`,
        });
      } catch (e: unknown) {
        // kickstart may fail if already running — try direct execution
        const stderr = e instanceof Error && "stderr" in e ? String((e as { stderr: unknown }).stderr) : "";
        
        // If already running, that's fine
        if (stderr.includes("already running") || stderr.includes("Operation already in progress")) {
          return NextResponse.json({
            ok: true,
            method: "launchctl",
            message: `Сервис уже запущен`,
          });
        }

        // Fall through to direct execution
      }
    }

    // Strategy 2: direct script execution (detached, fire-and-forget)
    if (scriptPath) {
      let cmd: string;
      let args: string[];

      switch (svcType) {
        case "python":
          // Try to find venv python first
          const venvPython = scriptPath.replace(/\/[^/]+\.py$/, "/venv/bin/python");
          cmd = venvPython;
          args = [scriptPath];
          // Fallback to system python if venv doesn't exist
          try {
            execSync(`test -f "${venvPython}"`, { timeout: 2000 });
          } catch {
            cmd = "python3";
          }
          break;
        case "node":
          cmd = "node";
          args = [scriptPath];
          break;
        case "bash":
          cmd = "bash";
          args = [scriptPath];
          break;
        default:
          return NextResponse.json({
            error: `Неизвестный тип скрипта: ${svcType}`,
          }, { status: 400 });
      }

      // Spawn detached — don't wait for completion
      const child = spawn(cmd, args, {
        detached: true,
        stdio: "ignore",
        cwd: scriptPath.replace(/\/[^/]+$/, ""),
      });
      child.unref();

      return NextResponse.json({
        ok: true,
        method: "direct",
        pid: child.pid,
        message: `Скрипт ${scriptPath.split("/").pop()} запущен (PID: ${child.pid})`,
      });
    }

    return NextResponse.json({
      error: "Нет plist и нет scriptPath — нечего запускать",
    }, { status: 400 });
  } catch (e) {
    return NextResponse.json({
      error: `Ошибка запуска: ${e instanceof Error ? e.message : String(e)}`,
    }, { status: 500 });
  }
}
