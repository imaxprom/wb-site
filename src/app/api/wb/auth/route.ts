import { NextRequest, NextResponse } from "next/server";
import { activateAuthenticatedRequestContext, requireAdmin, requireOrganizationAdmin } from "@/lib/api-auth";
import { playwrightSendPhone, playwrightCheckSession, playwrightLogout } from "@/lib/wb-auth-playwright";
import fs from "fs";
import { localReadonlyGuard } from "@/lib/local-readonly-guard";
import { getWbAuthPaths } from "@/lib/wb-auth-paths";

/**
 * POST /api/wb/auth — Start auth: send phone number (Playwright on VPS)
 * GET /api/wb/auth — Check if session is active + return session info
 * DELETE /api/wb/auth — Logout
 */

export async function POST(req: NextRequest) {
  const authError = await requireOrganizationAdmin(req);
  if (authError) return authError;
  activateAuthenticatedRequestContext(req);
  const readonlyError = localReadonlyGuard("WB cabinet auth");
  if (readonlyError) return readonlyError;

  try {
    const { phone } = await req.json();
    if (!phone) {
      return NextResponse.json({ ok: false, step: "error", error: "Укажите номер телефона" }, { status: 400 });
    }
    const result = await playwrightSendPhone(phone);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ ok: false, step: "error", error: String(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const authError = await requireAdmin(req);
  if (authError) return authError;
  activateAuthenticatedRequestContext(req);
  const readonlyError = localReadonlyGuard("WB cabinet auth status");
  if (readonlyError) return readonlyError;

  try {
    const result = await playwrightCheckSession();

    // Enrich with session info from tokens
    if (result.ok) {
      const paths = getWbAuthPaths();
      let supplier = "";
      let phone = "";
      let storeName = "";
      let inn = "";
      let supplierId = "";
      try {
        if (fs.existsSync(paths.tokensPath)) {
          const tokens = JSON.parse(fs.readFileSync(paths.tokensPath, "utf-8"));
          supplier = String(tokens.supplierName || "").trim();
          storeName = String(tokens.storeName || "").trim();
          inn = String(tokens.inn || "").replace(/\D/g, "");
          supplierId = String(tokens.supplierId || "").trim();
          const savedPhone = String(tokens.phone || "").replace(/\D/g, "");
          if (savedPhone.length >= 10) {
            const d = savedPhone.slice(-10);
            phone = `+7 (${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6,8)}-${d.slice(8,10)}`;
          }

          // Get supplier name from wbSellerLk JWT
          if (!supplier && tokens.wbSellerLk) {
            try {
              const payload = JSON.parse(Buffer.from(tokens.wbSellerLk.split(".")[1], "base64").toString());
              const sd = payload.data || {};
              const sfid = sd["Z-Sfid"] || sd["Z-Soid"] || "";
              supplier = sfid ? `ИП (ID: ${sfid})` : "";
            } catch {}
          }

          // Try reading supplier name from last auth log
          try {
            const log = fs.readFileSync(paths.authLogPath, "utf-8");
            const match = log.match(/supplier":\s*"([^"]+)"/);
            if (match && !supplier) supplier = match[1];
          } catch {}

          // Get phone from saved tokens
          if (!phone && tokens.savedAt) {
            try {
              const log = fs.readFileSync(paths.authLogPath, "utf-8");
              const match = log.match(/phone":\s*"(\d+)"/);
              if (match) {
                const d = match[1];
                phone = `+7 (${d.slice(0,3)}) ${d.slice(3,6)}-${d.slice(6,8)}-${d.slice(8,10)}`;
              }
            } catch {}
          }

          if (!supplier && supplierId) {
            supplier = `Кабинет ${supplierId}`;
          }
        }
      } catch {}

      return NextResponse.json({ ...result, supplier, phone, storeName, inn, supplierId });
    }

    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const authError = await requireOrganizationAdmin(req);
  if (authError) return authError;
  activateAuthenticatedRequestContext(req);
  const readonlyError = localReadonlyGuard("WB cabinet logout");
  if (readonlyError) return readonlyError;

  try {
    playwrightLogout();
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
