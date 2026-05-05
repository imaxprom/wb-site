import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { requireMonitorAdmin } from "@/lib/monitor-auth";

const REGISTRY_PATH = join(process.cwd(), "public/data/monitor/monitor-registry.json");

export async function GET(req: NextRequest) {
  const authError = requireMonitorAdmin(req);
  if (authError) return authError;

  const { searchParams } = req.nextUrl;
  const id = searchParams.get("id");
  const lines = Math.min(parseInt(searchParams.get("lines") || "50", 10), 500);
  const errorsOnly = searchParams.get("errors") === "1";

  if (!id) {
    return NextResponse.json({ error: "Missing id parameter" }, { status: 400 });
  }

  try {
    const registry = JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));
    const service = registry.find((s: { id: string }) => s.id === id);

    if (!service) {
      return NextResponse.json({ error: "Service not found" }, { status: 404 });
    }

    const logPath = service.logPath;
    if (!logPath || !existsSync(logPath)) {
      return NextResponse.json({ error: "Log file not available", lines: [] });
    }

    const raw = readFileSync(logPath, "utf-8");
    const sourceLines = raw.split(/\r?\n/).filter(Boolean);
    const filtered = errorsOnly
      ? sourceLines.filter((line) => /ERROR|CRITICAL|Exception|WARNING/i.test(line))
      : sourceLines;
    const outputLines = filtered.slice(-lines);

    return NextResponse.json({
      id,
      name: service.name,
      lines: outputLines,
    });
  } catch (e: unknown) {
    return NextResponse.json({ error: "Failed to read logs" }, { status: 500 });
  }
}
