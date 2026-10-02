import "server-only";
import https from "node:https";
import http from "node:http";
import { execFile } from "node:child_process";
import path from "node:path";
import { cfgValue, getAccounts, getConnectionProjects, projectsFileExists, ROOT } from "./config";
import { getPool } from "./db";
import { settings } from "./settings";
import { ConnectorOffline, connectorMode, metabaseSession, needsRelay, relay, userToolEnv } from "./connector";
import { whoAmI, DevrevError } from "./devrev";
import { appLogProjects, ensureAppLogAuth } from "./applog";

export type HealthStatus = "ok" | "vpn_required" | "auth_failed" | "not_configured" | "error";

export interface ConnectionHealth {
  id: string;            // e.g. "opensearch:wms", "metabase:qc", "devrev"
  kind: "devrev" | "postgres" | "claude" | "opensearch" | "metabase" | "opensearch_mcp" | "config";
  label: string;
  host?: string;
  status: HealthStatus;
  message: string;
  fix?: string;
  used_by: string[];     // account names depending on this connection
}

const vpnFix = () => connectorMode()
  ? `Connect the VPN on your laptop${cfgValue("VPN_HINT") ? ` (${cfgValue("VPN_HINT")})` : ""} and keep your local connector running (Connector page), then re-check.`
  : `Connect the client VPN${cfgValue("VPN_HINT") ? ` (${cfgValue("VPN_HINT")})` : ""}, then re-check.`;
const TIMEOUT_MS = 12000;

function hostOf(url?: string) {
  try {
    return url ? new URL(url).host : undefined;
  } catch {
    return url;
  }
}

function looksVpnOnly(host?: string) {
  const suffixes = (cfgValue("VPN_HOST_SUFFIXES") || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return !!host && suffixes.some((s) => host.split(":")[0].toLowerCase().endsWith(s));
}

/** Minimal HTTPS POST that tolerates the self-signed certs some client hosts use (same as the Python tools' verify=False). */
function rawPost(url: string, body: unknown, headers: Record<string, string>, auth?: { user: string; pass: string }) {
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const u = new URL(url);
    const data = JSON.stringify(body);
    const lib = u.protocol === "http:" ? http : https;
    const req = lib.request(
      {
        method: "POST",
        hostname: u.hostname,
        port: u.port || undefined,
        path: u.pathname + u.search,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data).toString(),
          ...headers,
          ...(auth && { Authorization: "Basic " + Buffer.from(`${auth.user}:${auth.pass}`).toString("base64") }),
        },
        rejectUnauthorized: false,
        timeout: TIMEOUT_MS,
      },
      (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => resolve({ status: res.statusCode || 0, text }));
      },
    );
    req.on("timeout", () => req.destroy(Object.assign(new Error("timed out"), { code: "ETIMEDOUT" })));
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

function usersOf(pred: (a: ReturnType<typeof getAccounts>[number]) => boolean) {
  return getAccounts().filter((a) => a.status === "active" && pred(a)).map((a) => a.name);
}

