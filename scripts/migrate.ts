import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { pgConfig } from "../src/lib/pgConfig";

/**
 * Applies db/migrations/*.sql in order, each in its own transaction. Safe to run on every start:
 * an advisory lock stops two starting instances from migrating at once.
 * MIGRATION_DATABASE_URL (optional) = the schema-owner role, when the app itself runs with a smaller role.
 */
const LOCK_ID = 727_001;

async function main() {
  const { connectionString, ssl, application_name } = pgConfig(process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL);
  const client = new Client({ connectionString, ssl, application_name: `${application_name}-migrate` });
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_ID]);
    await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())");
    const dir = path.join(process.cwd(), "db", "migrations");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
      const done = await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [file]);
      if (done.rowCount) continue;
      try {
        await client.query("BEGIN");
        await client.query(readFileSync(path.join(dir, file), "utf8"));
        await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw new Error(`migration ${file} failed: ${(e as Error).message}`);
      }
      console.log(`applied ${file}`);
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_ID]).catch(() => {});
    await client.end();
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
