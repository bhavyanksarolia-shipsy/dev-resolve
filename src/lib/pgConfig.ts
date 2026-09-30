import { readFileSync } from "node:fs";
import type { PoolConfig } from "pg";

/**
 * Postgres connection settings, shared by the app and the migration script. All from env:
 *   DATABASE_URL                   postgres://user:pass@host:5432/db — a dedicated app role, never the superuser
 *   DATABASE_SSL                   off (local Docker) | require (encrypted) | verify-full (encrypted + server cert checked)
 *   DATABASE_CA_CERT               CA bundle file for verify-full (e.g. the AWS RDS / Cloud SQL CA)
 *   DATABASE_POOL_MAX              max connections (default 10 — a single app instance)
 *   DATABASE_STATEMENT_TIMEOUT_MS  cancel runaway queries (default 30000)
 */
export function pgConfig(url = process.env.DATABASE_URL): PoolConfig {
  if (!url) throw new Error("DATABASE_URL is not set");
  return {
    connectionString: url,
    ssl: sslConfig(),
    max: Number(process.env.DATABASE_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: Number(process.env.DATABASE_STATEMENT_TIMEOUT_MS || 30_000),
    application_name: "dev-resolve",
  };
}

function sslConfig(): PoolConfig["ssl"] {
  const mode = (process.env.DATABASE_SSL || "off").toLowerCase();
  if (mode === "off" || mode === "disable") return undefined;
  if (mode === "require") return { rejectUnauthorized: false };
  if (mode === "verify-full") {
    const ca = process.env.DATABASE_CA_CERT ? readFileSync(process.env.DATABASE_CA_CERT, "utf8") : undefined;
    return { rejectUnauthorized: true, ...(ca && { ca }) };
  }
  throw new Error(`DATABASE_SSL must be off, require or verify-full (got "${mode}")`);
}
