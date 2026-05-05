import { NextRequest, NextResponse } from "next/server";
import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
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

    // Security: only allow paths from registry
    let output: string;
    if (errorsOnly) {
      output = execSync(`grep -iE "ERROR|CRITICAL|Exception|WARNING" "${logPath}" | tail -n ${lines}`, {
        timeout: 5_000,
        encoding: "utf-8",
      }).trim();
    } else {
      output = execSync(`tail -n ${lines} "${logPath}"`, {
        timeout: 5_000,
        encoding: "utf-8",
      }).trim();
    }

    return NextResponse.json({
      id,
      name: service.name,
      lines: output ? output.split("\n") : [],
    });
  } catch (e: unknown) {
    // grep returns exit code 1 when no matches
    if (e instanceof Error && "status" in e && (e as { status: number }).status === 1) {
      return NextResponse.json({ id, name: id, lines: [] });
    }
    return NextResponse.json({ error: "Failed to read logs" }, { status: 500 });
  }
}
