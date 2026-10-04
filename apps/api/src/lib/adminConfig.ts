import "server-only";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { Account, CONFIG_DIR, cfgValue, getConnectionProjects, loadProjectsFile, readConfigEnv } from "./config";
import { ConnectorOffline, connectorMode, isVpnOnlyHost, relay, vpnExcluded } from "./connector";
import { appLogProjects, ensureAppLogAuth } from "./applog";
import { savePrivate } from "./privateStore";

/**
 * Admin editing of clients (accounts) and connections (OpenSearch clusters / Metabase instances), from the UI.
 * Writes config/projects.json + config/config.env (secrets) atomically and saves both to Postgres.
 * Secrets are write-only: reads return whether each one is set, never its value.
 */
const PROJECTS_FILE = path.join(CONFIG_DIR, "projects.json");
const ENV_FILE = path.join(CONFIG_DIR, "config.env");

export const envPrefix = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");
export const slugify = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

// ── files ─────────────────────────────────────────────────────────────────────────────────────────────────
async function writeProjects(file: ReturnType<typeof loadProjectsFile>, by: string) {
  const tmp = `${PROJECTS_FILE}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(file, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, PROJECTS_FILE);
  await savePrivate(PROJECTS_FILE, by);
}

/** Set / replace / remove (null) keys in config.env, keeping comments and order. */
export async function writeEnv(updates: Record<string, string | null>, by: string) {
  const lines = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8").split("\n") : [];
  const done = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=/);
    if (m && m[1] in updates) {
      done.add(m[1]);
      if (updates[m[1]] !== null) out.push(`${m[1]}=${updates[m[1]]}`);
    } else out.push(line);
  }
  const added = Object.entries(updates).filter(([k, v]) => !done.has(k) && v !== null);
  if (added.length) {
    while (out.length && out[out.length - 1] === "") out.pop();
    out.push("", `# added in Dev Resolve admin (${new Date().toISOString().slice(0, 10)})`, ...added.map(([k, v]) => `${k}=${v}`));
  }
  const tmp = `${ENV_FILE}.tmp-${process.pid}`;
  writeFileSync(tmp, out.join("\n").replace(/\n*$/, "\n"), { mode: 0o600 });
  renameSync(tmp, ENV_FILE);
  await savePrivate(ENV_FILE, by);
}

const clean = (v: unknown) => String(v ?? "").replace(/[\r\n]/g, "").trim();

