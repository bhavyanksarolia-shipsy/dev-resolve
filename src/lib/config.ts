import "server-only";
import { readFileSync, existsSync } from "node:fs";
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
  skills?: string[];
  knowledge_dir: string;
  wms_tickets_seen?: number;
  last_ticket?: string;
}

export interface ConnectionProject {
  label?: string;
  opensearch?: {
    url_env: string;
    username_env: string | null;
    password_env: string | null;
    log_types: Record<string, string>;
  };
  metabase?: {
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

export function loadProjectsFile(): ProjectsFile {
  return JSON.parse(readFileSync(PROJECTS_FILE, "utf8"));
}

export function getDevrevView(): DevrevView {
  return loadProjectsFile().devrev_view;
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
