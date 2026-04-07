import { NextRequest, NextResponse } from "next/server";
import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { join } from "path";

const REGISTRY_PATH = join(process.cwd(), "public/data/monitor/monitor-registry.json");
const CHANGES_PATH = join(process.cwd(), "public/data/monitor/changes.json");

const VALID_ACTIONS = ["archive", "delete", "unarchive", "stop", "restart"];

interface RegistryEntry {
  id: string;
  plistLabel?: string;
  lifecycle?: string;
  [key: string]: unknown;
}

function getUid(): string {
  return execSync("id -u", { encoding: "utf-8" }).trim();
}

function stopService(label: string): string {
  try {
    const uid = getUid();
    execSync(`launchctl bootout gui/${uid}/${label} 2>/dev/null || launchctl stop ${label}`, {
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return `Сервис ${label} остановлен`;
  } catch {
    return `Не удалось остановить ${label}`;
  }
}

function startService(label: string): string {
  try {
    const uid = getUid();
    execSync(`launchctl kickstart gui/${uid}/${label} 2>/dev/null || launchctl start ${label}`, {
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return `Сервис ${label} запущен`;
  } catch {
    return `Не удалось запустить ${label}`;
  }
}

export async function POST(req: NextRequest) {
  try {
    const { id, action } = await req.json();

    if (!id || !VALID_ACTIONS.includes(action)) {
      return NextResponse.json({ error: "Invalid id or action" }, { status: 400 });
    }

    const registry: RegistryEntry[] = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));
    const idx = registry.findIndex((s) => s.id === id);

    if (idx === -1) {
      return NextResponse.json({ error: "Service not found" }, { status: 404 });
    }

    const svc = registry[idx];
    const label = svc.plistLabel;
    const now = new Date().toISOString();
    let changeType = "";
    let message = "";

    switch (action) {
      case "stop":
        if (!label) return NextResponse.json({ error: "Нет plist — нечего останавливать" }, { status: 400 });
        message = stopService(label);
        changeType = "stopped";
        break;
      case "restart":
        if (!label) return NextResponse.json({ error: "Нет plist — нечего перезапускать" }, { status: 400 });
        stopService(label);
        // Wait a bit for clean shutdown
        await new Promise((r) => setTimeout(r, 1000));
        message = startService(label);
        changeType = "restarted";
        break;
      case "archive":
        registry[idx].lifecycle = "archived";
        changeType = "archived";
        message = "Архивирован";
        break;
      case "delete":
        changeType = "deleted";
        message = "Удалён из реестра";
        registry.splice(idx, 1);
        break;
      case "unarchive":
        registry[idx].lifecycle = "active";
        changeType = "unarchived";
        message = "Восстановлен из архива";
        break;
    }

    writeFileSync(REGISTRY_PATH, JSON.stringify(registry, null, 2));

    // Append to changes.json
    let changes: { time: string; scriptId: string; type: string; details?: string }[] = [];
    try {
      changes = JSON.parse(readFileSync(CHANGES_PATH, "utf-8"));
    } catch {
      // empty
    }
    changes.unshift({ time: now, scriptId: id, type: changeType, details: message });
    changes = changes.slice(0, 200);
    writeFileSync(CHANGES_PATH, JSON.stringify(changes, null, 2));

    return NextResponse.json({ ok: true, action, id, message });
  } catch {
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}