// ── VPN ───────────────────────────────────────────────────────────────────────────────────────────────────
export const vpnSuffixes = () => (cfgValue("VPN_HOST_SUFFIXES") || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const hostOf = (u?: string) => { try { return u ? new URL(u).hostname.toLowerCase() : ""; } catch { return ""; } };
export const isVpnHost = (host: string) => isVpnOnlyHost(host);
/** The suffix that covers this host, or null. */
const coveringSuffix = (host: string) => vpnSuffixes().find((s) => host.endsWith(s)) ?? null;

/**
 * Switch one host's VPN flag. On: covered by a suffix, or added as its own entry. Off: its own entry is removed, and if a
 * shared suffix (.example.com) still covers it, the host goes on the exception list instead of dropping the suffix.
 */
async function setVpn(host: string, on: boolean, by: string) {
  if (!host) return;
  const list = vpnSuffixes(), skip = vpnExcluded().filter((h) => h !== host);
  if (on && !coveringSuffix(host)) list.push(host);
  if (!on) {
    const i = list.indexOf(host);
    if (i >= 0) list.splice(i, 1);
    if (list.some((s) => host.endsWith(s))) skip.push(host);
  }
  await writeEnv({ VPN_HOST_SUFFIXES: list.join(","), VPN_HOST_EXCLUDE: skip.length ? skip.join(",") : null }, by);
}

// ── read model for the admin UI ───────────────────────────────────────────────────────────────────────────
type Gateway = NonNullable<ReturnType<typeof getConnectionProjects>[string]["opensearch_mcp"]>;
/** The env key holding the app-log gateway's address (the `${...}` URL argument in projects.json). */
const gatewayUrlEnv = (g: Gateway) => g.args.map((a) => a.match(/^\$\{([A-Z0-9_]*URL[A-Z0-9_]*)\}$/)?.[1]).find(Boolean) ?? "APP_LOG_MCP_URL";
/** Index patterns of a Google-login (gateway) connection: the saved list, else the ones its clients already use. */
export function gatewayPatterns(name: string, g: Gateway) {
  if (g.index_patterns?.length) return g.index_patterns;
  return Array.from(new Set(loadProjectsFile().accounts.filter((a) => a.app_log?.project === name).flatMap((a) => Object.values(a.app_log!.indices)))).sort();
}
function gatewaySummary(name: string, g: Gateway, env: Record<string, string>) {
  const url = env[gatewayUrlEnv(g)] ?? "";
  return { displayName: g.display_name || name, url, host: hostOf(url), vpn: isVpnHost(hostOf(url)), vpnSuffix: coveringSuffix(hostOf(url)), auth: "google" as const,
    usernameSet: false, passwordSet: false, logTypes: {} as Record<string, string>, patterns: gatewayPatterns(name, g) };
}

export function connectionsSummary() {
  const env = { ...readConfigEnv(), ...(process.env as Record<string, string>) };
  const isSet = (k?: string | null) => !!(k && env[k]);
  return Object.entries(getConnectionProjects()).map(([name, p]) => {
    const os = p.opensearch, mb = p.metabase as (NonNullable<typeof p.metabase> & { api_key_env?: string; sso?: string }) | undefined;
    const osUrl = os ? env[os.url_env] : undefined, mbUrl = mb ? env[mb.base_url_env] : undefined;
    const mbKey = mb ? mb.api_key_env || (mb.session_token_env || `${envPrefix(name)}_METABASE_SESSION_TOKEN`).replace(/_SESSION_TOKEN$/, "_API_KEY") : undefined;
    return {
      name, label: p.label ?? "",
      opensearch: os && {
        displayName: os.display_name || name, url: osUrl ?? "", host: hostOf(osUrl), vpn: isVpnHost(hostOf(osUrl)), vpnSuffix: coveringSuffix(hostOf(osUrl)),
        auth: os.username_env ? "password" : "none", usernameSet: isSet(os.username_env), passwordSet: isSet(os.password_env),
        logTypes: os.log_types, patterns: Array.from(new Set(Object.values(os.log_types))),
      },
      ...(p.opensearch_mcp && !os ? { opensearch: gatewaySummary(name, p.opensearch_mcp, env) } : {}),
      metabase: mb && {
        displayName: mb.display_name || name, url: mbUrl ?? "", host: hostOf(mbUrl), vpn: isVpnHost(hostOf(mbUrl)), vpnSuffix: coveringSuffix(hostOf(mbUrl)),
        auth: mb.sso === "google" ? "google" : isSet(mbKey) ? "api_key" : "password",
        usernameSet: isSet(mb.username_env), passwordSet: isSet(mb.password_env), apiKeySet: isSet(mbKey),
        databases: mb.databases ?? {}, defaultDatabase: mb.default_database ?? null,
      },
      appLog: !!p.opensearch_mcp,
    };
  });
}

export function adminConfig() {
  const file = loadProjectsFile();
  const repos = new Set<string>(["stockone-neo"]);
  for (const a of file.accounts) for (const r of a.code_repos || []) repos.add(r);
  return {
    accounts: file.accounts.map((a) => ({ ...a, wms_tickets_seen: undefined })),
    connections: connectionsSummary(),
    vpnSuffixes: vpnSuffixes(),
    repos: [...repos],
    connectorMode: connectorMode(),
  };
}

// ── save a client ─────────────────────────────────────────────────────────────────────────────────────────
export interface AccountInput {
  slug?: string; name: string; group?: string | null; client_active?: boolean; code_repos?: string[];
  extra_sources?: { name: string; url?: string; notes?: string }[];
  devrev: { account_ids: string[]; names: string[] };
  logs: { kind: "none" } | { kind: "opensearch"; project: string; log_types: Record<string, string> }
    | { kind: "app_log"; project: string; indices: Record<string, string>; company: string[]; warehouses: string[] };
  db: { kind: "none" } | { kind: "metabase"; project: string; database: number; databases: Record<string, number>; shared?: boolean };
}

export async function saveAccount(input: AccountInput, originalSlug: string | null, by: string) {
  const file = loadProjectsFile();
  const projects = getConnectionProjects();
  const name = clean(input.name);
  if (!name) throw new Error("Name is required");
  const slug = slugify(input.slug || name);
  if (!slug) throw new Error("Name must contain letters or digits");
  const existing = originalSlug ? file.accounts.find((a) => a.slug === originalSlug) : undefined;
  if (originalSlug && !existing) throw new Error(`No client "${originalSlug}"`);
  if (file.accounts.some((a) => a.slug === slug && a !== existing)) throw new Error(`A client with id "${slug}" already exists`);
  const ids = (input.devrev?.account_ids || []).map(clean).filter(Boolean);
  if (!ids.length) throw new Error("Pick at least one DevRev account — that's how tickets find this client");
  for (const other of file.accounts) {
    if (other === existing) continue;
    const dup = other.devrev.account_ids.find((id) => ids.includes(id));
    if (dup) throw new Error(`DevRev account ${dup.slice(-8)} already belongs to "${other.name}"`);
  }

  const acc: Account = {
    ...(existing ?? {}),
    name, slug, group: input.group ? clean(input.group) : null,
    status: "awaiting_credentials",
    devrev: { account_ids: ids, names: (input.devrev.names || []).map(clean).slice(0, ids.length) },
    opensearch_log_type: null, opensearch_log_types: {},
    metabase_project: null, metabase_database: null, metabase_databases: {},
    code_repos: (input.code_repos?.length ? input.code_repos : ["stockone-neo"]).map(clean).filter(Boolean),
    knowledge_dir: existing?.knowledge_dir || `knowledge/${slug}`,
    client_active: input.client_active !== false,
    extra_sources: (input.extra_sources || []).map((x) => ({ name: clean(x.name), url: clean(x.url || ""), notes: String(x.notes || "").trim().slice(0, 2000) }))
      .filter((x) => x.name).slice(0, 20),
  } as Account;
  const prevNote = existing?._shared_db_note;
  delete acc.app_log;
  delete acc._shared_db_note;

  if (input.logs.kind === "opensearch") {
    const p = projects[input.logs.project]?.opensearch;
    if (!p) throw new Error(`"${input.logs.project}" isn't an OpenSearch connection`);
    const lt = Object.fromEntries(Object.entries(input.logs.log_types || {}).filter(([, v]) => v && p.log_types[v]));
    if (!Object.keys(lt).length) throw new Error("Pick at least one log type for the logs connection");
    acc.opensearch_log_types = lt;
    acc.opensearch_log_type = lt.app || Object.values(lt)[0];
  } else if (input.logs.kind === "app_log") {
    if (!projects[input.logs.project]?.opensearch_mcp) throw new Error(`"${input.logs.project}" isn't an app-logs connection`);
    const indices: Record<string, string> = Object.fromEntries(
      Object.entries(input.logs.indices || {}).map(([k, v]): [string, string] => [k, clean(v)]).filter(([, v]) => v));
    if (!indices.app) throw new Error("App logs need at least the app index pattern (e.g. app-logs-<service>-*)");
    for (const v of Object.values(indices)) if (/^\*|^app-logs-\*$/.test(v)) throw new Error(`Index pattern "${v}" is too broad — use the client's own deployment prefix`);
    const company = (input.logs.company || []).map(clean).filter(Boolean);
    acc.app_log = { project: input.logs.project, indices, company: company.length > 1 ? company : company[0] ?? null,
      ...(input.logs.warehouses?.length ? { warehouses: input.logs.warehouses.map(clean).filter(Boolean) } : {}) };
  }

  if (input.db.kind === "metabase") {
    const p = projects[input.db.project]?.metabase;
    if (!p) throw new Error(`"${input.db.project}" isn't a Metabase connection`);
    const dbId = Number(input.db.database);
    if (!Number.isInteger(dbId) || dbId <= 0) throw new Error("Database id must be a number (Metabase → Admin → Databases → the id in the URL)");
    acc.metabase_project = input.db.project;
    acc.metabase_database = dbId;
    acc.metabase_databases = Object.fromEntries(
      Object.entries(input.db.databases || {}).map(([k, v]): [string, number] => [clean(k), Number(v)]).filter(([k, v]) => k && Number.isInteger(v)));
    if (input.db.shared) acc._shared_db_note = prevNote || "Shared database — restrict every query to this client's company / warehouses.";
  }
  if (acc.opensearch_log_type || acc.app_log || acc.metabase_project) acc.status = "active";

  if (existing) Object.assign(existing, acc);
  else file.accounts.push(acc);
  if (existing && originalSlug !== slug) {
    for (const a of file.accounts) if (a === existing) a.slug = slug;
  }
  await writeProjects(file, by);
  return acc;
}

// ── save a connection ─────────────────────────────────────────────────────────────────────────────────────
/**
 * Admins only see index patterns; the agent still refers to each by a short name (log type). Keep the names of
 * patterns that stay, make one up for new ones, and refuse to drop a pattern a client still uses.
 */
function patternKeys(conn: string, current: Record<string, string>, patterns: string[], accounts: Account[]) {
  const want = Array.from(new Set(patterns.map(clean).filter(Boolean)));
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(current)) if (want.includes(v) && !Object.values(out).includes(v)) out[k] = v;
  for (const pat of want) {
    if (Object.values(out).includes(pat)) continue;
    const base = `${conn}_${slugify(pat.replace(/\*/g, " ")).replace(/-/g, "_")}`.slice(0, 60).replace(/_+$/, "") || `${conn}_logs`;
    let k = base, n = 2;
    while (k in out || k in current) k = `${base}_${n++}`;
    out[k] = pat;
  }
  const dropped = Object.keys(current).filter((k) => !(k in out));
  const using = accounts.filter((a) => Object.values(a.opensearch_log_types ?? {}).some((k) => dropped.includes(k)));
  if (using.length) throw new Error(`Can't remove ${dropped.map((k) => current[k]).join(", ")} — used by ${using.map((a) => a.name).join(", ")}. Change those clients first.`);
  return out;
}

