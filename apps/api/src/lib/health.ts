import "server-only";
import https from "node:https";
import http from "node:http";
import { execFile } from "node:child_process";
import path from "node:path";
import { adminSetting, cfgValue, getAccounts, getConnectionProjects, projectsFileExists, ROOT } from "./config";
import { getPool } from "./db";
import { settings } from "./settings";
import { ConnectorOffline, connectorMode, gatewayCarrier, gatewayViaConnector, isVpnOnlyHost, metabaseSession, needsRelay, relay, userToolEnv } from "./connector";
import { whoAmI, DevrevError } from "./devrev";
import { fallbackSummary, mainState, mainUpstream, markDown, markUp, pingMessages } from "./claudeRoute";
import { appLogProjects, ensureAppLogAuth } from "./applog";

/** fallback: the main sign-in isn't working but a fallback is carrying the work (Claude), so nothing is blocked. */
export type HealthStatus = "ok" | "vpn_required" | "auth_failed" | "not_configured" | "error" | "fallback";

export interface ConnectionHealth {
  id: string;            // e.g. "opensearch:wms", "metabase:qc", "devrev"
  kind: "devrev" | "postgres" | "claude" | "opensearch" | "metabase" | "opensearch_mcp" | "config";
  label: string;
  host?: string;
  status: HealthStatus;
  message: string;
  fix?: string;
  used_by: string[];     // account names depending on this connection
  restored_at?: string;  // Claude: the main sign-in started working again at (shown for 15 min)
}

const vpnFix = () => connectorMode()
  ? `Connect the Reliance client VPN (Cisco AnyConnect) on your laptop${cfgValue("VPN_HINT") ? ` (${cfgValue("VPN_HINT")})` : ""} and keep your local connector running (Connector page), then re-check.`
  : `Connect the Reliance client VPN (Cisco AnyConnect)${cfgValue("VPN_HINT") ? ` (${cfgValue("VPN_HINT")})` : ""}, then re-check.`;
const TIMEOUT_MS = 12000;

function hostOf(url?: string) {
  try {
    return url ? new URL(url).host : undefined;
  } catch {
    return url;
  }
}

const looksVpnOnly = (host?: string) => isVpnOnlyHost(host);

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
    label: `OpenSearch logs · ${cfg.display_name || project}`,
    host,
    used_by: usersOf((a) => logTypes.includes(a.opensearch_log_type || "") || Object.values(a.opensearch_log_types).some((l) => logTypes.includes(l))),
  };
  if (!url) return { ...base, status: "not_configured", message: "Address not set", fix: "Add its address in Admin → Connections → OpenSearch" };
  const user = cfgValue(cfg.username_env);
  const pass = cfgValue(cfg.password_env);
  if (cfg.username_env && (!user || !pass)) {
    return { ...base, status: "auth_failed", message: "Username / password not set", fix: "Add them in Admin → Connections → OpenSearch" };
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
      return { ...base, status: "auth_failed", message: `HTTP ${res.status} from ${host}`, fix: "Update the username / password in Admin → Connections → OpenSearch" };
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
    label: `Metabase DB · ${cfg.display_name || project}`,
    host,
    used_by: usersOf((a) => a.metabase_project === project),
  };
  if (!url) return Promise.resolve({ ...base, status: "not_configured", message: "Address not set", fix: "Add its address in Admin → Connections → Metabase" });
  const script = path.join(ROOT, ".claude/skills/metabase-sql/query.py");
  if (connectorMode() && cfg.sso === "google" && !(viewer && metabaseSession(viewer, project))) {
    return Promise.resolve({ ...base, status: "auth_failed", message: "You haven't signed in to it with Google yet",
      fix: `Sign in to ${project} with Google from your local connector (Connector page)` });
  }
  return new Promise((resolve) => {
    execFile("python3", [script, "whoami", "--project", project], { env: userToolEnv(viewer) as NodeJS.ProcessEnv, timeout: TIMEOUT_MS + 3000 }, (error, stdout, stderr) => {
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
            : "Update the username / password in Admin → Connections → Metabase",
        });
      }
      resolve({ ...base, status: "error", message: out.trim().slice(0, 200) || String(error) });
    });
  });
}

