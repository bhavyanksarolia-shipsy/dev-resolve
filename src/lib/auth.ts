import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Minimal shared-login for testing with teammates (before real deployment/SSO).
 * Users: DEV_RESOLVE_USERS="name:password,name:password" in .env.local. Sessions are HMAC-signed cookies.
 */
export const SESSION_COOKIE = "dr_session";
const SESSION_DAYS = 7;

function secret() {
  const s = process.env.DEV_RESOLVE_SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("DEV_RESOLVE_SESSION_SECRET is missing/short in .env.local");
  return s;
}

function users(): Map<string, string> {
  const m = new Map<string, string>();
  for (const pair of (process.env.DEV_RESOLVE_USERS || "").split(",")) {
    const i = pair.indexOf(":");
    if (i > 0) m.set(pair.slice(0, i).trim().toLowerCase(), pair.slice(i + 1).trim());
  }
  return m;
}

const sign = (payload: string) => createHmac("sha256", secret()).update(payload).digest("base64url");

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function checkLogin(name: string, password: string): string | null {
  const user = name.trim().toLowerCase();
  const expected = users().get(user);
  // Compare even when the user is unknown, so timing doesn't reveal which names exist.
  const ok = safeEqual(expected ?? "\u0000".repeat(password.length || 1), password);
  return expected && ok ? user : null;
}

export function createSession(user: string) {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  const payload = `${Buffer.from(user).toString("base64url")}.${exp}`;
  return { value: `${payload}.${sign(payload)}`, maxAge: SESSION_DAYS * 86400 };
}

export function verifySession(token: string | undefined): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [u, exp, sig] = parts;
  if (!safeEqual(sign(`${u}.${exp}`), sig) || Number(exp) < Date.now()) return null;
  const user = Buffer.from(u, "base64url").toString();
  return users().has(user) ? user : null; // removing someone from DEV_RESOLVE_USERS revokes them
}

/** The signed-in user for an API route (the proxy already rejected unauthenticated requests). */
export function currentUser(req: Request): string {
  const cookie = req.headers.get("cookie") || "";
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  return verifySession(m?.[1]) ?? "unknown";
}