export interface ConnectionInput {
  name?: string; label?: string; kind: "opensearch" | "metabase"; url: string; vpn: boolean;
  display_name?: string;                                   // what admins call it; the id (name) never changes
  auth: "none" | "password" | "api_key" | "google";
  username?: string; password?: string; apiKey?: string; // empty = keep what's stored
  log_types?: Record<string, string>;                      // opensearch (older form): log type → index pattern
  patterns?: string[];                                     // opensearch: the index patterns clients pick from
  databases?: Record<string, string>; default_database?: number | null; // metabase: id → label
}

export async function saveConnection(input: ConnectionInput, originalName: string | null, by: string) {
  const file = loadProjectsFile() as Record<string, unknown> & ReturnType<typeof loadProjectsFile>;
  const name = originalName || slugify(input.name || "").replace(/-/g, "_");
  if (!name || ["accounts", "devrev_view", "devrev_routing"].includes(name) || name.startsWith("_")) throw new Error("Give the connection a name (letters, digits, _)");
  const url = clean(input.url).replace(/\/+$/, "");
  if (!/^https?:\/\/[^/]+/.test(url)) throw new Error("URL must start with https:// (or http://)");
  const P = envPrefix(name);
  const proj = ((file[name] as Record<string, unknown>) ?? {}) as Record<string, unknown>;
  if (!originalName && file[name]) {
    const has = (proj as { opensearch?: unknown; metabase?: unknown })[input.kind];
    if (has) throw new Error(`A connection named "${name}" already exists`);
  }
  const env: Record<string, string | null> = {};

  if (input.kind === "opensearch" && (proj.opensearch_mcp || input.auth === "google")) {
    // Google login = the Shipsy app-log gateway: each person signs in with their own Google account.
    const g = proj.opensearch_mcp as Gateway | undefined;
    if (!g) throw new Error("Google login for OpenSearch works through the Shipsy app-log gateway only — pick No auth or Username + password");
    if (input.auth !== "google") throw new Error("This connection is the Google-login app-log gateway — its sign-in can't be changed");
    const patterns = Array.from(new Set((input.patterns ?? []).map(clean).filter(Boolean)));
    if (!patterns.length) throw new Error("Add at least one index pattern");
    const gone = gatewayPatterns(name, g).filter((x) => !patterns.includes(x));
    const using = file.accounts.filter((a) => a.app_log?.project === name && Object.values(a.app_log.indices).some((i) => gone.includes(i)));
    if (using.length) throw new Error(`Can't remove ${gone.join(", ")} — used by ${using.map((a) => a.name).join(", ")}. Change those clients first.`);
    g.index_patterns = patterns;
    if (input.display_name !== undefined) g.display_name = clean(input.display_name) || undefined;
    env[gatewayUrlEnv(g)] = clean(input.url); // as typed: the gateway's address ends in "/mcp/" and needs that last "/"
  } else if (input.kind === "opensearch") {
    const cur = (proj.opensearch as Record<string, unknown>) ?? {};
    const urlEnv = (cur.url_env as string) || `${P}_OS_URL`;
    const userEnv = (cur.username_env as string) || `${P}_OS_USERNAME`, passEnv = (cur.password_env as string) || `${P}_OS_PASSWORD`;
    const lt = input.patterns ? patternKeys(name, (cur.log_types as Record<string, string>) ?? {}, input.patterns, file.accounts)
      : Object.fromEntries(Object.entries(input.log_types || {}).map(([k, v]) => [slugify(k).replace(/-/g, "_"), clean(v)]).filter(([k, v]) => k && v));
    if (!Object.keys(lt).length) throw new Error("Add at least one index pattern (e.g. app-logs-acme-*)");
    env[urlEnv] = url;
    if (input.auth === "password") {
      if (input.username) env[userEnv] = clean(input.username);
      if (input.password) env[passEnv] = clean(input.password);
    }
    proj.opensearch = { display_name: clean(input.display_name ?? (cur.display_name as string) ?? "") || undefined, url_env: urlEnv, username_env: input.auth === "password" ? userEnv : null, password_env: input.auth === "password" ? passEnv : null, log_types: lt };
  } else {
    const cur = (proj.metabase as Record<string, unknown>) ?? {};
    const urlEnv = (cur.base_url_env as string) || `${P}_METABASE_BASE_URL`;
    const sessEnv = (cur.session_token_env as string) || `${P}_METABASE_SESSION_TOKEN`;
    const keyEnv = (cur.api_key_env as string) || sessEnv.replace(/_SESSION_TOKEN$/, "_API_KEY");
    const userEnv = (cur.username_env as string) || `${P}_METABASE_USERNAME`, passEnv = (cur.password_env as string) || `${P}_METABASE_PASSWORD`;
    env[urlEnv] = url;
    if (input.auth === "password") { if (input.username) env[userEnv] = clean(input.username); if (input.password) env[passEnv] = clean(input.password); }
    if (input.auth === "api_key" && input.apiKey) env[keyEnv] = clean(input.apiKey);
    if (input.auth !== "api_key") env[keyEnv] = null; // an API key would override the other sign-in types
    const dbs = Object.fromEntries(Object.entries(input.databases || {}).map(([k, v]) => [String(Number(k)), clean(v)]).filter(([k]) => Number(k) > 0));
    proj.metabase = {
      ...cur, display_name: clean(input.display_name ?? (cur.display_name as string) ?? "") || undefined, base_url_env: urlEnv, username_env: userEnv, password_env: passEnv, session_token_env: sessEnv,
      ...(input.auth === "api_key" ? { api_key_env: keyEnv } : {}),
      default_database: input.default_database ?? (Object.keys(dbs)[0] ? Number(Object.keys(dbs)[0]) : null),
      databases: dbs,
      ...(input.auth === "google" ? { sso: "google" } : { sso: undefined }),
    };
  }
  if (input.label !== undefined) proj.label = clean(input.label);
  file[name] = proj;
  await writeEnv(env, by);
  await setVpn(hostOf(url), input.vpn, by);
  await writeProjects(file, by);
  return name;
}

