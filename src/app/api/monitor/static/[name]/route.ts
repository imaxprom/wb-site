import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireSystemAdmin } from "@/lib/api-auth";

const ALLOWED_FILES = new Set(["changes", "repair-log"]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const authError = await requireSystemAdmin(request);
  if (authError) return authError;
  const { name } = await params;
  if (!ALLOWED_FILES.has(name)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const filePath = path.join(process.cwd(), "public", "data", "monitor", `${name}.json`);
  if (!fs.existsSync(filePath)) return NextResponse.json(name === "changes" ? [] : { entries: [] });
  return NextResponse.json(JSON.parse(fs.readFileSync(filePath, "utf8")));
}
