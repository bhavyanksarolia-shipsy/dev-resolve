import "server-only";
import { readFileSync, existsSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";

/**
 * Everything account/connection-related is read from config/projects.json on
 * every call (no caching), so adding an account or a connection project is a
 * config edit with no restart and no code change.
 */

export const ROOT = process.cwd();
export const CONFIG_DIR = process.env.DEV_RESOLVE_CONFIG_DIR || path.join(ROOT, "config");
const PROJECTS_FILE = path.join(CONFIG_DIR, "projects.json");
const CONFIG_ENV_FILE = path.join(CONFIG_DIR, "config.env");

export type AccountStatus = "active" | "awaiting_credentials" | "disabled";

export interface Account {
  name: string;
  slug: string;
  group: string | null;
  status: AccountStatus;
  devrev: { account_ids: string[]; names: string[] };
  opensearch_log_type: string | null;
  opensearch_log_types: Record<string, string>;
  metabase_project: string | null;
  metabase_database: number | null;
  metabase_databases: Record<string, number>;
  code_repos: string[];
  /** Other places the agent should know about for this client (dashboards, runbooks, portals): reference only. */
  extra_sources?: { name: string; url?: string; notes?: string }[];
  skills?: string[];
  knowledge_dir: string;
  /** Logs via the Shipsy opensearch-app-log MCP (shared application-log cluster). */
  app_log?: { project: string; indices: Record<string, string>; company: string | string[] | null; warehouses?: string[] };
  /** Business switch (Knowledge page): false = client no longer active with us. Default true. */
  client_active?: boolean;
  client_active_changed?: { by: string; at: string };
  /** Set when the account's Metabase DB is shared by several clients. */
  _shared_db_note?: string;
  wms_tickets_seen?: number;
  last_ticket?: string;
}

export interface ConnectionProject {
  label?: string;
  opensearch_mcp?: {
    command: string;
    args: string[];
    config_dir: string;
    login_command: string;
    read_only_tools: string[];
    /** What admins call it (Admin → Connections); unset = the connection's id. */
    display_name?: string;
    /** Index patterns clients can pick from (Admin → Connections); unset = the ones clients already use. */
    index_patterns?: string[];
  };
  opensearch?: {
    display_name?: string;
    url_env: string;
    username_env: string | null;
    password_env: string | null;
    log_types: Record<string, string>;
  };
  metabase?: {
    display_name?: string;
    sso?: "google";
    base_url_env: string;
    username_env?: string;
    password_env?: string;
    session_token_env?: string;
    default_database?: number;
    databases?: Record<string, string>;
  };
}

export interface DevrevView {
  name: string;
  subtype: string;
  wms_product_id: string;
  default_part_id: string;
  default_part_label: string;
  stages: string[];
}

interface ProjectsFile {
  accounts: Account[];
  devrev_view: DevrevView;
  devrev_routing?: {
    ambiguous?: { account_id: string; name: string; candidates: string[] }[];
    ignore?: { account_id: string; name: string }[];
  };
  [project: string]: unknown;
}

export const projectsFileExists = () => existsSync(PROJECTS_FILE);

/** Until an admin uploads projects.json (Settings page), the app runs with no accounts instead of crashing. */
export function loadProjectsFile(): ProjectsFile {
  if (!existsSync(PROJECTS_FILE)) {
    return { accounts: [], devrev_view: { name: "", subtype: "", wms_product_id: "", default_part_id: "", default_part_label: "", stages: [] } };
  }
  return JSON.parse(readFileSync(PROJECTS_FILE, "utf8"));
}

export function getDevrevView(): DevrevView {
  return loadProjectsFile().devrev_view;
}

/** Flip an account's "client active" switch. Writes config/projects.json atomically (tmp file + rename). */
export function setClientActive(slug: string, active: boolean, by: string) {
  const file = loadProjectsFile();
  const acc = file.accounts.find((a) => a.slug === slug);
  if (!acc) throw new Error(`unknown account ${slug}`);
  acc.client_active = active;
  acc.client_active_changed = { by, at: new Date().toISOString() };
  const tmp = `${PROJECTS_FILE}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(file, null, 2) + "\n");
  renameSync(tmp, PROJECTS_FILE);
  // Keep the database copy current (the source of truth across deploys). Lazy import: privateStore imports this file.
  void import("./privateStore").then((m) => m.savePrivate(PROJECTS_FILE, by));
  return acc;
}

export function getAccounts(): Account[] {
  return loadProjectsFile().accounts ?? [];
}

export function getAccount(slug: string): Account | undefined {
  return getAccounts().find((a) => a.slug === slug);
}

/** Connection projects = every top-level key that isn't accounts/routing/comments. */
export function getConnectionProjects(): Record<string, ConnectionProject> {
  const out: Record<string, ConnectionProject> = {};
  for (const [k, v] of Object.entries(loadProjectsFile())) {
    if (k === "accounts" || k === "devrev_routing" || k === "devrev_view" || k.startsWith("_")) continue;
    if (v && typeof v === "object") out[k] = v as ConnectionProject;
  }
  return out;
}

/** The OpenSearch connection project that owns a given log_type. */
export function projectForLogType(logType: string): string | undefined {
  for (const [name, p] of Object.entries(getConnectionProjects())) {
    if (p.opensearch?.log_types?.[logType]) return name;
  }
  return undefined;
}

export type DevrevResolution =
  | { kind: "account"; account: Account }
  | { kind: "ambiguous"; candidates: Account[]; name: string }
  | { kind: "ignored" }
  | { kind: "unmapped" };

export function resolveDevrevAccount(accountId: string | undefined): DevrevResolution {
  if (!accountId) return { kind: "unmapped" };
  const file = loadProjectsFile();
  const account = file.accounts.find((a) => a.devrev.account_ids.includes(accountId));
  if (account) return { kind: "account", account };
  const amb = file.devrev_routing?.ambiguous?.find((a) => a.account_id === accountId);
  if (amb) {
    const candidates = amb.candidates.map((s) => file.accounts.find((a) => a.slug === s)).filter(Boolean) as Account[];
    return { kind: "ambiguous", candidates, name: amb.name };
  }
  if (file.devrev_routing?.ignore?.some((a) => a.account_id === accountId)) return { kind: "ignored" };
  return { kind: "unmapped" };
}

/**
 * Can Dev Resolve investigate tickets of this DevRev account? Only for active clients: an inactive client, an account
 * not set up on a client, or an ignored org can't. An ambiguous account can if one of its possible clients is active.
 */
export function investigable(accountId: string | undefined): { ok: true } | { ok: false; reason: string } {
  const r = resolveDevrevAccount(accountId);
  if (r.kind === "account") return r.account.client_active === false ? { ok: false, reason: `${r.account.name} is an inactive client — turn it on in Admin → Clients to investigate` } : { ok: true };
  if (r.kind === "ambiguous") return r.candidates.some((c) => c.client_active !== false) ? { ok: true } : { ok: false, reason: "None of this account's possible clients is active" };
  return { ok: false, reason: "This DevRev account isn't set up on a client (Admin → Clients)" };
}

/** config/config.env — the same file the Python MCP/skills read. Values never leave the server. */
export function readConfigEnv(): Record<string, string> {
  if (!existsSync(CONFIG_ENV_FILE)) return {};
  const out: Record<string, string> = {};
  for (const raw of readFileSync(CONFIG_ENV_FILE, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const i = line.indexOf("=");
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

export function cfgValue(key: string | null | undefined): string | undefined {
  if (!key) return undefined;
  return process.env[key] || readConfigEnv()[key];
}

/** Env handed to the Python tools so they resolve this project's config/ folder. */
export function toolEnv(): Record<string, string> {
  return { ...(process.env as Record<string, string>), DEV_RESOLVE_CONFIG_DIR: CONFIG_DIR };
}

export const CODE_ROOT = process.env.CODE_ROOT || path.join(process.env.HOME || "", "Documents", "Stockone");

export const ALL_CLIENTS = "all";
/** Picker / URL value for a single DevRev account that isn't a client: "acct:<account id>". */
export const ACCOUNT_PREFIX = "acct:";
export interface TicketScope {
  slug: string; name: string;
  /** DevRev accounts to ask for; empty = every account (ALL_CLIENTS — the same tickets as DevRev's Support view). */
  ids: string[];
  /** Accounts left out of the scope (none today: All clients counts everything in DevRev's view, ignored orgs too). */
  exclude: Set<string>;
  slugs: string[]; inactive: boolean;
}
/**
 * The tickets a page is about: one client, or ALL_CLIENTS = every Support ticket in DevRev's view — inactive clients,
 * accounts that map to several clients (ambiguous), accounts not set up yet and ignored orgs (e.g. the default
 * [WMS] Shipsy account) included, so the count matches DevRev. Ignored orgs still can't be investigated.
 */
export function ticketScope(slug: string | null | undefined): TicketScope | null {
  // One DevRev account that isn't a client (not routed / not set up) — picked in the account picker as "acct:<id>".
  if (slug?.startsWith(ACCOUNT_PREFIX)) {
    const id = slug.slice(ACCOUNT_PREFIX.length);
    if (!/^don:identity:[^:]+:devo\/[^:]+:account\/[A-Za-z0-9]+$/.test(id)) return null;
    return { slug, name: "DevRev account", ids: [id], exclude: new Set(), slugs: [], inactive: false };
  }
  if (slug === ALL_CLIENTS) {
    const clients = getAccounts().filter((a) => a.devrev?.account_ids?.length);
    return { slug: ALL_CLIENTS, name: "All clients", ids: [], exclude: new Set(), slugs: clients.map((a) => a.slug), inactive: false };
  }
  const a = slug ? getAccount(slug) : undefined;
  return a ? { slug: a.slug, name: a.name, ids: a.devrev.account_ids, exclude: new Set(), slugs: [a.slug], inactive: a.client_active === false } : null;
}

/** Drop tickets of accounts a scope leaves out (see TicketScope.exclude). */
export const inTicketScope = <T extends { account?: { id?: string } | null }>(rows: T[], scope: Pick<TicketScope, "exclude">) =>
  scope.exclude.size ? rows.filter((w) => !(w.account?.id && scope.exclude.has(w.account.id))) : rows;

/** What a DevRev account is to Dev Resolve: a client, ambiguous (several possible clients), ignored, or not set up. */
export function accountRole(accountId: string | undefined): { kind: "client"; slug: string; name: string } | { kind: "ambiguous" | "unknown" | "ignored" } {
  if (!accountId) return { kind: "unknown" };
  const a = getAccounts().find((x) => x.devrev?.account_ids?.includes(accountId));
  if (a) return { kind: "client", slug: a.slug, name: a.name };
  const r = loadProjectsFile().devrev_routing;
  if (r?.ambiguous?.some((x) => x.account_id === accountId)) return { kind: "ambiguous" };
  if (r?.ignore?.some((x) => x.account_id === accountId)) return { kind: "ignored" };
  return { kind: "unknown" };
}

/** A setting an admin may change in the UI: the value saved in Admin (config.env) wins over the server variable. */
export function adminSetting(key: string): string | undefined {
  return readConfigEnv()[key] || process.env[key] || undefined;
}
