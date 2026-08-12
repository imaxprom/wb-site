import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { requireSystemAdmin } from "@/lib/api-auth";

export async function GET(request: NextRequest) {
  const authError = await requireSystemAdmin(request);
  if (authError) return authError;
  const filePath = path.join(process.cwd(), "public", "data", "changelog.json");
  return NextResponse.json(JSON.parse(fs.readFileSync(filePath, "utf8")));
}