async function checkOpenSearch(project: string, cfg: NonNullable<ReturnType<typeof getConnectionProjects>[string]["opensearch"]>, viewer?: string): Promise<ConnectionHealth> {
  const url = cfgValue(cfg.url_env);
  const host = hostOf(url);
  const logTypes = Object.keys(cfg.log_types || {});
  const base: Omit<ConnectionHealth, "status" | "message"> = {
    id: `opensearch:${project}`,
    kind: "opensearch",
    label: `OpenSearch logs · ${project}`,
    host,
    used_by: usersOf((a) => logTypes.includes(a.opensearch_log_type || "") || Object.values(a.opensearch_log_types).some((l) => logTypes.includes(l))),
  };
  if (!url) return { ...base, status: "not_configured", message: `${cfg.url_env} is not set`, fix: `Add ${cfg.url_env}=<url> to config/config.env` };
  const user = cfgValue(cfg.username_env);
  const pass = cfgValue(cfg.password_env);
  if (cfg.username_env && (!user || !pass)) {
    return { ...base, status: "auth_failed", message: `Missing ${cfg.username_env} / ${cfg.password_env}`, fix: `Set ${cfg.username_env} and ${cfg.password_env} in config/config.env` };
  }
  const index = Object.values(cfg.log_types)[0];
  try {
    const body = { params: { index, body: { size: 0, query: { range: { timestamp: { gte: "now-1h" } } } } } };
    const headers = { "osd-xsrf": "osd-fetch", "osd-version": "2.19.3" };
    let res: { status: number; text: string };
    if (needsRelay(url)) {
      // Connector mode: checked through the viewer's own laptop (the one that has the VPN).
      try {
        const r = await relay(viewer || "", {
          method: "POST", url, timeout_ms: TIMEOUT_MS, insecure: true,
          headers: { ...headers, "Content-Type": "application/json", ...(user && pass && { Authorization: "Basic " + Buffer.from(`${user}:${pass}`).toString("base64") }) },
          body_b64: Buffer.from(JSON.stringify(body)).toString("base64"),
        });
        res = { status: r.status, text: Buffer.from(r.body_b64, "base64").toString() };
      } catch (e) {
        const offline = e instanceof ConnectorOffline;
        return { ...base, status: "vpn_required", message: offline ? "Your local connector isn't running" : `Your laptop can't reach ${host} — ${(e as Error).message}`, fix: vpnFix() };
      }
    } else {
      res = await rawPost(url, body, headers, user && pass ? { user, pass } : undefined);
    }
    if (res.status === 401 || res.status === 403) {
      return { ...base, status: "auth_failed", message: `HTTP ${res.status} from ${host}`, fix: `Fix ${cfg.username_env} / ${cfg.password_env} in config/config.env` };
    }
    if (res.status >= 400) return { ...base, status: "error", message: `HTTP ${res.status}: ${res.text.slice(0, 160)}` };
    return { ...base, status: "ok", message: `Reachable · ${logTypes.length} log types (${logTypes.join(", ")})` };
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    const netFail = ["ENOTFOUND", "ETIMEDOUT", "ECONNREFUSED", "EHOSTUNREACH", "ECONNRESET", "EAI_AGAIN"].includes(err.code || "");
    if (netFail && looksVpnOnly(host)) return { ...base, status: "vpn_required", message: `Can't reach ${host} (${err.code})`, fix: vpnFix() };
    return { ...base, status: "error", message: `${err.code || ""} ${err.message}`.trim() };
  }
}

function checkMetabase(project: string, cfg: NonNullable<ReturnType<typeof getConnectionProjects>[string]["metabase"]>, viewer?: string): Promise<ConnectionHealth> {
  const url = cfgValue(cfg.base_url_env);
  const host = hostOf(url);
  const base: Omit<ConnectionHealth, "status" | "message"> = {
    id: `metabase:${project}`,
    kind: "metabase",
    label: `Metabase DB · ${project}`,
    host,
    used_by: usersOf((a) => a.metabase_project === project),
  };
  if (!url) return Promise.resolve({ ...base, status: "not_configured", message: `${cfg.base_url_env} is not set`, fix: `Add ${cfg.base_url_env}=<url> to config/config.env` });
  const script = path.join(ROOT, ".claude/skills/metabase-sql/query.py");
  if (connectorMode() && cfg.sso === "google" && !(viewer && metabaseSession(viewer, project))) {
    return Promise.resolve({ ...base, status: "auth_failed", message: "You haven't signed in to it with Google yet",
      fix: `Sign in to ${project} with Google from your local connector (Connector page)` });
  }
  return new Promise((resolve) => {
    execFile("python3", [script, "whoami", "--project", project], { env: userToolEnv(viewer) as NodeJS.ProcessEnv, timeout: 35000 }, (error, stdout, stderr) => {
      const out = `${stdout}\n${stderr}`;
      if (!error) return resolve({ ...base, status: "ok", message: stdout.trim() });
      // Killed by our own timeout while the host is unreachable = the same VPN problem, not a mystery error.
      if (out.includes("VPN_REQUIRED") || (looksVpnOnly(host) && (/Connection error|timed out/i.test(out) || error.killed))) {
        return resolve({ ...base, status: "vpn_required", message: `Can't reach ${host}`, fix: vpnFix() });
      }
      if (out.includes("AUTH_FAILED") || out.includes("No session token")) {
        return resolve({
          ...base,
          status: "auth_failed",
          message: "Session expired and auto-login failed",
          fix: cfg.sso === "google" && connectorMode()
            ? `Sign in to ${project} with Google from your local connector (Connector page)`
            : cfg.sso === "google"
            ? `Google sign-in expired — run in a terminal: npm run metabase-login -- ${project}`
            : `Run in a terminal: npm run metabase-password -- ${project}`,
        });
      }
      resolve({ ...base, status: "error", message: out.trim().slice(0, 200) || String(error) });
    });
  });
}

