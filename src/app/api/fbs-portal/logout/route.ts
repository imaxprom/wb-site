import { NextRequest, NextResponse } from "next/server";
import { FBS_PORTAL_COOKIE_NAME } from "@/lib/fbs-portal-auth";
import { isFbsPortalHostname } from "@/lib/fbs-portal-host";
import { ORGANIZATION_COOKIE_NAME } from "@/lib/organization-cookie";

export async function POST(request: NextRequest) {
  if (!isFbsPortalHostname(request.headers.get("host"))) return new NextResponse("Not found", { status: 404 });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(FBS_PORTAL_COOKIE_NAME, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  response.cookies.set(ORGANIZATION_COOKIE_NAME, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  return response;
}
