import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

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
    pathname.startsWith("/reviews") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/data") ||
    pathname === "/robots.txt" ||
    pathname === "/favicon.ico" ||
    pathname.startsWith("/logo-")
  ) {
    return NextResponse.next();
  }

  const token = request.cookies.get("mphub-token")?.value;
  if (!token) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt).*)"],
};
