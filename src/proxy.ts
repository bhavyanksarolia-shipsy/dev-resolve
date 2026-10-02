import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { settings } from "@/lib/settings";

/**
 * Every page and API needs a login — the app reads production logs/DB and posts to DevRev.
 * Changing requests (POST/PUT/PATCH/DELETE) must also come from this app's own pages: a browser always sends
 * Origin on those, so a request started by another website is refused (CSRF), on top of SameSite=Lax cookies.
 * APP_URL (optional, e.g. https://devresolve.example.com) pins the one allowed origin in production.
 */
function sameOrigin(req: NextRequest) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return true;
  const origin = req.headers.get("origin");
  const appUrl = settings.appUrl();
  if (!origin) return !appUrl; // non-browser clients (curl, scripts) only when no APP_URL is pinned
  const allowed = appUrl
    ? new URL(appUrl).origin
    : `${req.headers.get("x-forwarded-proto") || req.nextUrl.protocol.replace(":", "")}://${req.headers.get("x-forwarded-host") || req.headers.get("host")}`;
  return origin === allowed;
}

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  // Token-authenticated machine endpoints (connector: Bearer token; relay: internal secret) — no cookie, so no CSRF.
  if (pathname === "/api/relay" || (pathname.startsWith("/api/connector/") && !["/api/connector/token", "/api/connector/status", "/api/connector/request-signin"].includes(pathname))) {
    return NextResponse.next();
  }
  if (!sameOrigin(req)) return NextResponse.json({ error: "Cross-site request refused" }, { status: 403 });
  if (pathname === "/login" || pathname.startsWith("/api/auth/") || pathname === "/api/healthz" || pathname === "/dev-resolve-connector.mjs") {
    return NextResponse.next();
  }
  const user = await verifySession(req.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (user) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
