import "server-only";
import { existsSync, readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import { cfgValue, getConnectionProjects, ROOT } from "./config";
import { appLogUserConfigDir, connectorMode } from "./connector";

/**
 * Shipsy application logs are reached through the `opensearch-app-log` MCP (mcp-remote → OAuth gateway).
 * mcp-remote opens a browser window by itself when its token is unusable, which must never happen from a
 * background health check or investigation. So Dev Resolve validates / refreshes the token here first, and
 * only tells the user to run `npm run app-log-login` if the refresh token is dead too.
 */

type Tokens = { access_token: string; id_token?: string; refresh_token?: string; expires_in?: number; token_type?: string };
export type AppLogProject = NonNullable<ReturnType<typeof getConnectionProjects>[string]["opensearch_mcp"]> & { name: string };

export function appLogProjects(): AppLogProject[] {
  return Object.entries(getConnectionProjects())
    .filter(([, p]) => p.opensearch_mcp)
    .map(([name, p]) => ({ name, ...p.opensearch_mcp!, args: p.opensearch_mcp!.args.map(resolveEnv) }));
}

/** Endpoints/client ids stay in config.env; projects.json refers to them as \${NAME}. */
export function resolveEnv(v: string) {
  return v.replace(/\$\{([A-Z0-9_]+)\}/g, (_, k) => {
    const val = cfgValue(k);
    if (!val) throw new Error(`${k} is not set in config/config.env`);
    return val;
  });
}

/** Where the saved login lives. Connector mode: each person's own (brought by their connector); else the shared one. */
export function appLogConfigDir(p: AppLogProject, user?: string | null) {
  if (connectorMode()) return appLogUserConfigDir(user || "unknown");
  return path.join(ROOT, p.config_dir);
}

const gatewayUrl = (p: AppLogProject) => p.args.find((a) => /^https:\/\//.test(a))!;
const clientId = (p: AppLogProject) => JSON.parse(p.args[p.args.indexOf("--static-oauth-client-info") + 1]).client_id as string;

/** mcp-remote stores tokens under <config_dir>/mcp-remote-<version>/<hash>_tokens.json — newest file wins. */
function tokenFile(p: AppLogProject, user?: string | null): string | null {
  const base = appLogConfigDir(p, user);
  if (!existsSync(base)) return null;
  const files = readdirSync(base, { recursive: true, withFileTypes: false })
    .map(String)
    .filter((f) => f.endsWith("_tokens.json"))
    .map((f) => path.join(base, f));
  return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0] ?? null;
}

async function tokenWorks(p: AppLogProject, access: string) {
  const r = await fetch(gatewayUrl(p), {
    method: "POST",
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "dev-resolve-health", version: "0" } } }),
    signal: AbortSignal.timeout(15000),
  });
  return r.status !== 401 && r.status !== 403;
}

async function refresh(p: AppLogProject, t: Tokens): Promise<Tokens | null> {
  if (!t.refresh_token) return null;
  const meta = await fetch(new URL("/.well-known/oauth-authorization-server", gatewayUrl(p)), { signal: AbortSignal.timeout(15000) }).then((r) => r.json());
  const r = await fetch(meta.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId(p), refresh_token: t.refresh_token }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) return null;
  const n = (await r.json()) as Tokens;
  return { ...t, ...n, refresh_token: n.refresh_token ?? t.refresh_token };
}

export type AppLogAuth = { ok: true; message: string } | { ok: false; status: "auth_failed" | "error" | "not_configured"; message: string };

const lastGood = new Map<string, number>();
// A failed check is remembered for 30 s, so pages that ask often (Connector page, every 5 s) don't hammer the gateway.
const lastBad = new Map<string, { at: number; res: AppLogAuth }>();

/** Make sure the saved login works (refreshing it silently if needed). Never opens a browser. */
export async function ensureAppLogAuth(p: AppLogProject, user?: string | null): Promise<AppLogAuth> {
  const dir = appLogConfigDir(p, user);
  const signIn = connectorMode() ? "sign in to app logs from your local connector (Connector page)" : `run \`${p.login_command}\``;
  if (Date.now() - (lastGood.get(dir) ?? 0) < 60_000) return { ok: true, message: "Signed in (checked <1 min ago)" };
  const bad = lastBad.get(dir);
  const f = tokenFile(p, user);
  if (!f) return { ok: false, status: "not_configured", message: `No saved login yet — ${signIn}` };
  if (bad && Date.now() - bad.at < 30_000 && statSync(f).mtimeMs < bad.at) return bad.res; // unless a new login arrived since
  const res = await check(p, f, dir, signIn);
  if (res.ok) lastBad.delete(dir); else lastBad.set(dir, { at: Date.now(), res });
  return res;
}

async function check(p: AppLogProject, f: string, dir: string, signIn: string): Promise<AppLogAuth> {
  try {
    const t = JSON.parse(readFileSync(f, "utf8")) as Tokens;
    if (t.access_token && (await tokenWorks(p, t.access_token))) {
      lastGood.set(dir, Date.now());
      return { ok: true, message: "Signed in" };
    }
    const n = await refresh(p, t);
    if (n && (await tokenWorks(p, n.access_token))) {
      writeFileSync(f, JSON.stringify(n, null, 2), { mode: 0o600 });
      void import("./privateStore").then((m) => m.savePrivate(f));
      lastGood.set(dir, Date.now());
      return { ok: true, message: "Signed in (session renewed)" };
    }
    return { ok: false, status: "auth_failed", message: `Login expired — ${signIn}` };
  } catch (e) {
    return { ok: false, status: "error", message: (e as Error).message };
  }
}

/** Glob match where the allowed pattern's `*` matches anything (incl. nothing). */
function globToRe(glob: string) {
  return new RegExp("^" + glob.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
}

/**
 * Every comma-separated part of `index` must stay inside one of the account's patterns:
 * a concrete name must match a pattern; a wildcard must be the pattern itself or narrower
 * (e.g. `app-logs-neo-wf-2026-09-*` inside `app-logs-neo-wf-*`). Broader ones like `app-logs-*` are refused.
 */
export function indexAllowed(index: string | undefined, allowed: string[]): string | null {
  if (!index?.trim()) return "an explicit index is required";
  for (const part of index.split(",").map((s) => s.trim()).filter(Boolean)) {
    const ok = allowed.some((g) => {
      if (part === g) return true;
      if (!part.includes("*")) return globToRe(g).test(part);
      const literalPrefix = g.slice(0, g.indexOf("*") < 0 ? g.length : g.indexOf("*"));
      return part.startsWith(literalPrefix) && globToRe(g).test(part.replace(/\*/g, "x"));
    });
    if (!ok) return `index "${part}" is outside this account's indices (${allowed.join(", ")})`;
  }
  return null;
}
