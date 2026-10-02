import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { cfgValue, getConnectionProjects, ROOT, toolEnv } from "./config";
import { q } from "./db";
import { settings } from "./settings";

/**
 * Local connector mode (DEV_RESOLVE_CONNECTOR=on, for the deployed server).
 * The server can't join the client VPN and can't do Google sign-in, but each person's laptop can. So every person runs
 * `node dev-resolve-connector.mjs` on their laptop, which
 *   1. relays that person's VPN-only requests (hosts ending in VPN_HOST_SUFFIXES) — the laptop is on the VPN;
 *   2. signs that person in to Google-login Metabase / app logs in their own Chrome and uploads the session.
 * Investigations then run with the credentials and network of whoever started them.
 */
export const connectorMode = () => ["on", "1", "true"].includes((process.env.DEV_RESOLVE_CONNECTOR || cfgValue("DEV_RESOLVE_CONNECTOR") || "").toLowerCase());

export const relaySuffixes = () =>
  (cfgValue("VPN_HOST_SUFFIXES") || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

export const needsRelay = (url: string) => {
  if (!connectorMode()) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return relaySuffixes().some((s) => host.endsWith(s));
  } catch {
    return false;
  }
};

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

// ── tokens ────────────────────────────────────────────────────────────────────────────────────────────────
export async function createConnectorToken(userName: string, label: string) {
  const token = "drc_" + randomBytes(32).toString("base64url");
  const [u] = await q<{ id: number }>(`SELECT id FROM app_users WHERE name = $1`, [userName]);
  if (!u) throw new Error("unknown user");
  // One active connector token per person: making a new one retires the old one.
  await q(`UPDATE connector_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [u.id]);
  await q(`INSERT INTO connector_tokens (token_hash, user_id, label) VALUES ($1, $2, $3)`, [sha256(token), u.id, label.slice(0, 80)]);
  return token;
}

export async function connectorUser(req: Request): Promise<string | null> {
  const m = (req.headers.get("authorization") || "").match(/^Bearer (drc_[A-Za-z0-9_-]{20,100})$/);
  if (!m) return null;
  const [r] = await q<{ name: string }>(
    `UPDATE connector_tokens t SET last_seen_at = now() FROM app_users u
      WHERE t.token_hash = $1 AND t.revoked_at IS NULL AND u.id = t.user_id AND u.disabled_at IS NULL
      RETURNING u.name`, [sha256(m[1])]);
  return r?.name ?? null;
}

// ── relay (in memory: one app instance) ───────────────────────────────────────────────────────────────────
export interface RelayRequest { method: string; url: string; headers: Record<string, string>; body_b64?: string; timeout_ms: number; insecure?: boolean }
export interface RelayResponse { status: number; headers: Record<string, string>; body_b64: string }
interface Job { id: string; user: string; req: RelayRequest; resolve: (r: RelayResponse) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
interface Conn { lastPoll: number; vpn: Record<string, boolean>; version?: string; waiter?: (jobs: Job[]) => void; signin?: string[] }

const g = globalThis as unknown as { drRelay?: { conns: Map<string, Conn>; queue: Map<string, Job[]>; jobs: Map<string, Job>; secret: string } };
const R = (g.drRelay ??= { conns: new Map(), queue: new Map(), jobs: new Map(), secret: process.env.DEV_RESOLVE_RELAY_SECRET || randomBytes(24).toString("hex") });

/** Internal secret the Python tools use to call /api/relay on this same server. */
export const relaySecret = () => R.secret;

export class ConnectorOffline extends Error {}

export function connectorStatus(user: string) {
  const c = R.conns.get(user);
  const online = !!c && Date.now() - c.lastPoll < 40_000;
  const vpnHosts = c ? Object.entries(c.vpn) : [];
  return { online, lastSeen: c ? new Date(c.lastPoll).toISOString() : null, vpnUp: online && vpnHosts.length > 0 && vpnHosts.every(([, ok]) => ok), vpn: c?.vpn ?? {}, version: c?.version };
}

export function relay(user: string, req: RelayRequest): Promise<RelayResponse> {
  if (!needsRelay(req.url)) return Promise.reject(new Error("host is not a VPN host"));
  if (!connectorStatus(user).online) return Promise.reject(new ConnectorOffline(`CONNECTOR_OFFLINE: ${user}'s local connector isn't running`));
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => { R.jobs.delete(id); reject(new Error(`relay timed out after ${req.timeout_ms} ms`)); }, req.timeout_ms + 10_000);
    const job: Job = { id, user, req, resolve, reject, timer };
    R.jobs.set(id, job);
    const c = R.conns.get(user);
    if (c?.waiter) { const w = c.waiter; c.waiter = undefined; w([job]); }
    else R.queue.set(user, [...(R.queue.get(user) ?? []), job]);
  });
}

/** "Sign in again" from the UI: the person's connector opens their Chrome for these on its next poll. */
export function requestSignin(user: string, what: string[]) {
  const c = R.conns.get(user);
  if (!c || !connectorStatus(user).online) return false;
  c.signin = [...new Set([...(c.signin ?? []), ...what])];
  if (c.waiter) { const w = c.waiter; c.waiter = undefined; w([]); }
  return true;
}
export function takeSignin(user: string) {
  const c = R.conns.get(user);
  const s = c?.signin ?? [];
  if (c) c.signin = undefined;
  return s;
}

/** Connector long-poll: returns queued jobs at once, or waits up to ~25 s for one. */
export function poll(user: string, vpn: Record<string, boolean>, version?: string): Promise<Job[]> {
  const c = R.conns.get(user) ?? { lastPoll: 0, vpn: {} };
  Object.assign(c, { lastPoll: Date.now(), vpn, version });
  R.conns.set(user, c);
  const queued = R.queue.get(user) ?? [];
  if (queued.length) { R.queue.delete(user); return Promise.resolve(queued); }
  c.waiter?.([]); // a second poll from the same person replaces the first
  return new Promise((resolve) => {
    const t = setTimeout(() => { if (c.waiter === done) c.waiter = undefined; resolve([]); }, 25_000);
    const done = (jobs: Job[]) => { clearTimeout(t); resolve(jobs); };
    c.waiter = done;
  });
}

export function complete(user: string, id: string, result: { ok: true; res: RelayResponse } | { ok: false; error: string }) {
  const job = R.jobs.get(id);
  if (!job || job.user !== user) return false;
  R.jobs.delete(id);
  clearTimeout(job.timer);
  if (result.ok) job.resolve(result.res);
  else job.reject(new Error(result.error));
  return true;
}

// ── per-person sign-ins brought by the connector ─────────────────────────────────────────────────────────
export const userAuthDir = (user: string) => {
  if (!/^[a-z0-9._-]{2,64}$/.test(user)) throw new Error("bad user name");
  return path.join(ROOT, ".auth", "users", user);
};

function writePrivate(file: string, data: string) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, data, { mode: 0o600 });
}

/** Google-login Metabase projects (projects.json metabase.sso = "google"). */
export const ssoMetabaseProjects = () =>
  Object.entries(getConnectionProjects()).filter(([, p]) => p.metabase?.sso === "google").map(([name, p]) => ({ name, baseUrl: cfgValue(p.metabase!.base_url_env) }));

export function saveMetabaseSession(user: string, project: string, session: string) {
  if (!ssoMetabaseProjects().some((p) => p.name === project)) throw new Error(`${project} is not a Google-login Metabase`);
  if (!/^[0-9a-f-]{20,80}$/i.test(session)) throw new Error("that doesn't look like a Metabase session");
  writePrivate(path.join(userAuthDir(user), "metabase", `${project}.session`), session);
}

export function metabaseSession(user: string, project: string): string | null {
  const f = path.join(userAuthDir(user), "metabase", `${project}.session`);
  return existsSync(f) ? readFileSync(f, "utf8").trim() : null;
}

/** App-logs OAuth tokens, stored where mcp-remote looks for them (<dir>/mcp-remote-v1/<md5(url)>_tokens.json). */
export function appLogUserConfigDir(user: string) {
  return path.join(userAuthDir(user), "mcp-remote");
}

export function saveAppLogTokens(user: string, gatewayUrl: string, tokens: Record<string, unknown>) {
  if (typeof tokens.access_token !== "string" || typeof tokens.refresh_token !== "string") throw new Error("access_token and refresh_token are required");
  const hash = createHash("md5").update(gatewayUrl).digest("hex");
  const expires_in = Number(tokens.expires_in || 3600);
  writePrivate(path.join(appLogUserConfigDir(user), "mcp-remote-v1", `${hash}_tokens.json`),
    JSON.stringify({ ...tokens, expires_in, expires_at: Date.now() + expires_in * 1000 }, null, 2));
}

/**
 * Environment for the Python/MCP tools of one person's run. In connector mode: VPN-only requests go through /api/relay
 * (carried by that person's laptop), and Google-login Metabase uses that person's own session — never a shared one.
 */
export function userToolEnv(user?: string | null): Record<string, string> {
  const env = toolEnv();
  if (!connectorMode()) return env;
  const extra: Record<string, string> = {
    DEV_RESOLVE_CONNECTOR: "on",
    DEV_RESOLVE_RELAY_URL: `${settings.internalUrl()}/api/relay`,
    DEV_RESOLVE_RELAY_SECRET: relaySecret(),
    DEV_RESOLVE_RELAY_USER: user || "",
    DEV_RESOLVE_RELAY_SUFFIXES: relaySuffixes().join(","),
    DEV_RESOLVE_PER_USER_SESSIONS: "1",
  };
  for (const [name, p] of Object.entries(getConnectionProjects())) {
    if (p.metabase?.sso !== "google") continue;
    const key = p.metabase.session_token_env || `${name.toUpperCase()}_METABASE_SESSION_TOKEN`;
    extra[key] = (user && metabaseSession(user, name)) || "";
  }
  return { ...env, ...extra };
}
