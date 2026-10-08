import { createHash, randomBytes } from "node:crypto";
import { q } from "./db";
import { hashPassword, verifyPassword } from "./passwords";
import { googleAdminEmails } from "./google";

import { settings } from "./settings";

/**
 * App login. Accounts live in Postgres (app_users, scrypt-hashed passwords) and are managed with
 * `npm run user -- add|reset|disable|enable|list|signout` — never through env files.
 * Sessions are server-side (app_sessions): the cookie holds a random token, the DB only its sha256, so signing
 * out, disabling a user or resetting a password takes effect immediately.
 *
 * Env (optional): SESSION_IDLE_HOURS (default 12), SESSION_MAX_DAYS (default 7).
 * Idle = no one used the page: an open tab's background checks (connections, notifications, progress) don't count —
 * only requests the page marks as made within 5 minutes of a click / key / scroll (x-dr-idle-ms), and any change (POST…).
 */
export const SESSION_COOKIE = "dr_session";
const IDLE_MS = Number(process.env.SESSION_IDLE_HOURS || 12) * 3600e3;
const MAX_MS = Number(process.env.SESSION_MAX_DAYS || 7) * 864e5;
const LOCK_AFTER = 5, LOCK_MS = 15 * 60e3;

export interface SessionUser { name: string; isAdmin: boolean }

/** SQL (alias s = app_sessions, u = app_users; $idle = idle limit in ms): a session that still signs someone in. */
export const LIVE_SESSION_SQL = (idle: string) =>
  `s.revoked_at IS NULL AND s.expires_at > now() AND s.created_at > u.password_changed_at AND s.last_seen_at > now() - (${idle} || ' milliseconds')::interval`;
export const sessionIdleMs = () => IDLE_MS;

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/**
 * First start only (empty user list): bring in the first admins so someone can sign in and add everyone else —
 * DEV_RESOLVE_USERS (name:password pairs, hashed) and GOOGLE_ADMIN_EMAILS (Google sign-in). After that the user list
 * (Admin → User access control) is the only way in.
 */
let seeded: Promise<void> | null = null;
function seedFromEnvOnce() {
  seeded ??= (async () => {
    const [{ n }] = await q<{ n: string }>(`SELECT count(*) AS n FROM app_users`);
    if (Number(n) > 0) return;
    for (const pair of (process.env.DEV_RESOLVE_USERS || "").split(",")) {
      const i = pair.indexOf(":");
      if (i <= 0) continue;
      const name = pair.slice(0, i).trim().toLowerCase();
      await q(`INSERT INTO app_users (name, password_hash, is_admin) VALUES ($1, $2, $3) ON CONFLICT (name) DO NOTHING`,
        [name, await hashPassword(pair.slice(i + 1).trim()), name === "admin"]);
    }
    for (const email of googleAdminEmails()) {
      await q(`INSERT INTO app_users (name, email, is_admin) VALUES ($1, $2, true) ON CONFLICT DO NOTHING`,
        [email.split("@")[0].replace(/[^a-z0-9._-]/g, "-").slice(0, 60), email]);
    }
  })().catch((e) => { seeded = null; throw e; });
  return seeded;
}

// Hash of a random password — compared against when the name doesn't exist, so timing doesn't reveal valid names.
const DUMMY = hashPassword(randomBytes(16).toString("hex"));

export async function login(nameRaw: string, password: string, meta: { ip?: string; userAgent?: string }):
  Promise<{ ok: true; token: string; maxAge: number; user: SessionUser } | { ok: false; error: string; status: number }> {
  await seedFromEnvOnce();
  const name = nameRaw.trim().toLowerCase();
  const [u] = await q<{ id: number; name: string; password_hash: string | null; is_admin: boolean; disabled_at: string | null; locked_until: string | null }>(
    `SELECT id, name, password_hash, is_admin, disabled_at, locked_until FROM app_users WHERE name = $1`, [name]);
  const good = await verifyPassword(password, u?.password_hash ?? (await DUMMY));
  if (u?.locked_until && new Date(u.locked_until).getTime() > Date.now()) {
    return { ok: false, status: 429, error: "Too many wrong passwords — this account is locked for 15 minutes" };
  }
  if (!u || !good || u.disabled_at) {
    if (u && !good) {
      await q(`UPDATE app_users SET failed_logins = failed_logins + 1,
                 locked_until = CASE WHEN failed_logins + 1 >= $2 THEN now() + ($3 || ' milliseconds')::interval END
               WHERE id = $1`, [u.id, LOCK_AFTER, String(LOCK_MS)]);
    }
    return { ok: false, status: 401, error: "Wrong name or password" };
  }
  return { ok: true, ...(await openSession(u.id, meta)), user: { name: u.name, isAdmin: u.is_admin } };
}

