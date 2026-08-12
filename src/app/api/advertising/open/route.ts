import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedRequestContext } from "@/lib/api-auth";

export const dynamic = "force-dynamic";

type AdvertisingTicketPayload = {
  version: 1;
  purpose: "wb-ads-handoff";
  organizationId: number;
  userId: number;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
};

function getSsoSecret(): string {
  const secret = process.env.ADS_SSO_SECRET || "";
  if (secret.length < 32) throw new Error("ADS_SSO_SECRET must contain at least 32 characters");
  return secret;
}

function isAdvertisingOrganizationEnabled(organizationId: number): boolean {
  const configured = String(process.env.ADS_ENABLED_ORGANIZATION_IDS || "1,2")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isSafeInteger(value) && value > 0);
  return configured.includes(organizationId);
}

function createTicket(payload: AdvertisingTicketPayload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", getSsoSecret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export async function GET(request: NextRequest) {
  const context = await getAuthenticatedRequestContext(request);
  if (!context) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (!isAdvertisingOrganizationEnabled(context.organizationId)) {
    return NextResponse.json(
      { error: "Рекламный кабинет для выбранного юрлица ещё не подключён" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  const now = Math.floor(Date.now() / 1000);
  const ticket = createTicket({
    version: 1,
    purpose: "wb-ads-handoff",
    organizationId: context.organizationId,
    userId: context.userId,
    issuedAt: now,
    expiresAt: now + 60,
    nonce: crypto.randomBytes(16).toString("base64url"),
  });
  const advertisingBaseUrl = process.env.ADS_BASE_URL || "https://ads.imaxprom.site";
  const target = new URL("/api/hub-session", advertisingBaseUrl);
  target.searchParams.set("ticket", ticket);
  return NextResponse.redirect(target, {
    headers: { "Cache-Control": "no-store" },
  });
}
