import { NextResponse, type NextRequest } from "next/server";

/**
 * Frontend gate: no page is shown without a session cookie — straight to /login (and back afterwards).
 * The backend still checks the session itself on every /api call; this just stops signed-out visitors from
 * seeing any page at all. /api/* is forwarded to the backend untouched (it answers 401 there).
 */
const PUBLIC = new Set(["/login", "/privacy"]);

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  if (PUBLIC.has(pathname) || req.cookies.get("dr_session")?.value) return NextResponse.next();
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except the API (backend checks it), Next's own files and public assets.
  matcher: ["/((?!api/|_next/|icon\\.png|apple-icon\\.png|favicon\\.ico|dev-resolve-connector\\.mjs).*)"],
};
