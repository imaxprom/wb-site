import { NextRequest, NextResponse } from "next/server";

const IS_PRODUCTION_RUNTIME = process.env.NODE_ENV === "production";
const JWT_SECRET = process.env.JWT_SECRET || (IS_PRODUCTION_RUNTIME ? "" : "mphub-dev-secret-2026");
const FBS_PORTAL_JWT_SECRET = process.env.FBS_PORTAL_JWT_SECRET || (IS_PRODUCTION_RUNTIME ? "" : "fbs-portal-dev-secret-2026");
const FBS_PORTAL_HOST = process.env.FBS_PORTAL_HOST || "fbs.imaxprom.site";

function encodeBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64url(value: string): string {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return atob(padded);
}

function safeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) {
    diff |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return diff === 0;
}

async function isValidSessionToken(token: string | undefined): Promise<boolean> {
  if (!token || !JWT_SECRET) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;

  try {
    const [header, body, signature] = parts;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(JWT_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signed = await crypto.subtle.sign(
      "HMAC",
      key,
      new TextEncoder().encode(`${header}.${body}`)
    );
    const expected = encodeBase64url(new Uint8Array(signed));
    if (!safeEqual(signature, expected)) return false;

    const payload = JSON.parse(decodeBase64url(body)) as { exp?: number };
    return typeof payload.exp === "number" && payload.exp >= Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

async function isValidFbsPortalToken(token: string | undefined): Promise<boolean> {
  if (!token || !FBS_PORTAL_JWT_SECRET) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  try {
    const [header, body, signature] = parts;
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(FBS_PORTAL_JWT_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${header}.${body}`));
    if (!safeEqual(signature, encodeBase64url(new Uint8Array(signed)))) return false;
    const payload = JSON.parse(decodeBase64url(body)) as { exp?: number; scope?: string; portalUserId?: number };
    return payload.scope === "fbs-portal" && typeof payload.portalUserId === "number" && typeof payload.exp === "number" && payload.exp >= Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

async function handleFbsPortalRequest(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/_next/") || pathname === "/favicon.ico" || pathname.startsWith("/logo-")) return NextResponse.next();
  if (pathname === "/robots.txt") return new NextResponse("User-agent: *\nDisallow: /\n", { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex, nofollow, noarchive" } });
  if (
    pathname === "/api/fbs/print-agent"
    || pathname === "/api/fbs-portal/login"
    || pathname === "/fbs-print-agent.mjs"
    || pathname === "/fbs-print-agent-windows.ps1"
    || pathname === "/install-fbs-print-agent-windows.ps1"
    || pathname === "/update-fbs-print-agent-windows.ps1"
    || pathname === "/repair-fbs-print-agent-windows.ps1"
    || pathname === "/setup-fbs-printer-recovery.cmd"
  ) return NextResponse.next();
  const valid = await isValidFbsPortalToken(request.cookies.get("fbs-portal-token")?.value);
  if (pathname === "/fbs-portal/login") {
    if (valid) return NextResponse.redirect(new URL("/fbs", request.url));
    return NextResponse.next();
  }
  if (pathname === "/login") {
    if (valid) return NextResponse.redirect(new URL("/fbs", request.url));
    return NextResponse.next();
  }
  if (!valid) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", request.url));
  }
  if (pathname === "/") return NextResponse.redirect(new URL("/fbs", request.url));
  const allowed = pathname === "/fbs" || pathname.startsWith("/fbs/") || pathname === "/fbs-stock" || pathname.startsWith("/fbs-stock/") || pathname === "/printer" || pathname.startsWith("/printer/") || pathname === "/users" || pathname === "/settings" || pathname.startsWith("/api/fbs") || pathname.startsWith("/api/fbs-stock") || pathname.startsWith("/api/fbs-portal/") || pathname === "/api/settings/fbs-apikey" || pathname === "/data/release-marker.json" || pathname === "/fbs-print-agent.mjs" || pathname === "/fbs-print-agent-windows.ps1" || pathname === "/install-fbs-print-agent-windows.ps1" || pathname === "/update-fbs-print-agent-windows.ps1" || pathname === "/repair-fbs-print-agent-windows.ps1" || pathname === "/setup-fbs-printer-recovery.cmd";
  if (!allowed) return new NextResponse("Not found", { status: 404, headers: { "X-Robots-Tag": "noindex, nofollow, noarchive" } });
  return NextResponse.next();
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const productionOnlyBlocked = pathname === "/debug"
    || pathname.startsWith("/debug/")
    || pathname === "/purchases/test"
    || pathname.startsWith("/purchases/test/")
    || pathname === "/finance/settings/test"
    || pathname.startsWith("/finance/settings/test/")
    || pathname === "/shipment/products-test"
    || pathname.startsWith("/shipment/products-test/")
    || pathname === "/warehouse/test"
    || pathname.startsWith("/warehouse/test/")
    || /^\/fbs\/[^/]+-test(?:\/|$)/.test(pathname)
    || /^\/api\/fbs\/[^/]+-test(?:\/|$)/.test(pathname);
  if (IS_PRODUCTION_RUNTIME && productionOnlyBlocked) {
    return new NextResponse("Not found", { status: 404, headers: { "X-Robots-Tag": "noindex, nofollow, noarchive" } });
  }

  const hostname = String(request.headers.get("host") || "").toLowerCase().split(":")[0];
  if (hostname === FBS_PORTAL_HOST) return handleFbsPortalRequest(request);

  if (pathname === "/robots.txt") {
    return new NextResponse("User-agent: *\nDisallow: /\n", {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    });
  }

  // Skip auth-related and static paths
  if (
    pathname.startsWith("/login") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/data") ||
    pathname.startsWith("/api/settings") ||
    pathname.startsWith("/api/overrides") ||
    pathname.startsWith("/api/wb") ||
    pathname.startsWith("/api/reviews") ||
    pathname.startsWith("/api/finance") ||
    pathname.startsWith("/api/monitor") ||
    pathname.startsWith("/api/purchases") ||
    pathname.startsWith("/_next") ||
    pathname === "/robots.txt" ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/logo-")
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get("mphub-token")?.value;
  if (!(await isValidSessionToken(token))) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt).*)"],
};
