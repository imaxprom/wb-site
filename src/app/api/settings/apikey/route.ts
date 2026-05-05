import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/api-utils";
import { requireAdmin } from "@/lib/api-auth";
import { getWbApiKey, setWbApiKey, deleteWbApiKey } from "@/lib/wb-api-key";

/** GET — check if API key exists, return masked version */
export async function GET(req: NextRequest) {
  const authError = requireAdmin(req);
  if (authError) return authError;

  try {
    const key = getWbApiKey();
    if (key) {
      const masked = key.length > 12 ? "••••••••••••" + key.slice(-8) : "••••••••";
      return NextResponse.json({ hasKey: true, masked });
    }
    return NextResponse.json({ hasKey: false, masked: "" });
  } catch {
    return NextResponse.json({ hasKey: false, masked: "" });
  }
}

/** PUT — save API key */
export async function PUT(req: NextRequest) {
  const authError = requireAdmin(req);
  if (authError) return authError;

  try {
    const { key } = (await req.json()) as { key?: string };
    if (!key?.trim()) {
      return NextResponse.json({ error: "Ключ не может быть пустым" }, { status: 400 });
    }
    setWbApiKey(key);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}

/** DELETE — remove API key */
export async function DELETE(req: NextRequest) {
  const authError = requireAdmin(req);
  if (authError) return authError;

  try {
    deleteWbApiKey();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