async function checkDevrev(): Promise<ConnectionHealth> {
  const base = { id: "devrev", kind: "devrev" as const, label: "DevRev API", host: new URL(settings.devrevApiUrl()).host, used_by: ["all accounts"] };
  try {
    const me = await whoAmI();
    return { ...base, status: "ok", message: `Authenticated as ${me.dev_user.display_name}` };
  } catch (e) {
    const err = e as DevrevError;
    if (err.tag === "AUTH_FAILED") return { ...base, status: "auth_failed", message: err.message, fix: "Update DEVREV_TOKEN in .env.local and restart `npm run dev`" };
    return { ...base, status: "error", message: err.message };
  }
}

async function checkPostgres(): Promise<ConnectionHealth> {
  const base = { id: "postgres", kind: "postgres" as const, label: "Postgres (Dev Resolve storage)", host: hostOf(process.env.DATABASE_URL), used_by: ["all accounts"] };
  try {
    await getPool().query("SELECT 1");
    return { ...base, status: "ok", message: "Connected" };
  } catch (e) {
    return { ...base, status: "error", message: (e as Error).message, fix: "Start Docker, then run `npm run db:up`" };
  }
}

async function checkClaude(): Promise<ConnectionHealth> {
  const base = { id: "claude", kind: "claude" as const, label: "Claude (investigation agent)", host: new URL(settings.anthropicApiUrl()).host, used_by: ["all accounts"] };
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    // Server without an API key: a long-lived token from `claude setup-token` (your Claude subscription login).
    if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return { ...base, status: "ok", message: "Using your Claude login token (CLAUDE_CODE_OAUTH_TOKEN)" };
    if (process.env.NODE_ENV === "production") {
      return { ...base, status: "auth_failed", message: "No Claude login on this server",
        fix: "Run `claude setup-token` on your laptop and set CLAUDE_CODE_OAUTH_TOKEN (or ANTHROPIC_API_KEY) in the server's secrets" };
    }
    return { ...base, status: "ok", message: "Using your local Claude Code login (no ANTHROPIC_API_KEY set)" };
  }
  try {
    const res = await fetch(`${settings.anthropicApiUrl()}/v1/models?limit=1`, { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" }, cache: "no-store" });
    if (res.status === 401 || res.status === 403) return { ...base, status: "auth_failed", message: `HTTP ${res.status}`, fix: "Fix ANTHROPIC_API_KEY in .env.local" };
    if (!res.ok) return { ...base, status: "error", message: `HTTP ${res.status}` };
    return { ...base, status: "ok", message: "API key valid" };
  } catch (e) {
    return { ...base, status: "error", message: (e as Error).message };
  }
}

// Cache each check's result so page views / polling don't re-hit DevRev, OpenSearch and every Metabase
// (the Metabase tool allows only 10 requests a minute). Healthy results live 60 s, failures 15 s; `force` bypasses.
const healthCache = new Map<string, { at: number; value: ConnectionHealth }>();
function cached(key: string, force: boolean, run: () => Promise<ConnectionHealth>): Promise<ConnectionHealth> {
  const hit = healthCache.get(key);
  if (!force && hit && Date.now() - hit.at < (hit.value.status === "ok" || hit.value.status === "not_configured" ? 60_000 : 15_000)) {
    return Promise.resolve(hit.value);
  }
  return run().then((value) => { healthCache.set(key, { at: Date.now(), value }); return value; });
}

/** Runs every check in parallel. The list of OpenSearch/Metabase checks is built from config, so new connections appear automatically. */
export async function checkAll(filter?: { accountSlug?: string; force?: boolean; viewer?: string }): Promise<ConnectionHealth[]> {
  const force = !!filter?.force;
  const viewer = filter?.viewer;
  // Connector mode: VPN hosts and Google sign-ins differ per person, so those results are cached per viewer.
  const per = (key: string, personal: boolean) => (connectorMode() && personal ? `${key}@${viewer ?? ""}` : key);
  const acc = filter?.accountSlug ? getAccounts().find((a) => a.slug === filter.accountSlug) : undefined;
  // Only run the checks this account actually uses (plus the shared ones) — no point pinging every Metabase.
  const needs = (kind: "opensearch" | "metabase", name: string, p: ReturnType<typeof getConnectionProjects>[string]) => {
    if (!acc) return true;
    if (kind === "metabase") return acc.metabase_project === name;
    const lts = Object.keys(p.opensearch?.log_types ?? {});
    return lts.includes(acc.opensearch_log_type ?? "") || Object.values(acc.opensearch_log_types).some((l) => lts.includes(l));
  };
  const checks: Promise<ConnectionHealth>[] = [
    cached("devrev", force, checkDevrev), cached("postgres", force, checkPostgres), cached("claude", force, checkClaude),
  ];
  for (const [name, p] of Object.entries(getConnectionProjects())) {
    if (p.opensearch && needs("opensearch", name, p)) {
      checks.push(cached(per(`opensearch:${name}`, needsRelay(cfgValue(p.opensearch.url_env) || "")), force, () => checkOpenSearch(name, p.opensearch!, viewer)));
    }
    if (p.metabase && needs("metabase", name, p)) {
      const personal = needsRelay(cfgValue(p.metabase.base_url_env) || "") || p.metabase.sso === "google";
      checks.push(cached(per(`metabase:${name}`, personal), force, () => checkMetabase(name, p.metabase!, viewer)));
    }
  }
  for (const p of appLogProjects()) {
    if (acc && acc.app_log?.project !== p.name) continue;
    checks.push(cached(per(`opensearch_mcp:${p.name}`, true), force, () =>
      ensureAppLogAuth(p, viewer).then((r): ConnectionHealth => ({
        id: `opensearch_mcp:${p.name}`, kind: "opensearch_mcp", label: "Shipsy app logs (MCP)", host: hostOf(p.args.find((a) => a.startsWith("https://"))),
        used_by: getAccounts().filter((a) => a.status === "active" && a.app_log?.project === p.name).map((a) => a.name),
        status: r.ok ? "ok" : r.status, message: r.message,
        ...(r.ok ? {} : { fix: connectorMode() ? "Sign in to app logs from your local connector (Connector page)" : `Run in a terminal: ${p.login_command}  (signs in with your Shipsy Google account)` }),
      }))),
    );
  }
  if (!projectsFileExists()) {
    checks.push(Promise.resolve({ id: "config", kind: "config", label: "Private config", status: "not_configured", used_by: ["all accounts"],
      message: "projects.json hasn't been uploaded to this server", fix: "An admin uploads projects.json and config.env on the Settings page" } as ConnectionHealth));
  }
  let results = await Promise.all(checks);
  if (filter?.accountSlug) {
    results = results.filter((r) => r.used_by.includes("all accounts") || (acc && r.used_by.includes(acc.name)));
    // Accounts without their own logs / DB still show those connections — as "not configured" (yellow).
    if (acc && !results.some((r) => r.kind === "opensearch" || r.kind === "opensearch_mcp")) {
      results.push({
        id: `opensearch:${acc.slug}`, kind: "opensearch", label: "OpenSearch logs", status: "not_configured", used_by: [acc.name],
        message: `No log connection configured for ${acc.name}`,
        fix: "Add its OpenSearch project to config/projects.json + URL/credentials to config/config.env, then set opensearch_log_types on the account",
      });
    }
    if (acc && !results.some((r) => r.kind === "metabase")) {
      results.push({
        id: `metabase:${acc.slug}`, kind: "metabase", label: "Metabase DB", status: "not_configured", used_by: [acc.name],
        message: `No database connection configured for ${acc.name}`,
        fix: "Add its Metabase project to config/projects.json + URL/credentials to config/config.env, then set metabase_project / metabase_database on the account",
      });
    }
  }
  return results;
}