export async function checkDevrev(): Promise<ConnectionHealth> {
  const base = { id: "devrev", kind: "devrev" as const, label: "DevRev API", host: new URL(settings.devrevApiUrl()).host, used_by: ["all accounts"] };
  try {
    const me = await whoAmI();
    return { ...base, status: "ok", message: `Authenticated as ${me.dev_user.display_name}` };
  } catch (e) {
    const err = e as DevrevError;
    if (err.tag === "AUTH_FAILED") return { ...base, status: "auth_failed", message: err.message, fix: "Paste a new token in Admin → Connections → DevRev" };
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

/**
 * Claude: the main sign-in's own check, plus the fallback picture — "using the fallback" while the main one is down (work
 * carries on), and "working fine again" for a while after it comes back. Also tells the relay what it found, so a request
 * never waits on a sign-in this check already knows is down.
 */
export async function checkClaude(): Promise<ConnectionHealth> {
  let r = await checkMainClaude();
  const main = mainUpstream();
  if (!main) return r;
  // A gateway can answer the key check and still refuse what the agent asks for (e.g. the model isn't allowed for the
  // key): try one tiny real request, and report its refusal.
  if (r.status === "ok" && main.base !== "https://api.anthropic.com" && !(main.viaExtension && !gatewayCarrier(null, { vpnChecked: true }))) {
    const p = await pingMessages(main).catch((e: Error) => ({ ok: false, status: 0, error: e.message }));
    if (!p.ok && p.status) {
      const model = adminSetting("DEV_RESOLVE_MODEL") || "claude-opus-5-5";
      r = { ...r, status: p.status === 401 || p.status === 403 ? "auth_failed" : "error",
        message: `${main.label} refused the request (HTTP ${p.status})${p.error ? `: ${p.error.slice(0, 160)}` : ""}`,
        fix: p.status === 403 || /model|provider/i.test(p.error)
          ? `The ${main.label} key isn't allowed to use ${model} — ask the ${main.label} owners to allow it for this key, or pick another model under Edit`
          : `Check the ${main.label} key under Edit` };
    }
  }
  if (r.status === "ok") markUp("main");
  else if (r.status === "error" || r.status === "auth_failed") markDown(main, r.message);
  const fb = fallbackSummary();
  if (r.status !== "ok" && fb) {
    return { ...r, status: "fallback", message: `${main.label} isn't working (${r.message}) — investigations use ${fb} instead, without delay`,
      fix: `${r.fix ? `${r.fix}. ` : ""}Nothing is blocked meanwhile; it switches back by itself once ${main.label} works again.` };
  }
  const st = mainState();
  if (r.status === "ok" && !st.down && st.restoredAt) {
    const at = new Date(st.restoredAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
    return { ...r, message: `Claude connection is working fine again since ${at} — back on ${main.label}`, restored_at: new Date(st.restoredAt).toISOString() };
  }
  return r;
}

async function checkMainClaude(): Promise<ConnectionHealth> {
  const base = { id: "claude", kind: "claude" as const, label: "Claude (investigation agent)", host: new URL(settings.anthropicApiUrl()).host, used_by: ["all accounts"] };
  const key = adminSetting("ANTHROPIC_API_KEY");
  if (!key) {
    // Server without an API key: a long-lived token from `claude setup-token` (your Claude subscription login).
    if (adminSetting("CLAUDE_CODE_OAUTH_TOKEN")) return { ...base, status: "ok", message: "Using your Claude login token" };
    if (process.env.NODE_ENV === "production") {
      return { ...base, status: "auth_failed", message: "No Claude login on this server",
        fix: "Add an API key (or a `claude setup-token` login token) in Admin → Connections → Claude" };
    }
    return { ...base, status: "ok", message: "Using this computer's Claude Code login" };
  }
  // Through an API gateway (e.g. Bifrost) when one is set: same Anthropic API, different address and key.
  const gateway = adminSetting("ANTHROPIC_BASE_URL")?.replace(/\/+$/, "");
  const api = gateway || settings.anthropicApiUrl();
  const headers: Record<string, string> = { "x-api-key": key, "anthropic-version": "2023-06-01", ...(key.startsWith("sk-bf-") && { "x-bf-vk": key }) };
  // A VPN-only gateway is checked through someone's Dev Resolve extension, the same way the agent reaches it.
  const carrier = gateway && gatewayViaConnector() ? gatewayCarrier(null, { vpnChecked: true }) : undefined;
  if (carrier === null) return { ...base, host: new URL(gateway!).host, status: "error", message: `Nobody's Dev Resolve extension is on the company VPN (Pritunl) to reach ${new URL(gateway!).host}`,
    fix: "Open Chrome with the Dev Resolve extension (1.2 or newer) on a laptop connected to the company VPN (Pritunl) — investigations need one online" };
  // No names here (everyone sees this check): whose laptop carries it is shown in Admin → Claude only.
  const where = gateway ? ` via ${new URL(gateway).host}${carrier ? " (through the Dev Resolve extension)" : ""}` : "";
  const call = async (url: string, init: { method?: string; headers: Record<string, string>; body?: string; ms: number }) => {
    if (!carrier) return fetch(url, { method: init.method, headers: init.headers, body: init.body, cache: "no-store", signal: AbortSignal.timeout(init.ms) });
    const r = await relay(carrier, { method: init.method || "GET", url, headers: init.headers, body_b64: init.body && Buffer.from(init.body).toString("base64"), timeout_ms: init.ms });
    return { status: r.status, ok: r.status >= 200 && r.status < 300 };
  };
  try {
    let res = await call(`${api}/v1/models?limit=1`, { headers, ms: 15_000 });
    // Some gateways don't list models: try the smallest possible request instead.
    if (gateway && (res.status === 404 || res.status === 405)) {
      res = await call(`${api}/v1/messages`, { method: "POST", ms: 30_000, headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({ model: adminSetting("DEV_RESOLVE_MODEL") || "claude-opus-5-5", max_tokens: 1, messages: [{ role: "user", content: "ping" }] }) });
    }
    if (res.status === 401 || res.status === 403) return { ...base, ...(gateway && { host: new URL(gateway).host }), status: "auth_failed", message: `HTTP ${res.status}${where}`, fix: `The ${gateway ? "gateway" : "API"} refused the key — paste a valid one in Admin → Connections → Claude` };
    if (!res.ok) return { ...base, ...(gateway && { host: new URL(gateway).host }), status: "error", message: `HTTP ${res.status}${where}${gateway ? " — check the gateway address (it usually ends in /anthropic)" : ""}` };
    return { ...base, ...(gateway && { host: new URL(gateway).host }), status: "ok", message: `API key valid${where}` };
  } catch (e) {
    if (carrier) return { ...base, host: new URL(gateway!).host, status: "error", message: `Can't reach ${new URL(gateway!).host} through the Dev Resolve extension`,
      fix: "Check that the laptop carrying it is on the company VPN (Pritunl) — see Admin → Claude → Through — and that its extension was downloaded after this was switched on" };
    if (gateway) return { ...base, host: new URL(gateway).host, status: "error", message: `Can't reach ${new URL(gateway).host}`,
      fix: "This server can't reach the gateway — gateways on a private network (e.g. Bifrost behind Pritunl VPN) must allow this server first, or turn on \"Reach it through the Dev Resolve extension\" in Admin → Connections → Claude" };
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
        id: `opensearch_mcp:${p.name}`, kind: "opensearch_mcp", label: `${p.display_name || "Shipsy"} · OpenSearch (app logs)`, host: hostOf(p.args.find((a) => a.startsWith("https://"))),
        used_by: getAccounts().filter((a) => a.status === "active" && a.app_log?.project === p.name).map((a) => a.name),
        status: r.ok ? "ok" : r.status, message: r.message,
        ...(r.ok ? {} : { fix: connectorMode() ? "Sign in to app logs from your local connector (Connector page)" : `Run in a terminal: ${p.login_command}  (signs in with your Shipsy Google account)` }),
      }))),
    );
  }
  if (!projectsFileExists()) {
    checks.push(Promise.resolve({ id: "config", kind: "config", label: "Private config", status: "not_configured", used_by: ["all accounts"],
      message: "projects.json hasn't been uploaded to this server", fix: "An admin restores it in Admin → Files & extension → Private files" } as ConnectionHealth));
  }
  let results = await Promise.all(checks);
  if (filter?.accountSlug) {
    results = results.filter((r) => r.used_by.includes("all accounts") || (acc && r.used_by.includes(acc.name)));
    // Accounts without their own logs / DB still show those connections — as "not configured" (yellow).
    if (acc && !results.some((r) => r.kind === "opensearch" || r.kind === "opensearch_mcp")) {
      results.push({
        id: `opensearch:${acc.slug}`, kind: "opensearch", label: "OpenSearch logs", status: "not_configured", used_by: [acc.name],
        message: `No log connection configured for ${acc.name}`,
        fix: "Pick its logs in Admin → Clients (add the connection in Admin → Connections first)",
      });
    }
    if (acc && !results.some((r) => r.kind === "metabase")) {
      results.push({
        id: `metabase:${acc.slug}`, kind: "metabase", label: "Metabase DB", status: "not_configured", used_by: [acc.name],
        message: `No database connection configured for ${acc.name}`,
        fix: "Pick its database in Admin → Clients (add the connection in Admin → Connections first)",
      });
    }
  }
  return results;
}
