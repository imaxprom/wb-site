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
    return payload.scope === "fbs-portal"
      && typeof payload.portalUserId === "number"
      && typeof payload.exp === "number"
      && payload.exp >= Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function requestHostname(req: NextRequest): string {
  return String(req.headers.get("host") || "").toLowerCase().split(":")[0];
}

async function handleFbsPortalRequest(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;
  const staticPath = pathname.startsWith("/_next/") || pathname === "/favicon.ico" || pathname.startsWith("/logo-");
  if (staticPath) return NextResponse.next();
  if (pathname === "/robots.txt") {
    return new NextResponse("User-agent: *\nDisallow: /\n", { status: 200, headers: { "Content-Type": "text/plain; charset=utf-8", "X-Robots-Tag": "noindex, nofollow, noarchive" } });
  }
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

  const valid = await isValidFbsPortalToken(req.cookies.get("fbs-portal-token")?.value);
  if (pathname === "/fbs-portal/login") {
    if (valid) return NextResponse.redirect(new URL("/fbs", req.url));
    return NextResponse.next();
  }
  if (pathname === "/login") {
    if (valid) return NextResponse.redirect(new URL("/fbs", req.url));
    return NextResponse.next();
  }
  if (!valid) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.redirect(new URL("/login", req.url));
  }
  if (pathname === "/") return NextResponse.redirect(new URL("/fbs", req.url));
  const allowed = pathname === "/fbs"
    || pathname.startsWith("/fbs/")
    || pathname === "/fbs-stock"
    || pathname.startsWith("/fbs-stock/")
    || pathname === "/printer"
    || pathname.startsWith("/printer/")
    || pathname === "/users"
    || pathname === "/settings"
    || pathname.startsWith("/api/fbs")
    || pathname.startsWith("/api/fbs-stock")
    || pathname.startsWith("/api/fbs-portal/")
    || pathname === "/api/settings/fbs-apikey"
    || pathname === "/data/release-marker.json"
    || pathname === "/fbs-print-agent.mjs"
    || pathname === "/fbs-print-agent-windows.ps1"
    || pathname === "/install-fbs-print-agent-windows.ps1"
    || pathname === "/update-fbs-print-agent-windows.ps1"
    || pathname === "/repair-fbs-print-agent-windows.ps1"
    || pathname === "/setup-fbs-printer-recovery.cmd";
  if (!allowed) return new NextResponse("Not found", { status: 404, headers: { "X-Robots-Tag": "noindex, nofollow, noarchive" } });
  return NextResponse.next();
}

/**
 * Edge proxy — validates session token signature/expiry before serving pages and static data.
 * API routes still perform full role checks in Node.js runtime.
 */
export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

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

  if (requestHostname(req) === FBS_PORTAL_HOST) return handleFbsPortalRequest(req);

  if (pathname === "/robots.txt") {
    return new NextResponse("User-agent: *\nDisallow: /\n", {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    });
  }

  // Admin datasets are served only through role-checked API routes.
  if (
    pathname === "/data/docs.json" ||
    pathname === "/data/changelog.json" ||
    pathname.startsWith("/data/monitor/")
  ) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Cron-triggered sync endpoints validate x-mphub-cron-secret in their route
  // handlers. Let them reach Node.js instead of redirecting to /login.
  if (
    req.method === "POST" &&
    (
      pathname === "/api/wb/daily-sync" ||
      pathname === "/api/data/sync" ||
      pathname === "/api/supply-reports/sync" ||
      pathname === "/api/shipment/cart-stock" ||
      pathname === "/api/fbs-stock/sync" ||
      pathname === "/api/fbs/archive"
    )
  ) {
    return NextResponse.next();
  }

  // Always allow login page and auth API
  if (pathname === "/login" || pathname.startsWith("/api/auth/")) {
    return NextResponse.next();
  }

  // Local-only visual prototype. The page itself returns 404 in production.
  if (!IS_PRODUCTION_RUNTIME && (pathname === "/fbs/assembly-test" || pathname === "/fbs/print-button-test" || pathname === "/fbs/grouped-assembly-test")) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/purchases/")) {
    return NextResponse.next();
  }

  // The WB cart-stock worker authenticates each request with a timestamped
  // HMAC signature and a one-time nonce in the Node.js route handler.
  if (pathname.startsWith("/api/internal/cart-stock/worker/")) {
    return NextResponse.next();
  }

  // The local FBS print-agent authenticates with its own organization-scoped
  // bearer token in the Node.js route. The downloadable script contains no
  // credentials and must be reachable before an employee configures it.
  if (pathname === "/api/fbs/print-agent" || pathname === "/fbs-print-agent.mjs" || pathname === "/fbs-print-agent-windows.ps1" || pathname === "/install-fbs-print-agent-windows.ps1" || pathname === "/update-fbs-print-agent-windows.ps1" || pathname === "/repair-fbs-print-agent-windows.ps1" || pathname === "/setup-fbs-printer-recovery.cmd") {
    return NextResponse.next();
  }

  // Allow static files / Next.js internals
  if (
    pathname.startsWith("/_next/") ||
    pathname === "/robots.txt" ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/logo-")
  ) {
    return NextResponse.next();
  }

  // Check token signature and expiry at the edge. API routes still validate role in Node.js.
  const token = req.cookies.get("mphub-token")?.value;
  if (!(await isValidSessionToken(token))) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|robots.txt).*)",
  ],
};
