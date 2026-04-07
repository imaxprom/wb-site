import { NextRequest, NextResponse } from "next/server";

/**
 * Edge middleware — checks only for cookie presence.
 * JWT validation happens in API routes (they run in Node.js runtime).
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Always allow login page and auth API
  if (pathname === "/login" || pathname.startsWith("/api/auth/")) {
    return NextResponse.next();
  }

  // Allow static files / Next.js internals
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/data/") ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/logo-")
  ) {
    return NextResponse.next();
  }

  // Check for cookie presence (not validating JWT — Edge has no Node crypto)
  const token = req.cookies.get("mphub-token")?.value;
  if (!token) {
    const loginUrl = new URL("/login", req.url);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