/** A saved username / password / API key, for an admin who clicks the eye in Admin → Connections. */
export function revealSecret(name: string, kind: "opensearch" | "metabase", field: "username" | "password" | "apiKey") {
  const p = getConnectionProjects()[name];
  const env = { ...readConfigEnv(), ...(process.env as Record<string, string>) };
  const x = (kind === "opensearch" ? p?.opensearch : p?.metabase) as { username_env?: string | null; password_env?: string | null; api_key_env?: string; session_token_env?: string } | undefined;
  if (!x) return null;
  const key = field === "username" ? x.username_env : field === "password" ? x.password_env
    : x.api_key_env || (x.session_token_env || "").replace(/_SESSION_TOKEN$/, "_API_KEY");
  return key ? env[key] ?? null : null;
}

// ── test a connection (through the admin's own extension when it's a VPN host) ────────────────────────────
function request(viewer: string, opt: { method: string; url: string; headers: Record<string, string>; body?: string }) {
  if (connectorMode() && isVpnHost(hostOf(opt.url))) {
    return relay(viewer, { ...opt, body_b64: opt.body ? Buffer.from(opt.body).toString("base64") : undefined, timeout_ms: 15000, insecure: true })
      .then((r) => ({ status: r.status, text: Buffer.from(r.body_b64, "base64").toString() }));
  }
  return new Promise<{ status: number; text: string }>((resolve, reject) => {
    const u = new URL(opt.url);
    const lib = u.protocol === "http:" ? http : https;
    const r = lib.request({ method: opt.method, hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, headers: opt.headers, rejectUnauthorized: false, timeout: 15000 },
      (res) => { let t = ""; res.on("data", (c) => (t += c)); res.on("end", () => resolve({ status: res.statusCode || 0, text: t })); });
    r.on("timeout", () => r.destroy(new Error("timed out")));
    r.on("error", reject);
    if (opt.body) r.write(opt.body);
    r.end();
  });
}