async function openSession(userId: number, meta: { ip?: string; userAgent?: string }) {
  await q(`UPDATE app_users SET failed_logins = 0, locked_until = NULL, last_login_at = now() WHERE id = $1`, [userId]);
  const token = randomBytes(32).toString("base64url");
  await q(`INSERT INTO app_sessions (token_hash, user_id, expires_at, ip, user_agent) VALUES ($1, $2, now() + ($3 || ' milliseconds')::interval, $4, $5)`,
    [sha256(token), userId, String(MAX_MS), meta.ip?.slice(0, 64) ?? null, meta.userAgent?.slice(0, 300) ?? null]);
  // Housekeeping: old sessions are useless — drop them now and then.
  if (Math.random() < 0.05) q(`DELETE FROM app_sessions WHERE expires_at < now() - interval '7 days'`).catch(() => {});
  return { token, maxAge: Math.floor(MAX_MS / 1000) };
}

/**
 * Google sign-in (identity already verified in google.ts). Only people in the user list can sign in: the verified
 * Google email must belong to a user an admin added (Admin → User access control). Nobody gets an account by signing in.
 */
export async function loginWithGoogle(email: string, displayName: string, meta: { ip?: string; userAgent?: string }):
  Promise<{ ok: true; token: string; maxAge: number; user: SessionUser } | { ok: false; error: string }> {
  await seedFromEnvOnce();
  const [u] = await q<{ id: number; name: string; is_admin: boolean; disabled_at: string | null }>(
    `SELECT id, name, is_admin, disabled_at FROM app_users WHERE lower(email) = $1`, [email]);
  if (!u) return { ok: false, error: `${email} doesn't have access to Dev Resolve — ask an admin to add you` };
  if (u.disabled_at) return { ok: false, error: "Your Dev Resolve login is disabled — ask an admin" };
  await q(`UPDATE app_users SET display_name = COALESCE(display_name, $2) WHERE id = $1`, [u.id, displayName.slice(0, 120)]);
  return { ok: true, ...(await openSession(u.id, meta)), user: { name: u.name, isAdmin: u.is_admin } };
}

/** Did a person just use the page? (Not an open tab polling in the background.) */
export function userActive(req: Request) {
  if (!["GET", "HEAD"].includes(req.method)) return true;
  const idle = Number(req.headers.get("x-dr-idle-ms") ?? NaN);
  return Number.isFinite(idle) && idle < 5 * 60e3;
}

export async function verifySession(token: string | undefined, opts: { active?: boolean } = {}): Promise<SessionUser | null> {
  if (!token || token.length > 100) return null;
  // Checked against the DB on every request (one primary-key lookup), so sign-out / disable / reset is instant.
  const [s] = await q<{ name: string; is_admin: boolean; last_seen_at: string }>(
    `SELECT u.name, u.is_admin, s.last_seen_at FROM app_sessions s JOIN app_users u ON u.id = s.user_id
      WHERE s.token_hash = $1 AND u.disabled_at IS NULL AND ${LIVE_SESSION_SQL("$2")}`,
    [sha256(token), String(IDLE_MS)]);
  const user = s ? { name: s.name, isAdmin: s.is_admin } : null;
  if (s && opts.active !== false && Date.now() - new Date(s.last_seen_at).getTime() > 5 * 60e3) {
    q(`UPDATE app_sessions SET last_seen_at = now() WHERE token_hash = $1`, [sha256(token)]).catch(() => {});
  }
  return user;
}

export async function revokeSession(token: string | undefined) {
  if (!token) return;
  await q(`UPDATE app_sessions SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, [sha256(token)]);
}

const tokenFrom = (req: Request) =>
  (req.headers.get("cookie") || "").match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))?.[1];

/** The signed-in user for an API route (the proxy already rejected unauthenticated requests). */
export async function sessionUser(req: Request) {
  return verifySession(tokenFrom(req), { active: userActive(req) });
}
export async function currentUser(req: Request): Promise<string> {
  return (await sessionUser(req))?.name ?? "unknown";
}
export { tokenFrom as sessionToken };

/** Secure only over HTTPS (behind a proxy: X-Forwarded-Proto), so plain-http localhost keeps working. */
export function sessionCookie(req: Request, value: string, maxAge: number) {
  const secure = new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https" || settings.appUrl().startsWith("https:");
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}
