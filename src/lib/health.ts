import "server-only";
import https from "node:https";
import http from "node:http";
import { execFile } from "node:child_process";
import path from "node:path";
import { cfgValue, getAccounts, getConnectionProjects, ROOT, toolEnv } from "./config";
import { pool } from "./db";
import { whoAmI, DevrevError } from "./devrev";

export type HealthStatus = "ok" | "vpn_required" | "auth_failed" | "not_configured" | "error";

export interface ConnectionHealth {
  id: string;            // e.g. "opensearch:wms", "metabase:qc", "devrev"
  kind: "devrev" | "postgres" | "claude" | "opensearch" | "metabase";
  label: string;
  host?: string;
  status: HealthStatus;
  message: string;
  fix?: string;
  used_by: string[];     // account names depending on this connection
}

const VPN_FIX = "Connect the Cisco AnyConnect 'ril' VPN profile (tvpn.ril.com), then re-check.";
const TIMEOUT_MS = 12000;

function hostOf(url?: string) {
  try {
    return url ? new URL(url).host : undefined;
  } catch {
    return url;
  }
}

function looksVpnOnly(host?: string) {
  return !!host && /\.ril\.com$/i.test(host.split(":")[0]);
}

/** Minimal HTTPS POST that tolerates the self-signed certs on the Reliance hosts (same as the Python tools' verify=False). */
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

async function checkOpenSearch(project: string, cfg: NonNullable<ReturnType<typeof getConnectionProjects>[string]["opensearch"]>): Promise<ConnectionHealth> {
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
    const res = await rawPost(
      url,
      { params: { index, body: { size: 0, query: { range: { timestamp: { gte: "now-1h" } } } } } },
      { "osd-xsrf": "osd-fetch", "osd-version": "2.19.3" },
      user && pass ? { user, pass } : undefined,
    );
    if (res.status === 401 || res.status === 403) {
      return { ...base, status: "auth_failed", message: `HTTP ${res.status} from ${host}`, fix: `Fix ${cfg.username_env} / ${cfg.password_env} in config/config.env` };
    }
    if (res.status >= 400) return { ...base, status: "error", message: `HTTP ${res.status}: ${res.text.slice(0, 160)}` };
    return { ...base, status: "ok", message: `Reachable · ${logTypes.length} log types (${logTypes.join(", ")})` };
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    const netFail = ["ENOTFOUND", "ETIMEDOUT", "ECONNREFUSED", "EHOSTUNREACH", "ECONNRESET", "EAI_AGAIN"].includes(err.code || "");
    if (netFail && looksVpnOnly(host)) return { ...base, status: "vpn_required", message: `Can't reach ${host} (${err.code})`, fix: VPN_FIX };
    return { ...base, status: "error", message: `${err.code || ""} ${err.message}`.trim() };
  }
}

function checkMetabase(project: string, cfg: NonNullable<ReturnType<typeof getConnectionProjects>[string]["metabase"]>): Promise<ConnectionHealth> {
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
  const script = path.join(ROOT, ".claude/skills/reliance-metabase-query/query.py");
  return new Promise((resolve) => {
    execFile("python3", [script, "whoami", "--project", project], { env: toolEnv() as NodeJS.ProcessEnv, timeout: 25000 }, (error, stdout, stderr) => {
      const out = `${stdout}\n${stderr}`;
      if (!error) return resolve({ ...base, status: "ok", message: stdout.trim() });
      if (out.includes("VPN_REQUIRED") || (looksVpnOnly(host) && /Connection error|timed out/i.test(out))) {
        return resolve({ ...base, status: "vpn_required", message: `Can't reach ${host}`, fix: VPN_FIX });
      }
      if (out.includes("AUTH_FAILED") || out.includes("No session token")) {
        return resolve({
          ...base,
          status: "auth_failed",
          message: "Session expired and auto-login failed",
          fix: `Run in a terminal: python3 .claude/skills/reliance-metabase-query/query.py set-credentials --project ${project}`,
        });
      }
      resolve({ ...base, status: "error", message: out.trim().slice(0, 200) || String(error) });
    });
  });
}

async function checkDevrev(): Promise<ConnectionHealth> {
  const base = { id: "devrev", kind: "devrev" as const, label: "DevRev API", host: "api.devrev.ai", used_by: ["all accounts"] };
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
    await pool.query("SELECT 1");
    return { ...base, status: "ok", message: "Connected" };
  } catch (e) {
    return { ...base, status: "error", message: (e as Error).message, fix: "Start Docker, then run `npm run db:up`" };
  }
}

async function checkClaude(): Promise<ConnectionHealth> {
  const base = { id: "claude", kind: "claude" as const, label: "Claude (investigation agent)", host: "api.anthropic.com", used_by: ["all accounts"] };
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    return { ...base, status: "ok", message: "Using your local Claude Code login (no ANTHROPIC_API_KEY set)" };
  }
  try {
    const res = await fetch("https://api.anthropic.com/v1/models?limit=1", { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" }, cache: "no-store" });
    if (res.status === 401 || res.status === 403) return { ...base, status: "auth_failed", message: `HTTP ${res.status}`, fix: "Fix ANTHROPIC_API_KEY in .env.local" };
    if (!res.ok) return { ...base, status: "error", message: `HTTP ${res.status}` };
    return { ...base, status: "ok", message: "API key valid" };
  } catch (e) {
    return { ...base, status: "error", message: (e as Error).message };
  }
}

/** Runs every check in parallel. The list of OpenSearch/Metabase checks is built from config, so new connections appear automatically. */
export async function checkAll(filter?: { accountSlug?: string }): Promise<ConnectionHealth[]> {
  const checks: Promise<ConnectionHealth>[] = [checkDevrev(), checkPostgres(), checkClaude()];
  for (const [name, p] of Object.entries(getConnectionProjects())) {
    if (p.opensearch) checks.push(checkOpenSearch(name, p.opensearch));
    if (p.metabase) checks.push(checkMetabase(name, p.metabase));
  }
  let results = await Promise.all(checks);
  if (filter?.accountSlug) {
    const acc = getAccounts().find((a) => a.slug === filter.accountSlug);
    results = results.filter((r) => r.used_by.includes("all accounts") || (acc && r.used_by.includes(acc.name)));
    // Accounts without their own logs / DB still show those connections — as "not configured" (yellow).
    if (acc && !results.some((r) => r.kind === "opensearch")) {
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