/** The databases a Metabase instance has (id + name), so admins pick them instead of typing ids. */
async function metabaseDatabases(viewer: string, url: string, headers: Record<string, string>) {
  try {
    const r = await request(viewer, { method: "GET", url: `${url}/api/database`, headers });
    if (r.status !== 200) return undefined;
    const d = JSON.parse(r.text) as { data?: { id: number; name: string }[] } | { id: number; name: string }[];
    return (Array.isArray(d) ? d : d.data ?? []).map((x) => ({ id: x.id, name: x.name }));
  } catch { return undefined; }
}

export async function testConnection(input: ConnectionInput & { existing?: string }, viewer: string) {
  const env = { ...readConfigEnv(), ...(process.env as Record<string, string>) };
  const cur = input.existing ? getConnectionProjects()[input.existing] : undefined;
  const url = clean(input.url).replace(/\/+$/, "");
  try {
    if (input.kind === "opensearch" && input.auth === "google") {
      const g = appLogProjects().find((p) => p.name === input.existing);
      if (!g) return { ok: false, message: "Google login works through the Shipsy app-log gateway only" };
      const a = await ensureAppLogAuth(g, viewer);
      return a.ok ? { ok: true, message: `Connected with your Google sign-in · ${a.message}` } : { ok: false, message: a.message };
    }
    if (input.kind === "opensearch") {
      const user = input.username || (cur?.opensearch?.username_env ? env[cur.opensearch.username_env] : "");
      const pass = input.password || (cur?.opensearch?.password_env ? env[cur.opensearch.password_env] : "");
      const index = input.patterns?.[0] || Object.values(input.log_types || {})[0] || "*";
      const r = await request(viewer, {
        method: "POST", url,
        headers: { "Content-Type": "application/json", "osd-xsrf": "osd-fetch", "osd-version": "2.19.3",
          ...(input.auth === "password" && user && pass ? { Authorization: "Basic " + Buffer.from(`${user}:${pass}`).toString("base64") } : {}) },
        body: JSON.stringify({ params: { index, body: { size: 0, query: { range: { timestamp: { gte: "now-1h" } } } } } }),
      });
      if (r.status === 401 || r.status === 403) return { ok: false, message: `Reached it, but the username/password were refused (HTTP ${r.status})` };
      if (r.status >= 400) return { ok: false, message: `HTTP ${r.status}: ${r.text.slice(0, 160)}` };
      const total = JSON.parse(r.text)?.rawResponse?.hits?.total;
      return { ok: true, message: `Connected · ${typeof total === "object" ? total.value : total ?? "?"} log lines in the last hour for "${index}"` };
    }
    if (input.auth === "google") {
      const r = await request(viewer, { method: "GET", url: `${url}/api/health`, headers: {} });
      return r.status === 200 ? { ok: true, message: "Reachable · each person signs in with their own Google account (Connector page)" }
        : { ok: false, message: `Not reachable (HTTP ${r.status})` };
    }
    if (input.auth === "api_key") {
      const key = input.apiKey || (cur?.metabase ? env[(cur.metabase as { api_key_env?: string }).api_key_env || (cur.metabase.session_token_env || "").replace(/_SESSION_TOKEN$/, "_API_KEY")] : "");
      if (!key) return { ok: false, message: "Enter the API key" };
      const r = await request(viewer, { method: "GET", url: `${url}/api/user/current`, headers: { "X-API-Key": key } });
      if (r.status !== 200) return { ok: false, message: `API key refused (HTTP ${r.status})` };
      return { ok: true, message: "Connected with the API key", databases: await metabaseDatabases(viewer, url, { "X-API-Key": key }) };
    }
    const user = input.username || (cur?.metabase?.username_env ? env[cur.metabase.username_env] : "");
    const pass = input.password || (cur?.metabase?.password_env ? env[cur.metabase.password_env] : "");
    if (!user || !pass) return { ok: false, message: "Enter the username and password" };
    const r = await request(viewer, { method: "POST", url: `${url}/api/session`, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: user, password: pass }) });
    if (r.status !== 200) return { ok: false, message: `Sign-in refused (HTTP ${r.status}): ${r.text.slice(0, 120)}` };
    const session = (JSON.parse(r.text) as { id?: string }).id;
    return { ok: true, message: `Signed in as ${user}`, databases: session ? await metabaseDatabases(viewer, url, { "X-Metabase-Session": session }) : undefined };
  } catch (e) {
    if (e instanceof ConnectorOffline) return { ok: false, message: "This host needs the company VPN — your Chrome extension isn't running" };
    return { ok: false, message: `${(e as NodeJS.ErrnoException).code || ""} ${(e as Error).message}${isVpnHost(hostOf(url)) ? " — is the VPN connected?" : ""}`.trim() };
  }
}
