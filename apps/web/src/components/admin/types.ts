export interface OsConn { url: string; host: string; vpn: boolean; vpnSuffix: string | null; auth: "none" | "password" | "google"; usernameSet: boolean; passwordSet: boolean; logTypes: Record<string, string>; patterns: string[] }
export interface MbConn { url: string; host: string; vpn: boolean; vpnSuffix: string | null; auth: "google" | "api_key" | "password"; usernameSet: boolean; passwordSet: boolean; apiKeySet: boolean; databases: Record<string, string>; defaultDatabase: number | null }
export interface Conn { name: string; label: string; opensearch?: OsConn; metabase?: MbConn; appLog: boolean }
export interface Acc {
  name: string; slug: string; group: string | null; status: string; client_active?: boolean;
  devrev: { account_ids: string[]; names: string[] };
  opensearch_log_type: string | null; opensearch_log_types: Record<string, string>;
  metabase_project: string | null; metabase_database: number | null; metabase_databases: Record<string, number>;
  code_repos: string[]; extra_sources?: { name: string; url?: string; notes?: string }[]; app_log?: { project: string; indices: Record<string, string>; company: string | string[] | null; warehouses?: string[] };
  _shared_db_note?: string;
}
export interface AdminConfig { accounts: Acc[]; connections: Conn[]; vpnSuffixes: string[]; repos: string[]; connectorMode: boolean }
