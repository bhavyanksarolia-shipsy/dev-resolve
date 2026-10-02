/**
 * Private files in Postgres.
 *   npm run private -- restore            DB → disk (the container runs this on every start; imports disk → DB once if the DB is empty)
 *   npm run private -- push "<DB URL>"    your laptop's private files → that database (e.g. Railway's DATABASE_PUBLIC_URL), once
 *   npm run private -- status             what's stored
 */
import { Client } from "pg";
import { importAll, restoreAll } from "../src/lib/privateFiles";
import { pgConfig } from "../src/lib/pgConfig";

async function main() {
  const [cmd, url] = process.argv.slice(2);
  const root = process.cwd();
  const target = cmd === "push" ? url : process.env.DATABASE_URL;
  if (!target) throw new Error(cmd === "push" ? 'Usage: npm run private -- push "<database URL>"' : "DATABASE_URL is not set");
  const { connectionString, ssl } = pgConfig(target);
  const db = new Client({ connectionString, ssl: cmd === "push" && /railway|rlwy|amazonaws|render/.test(target) ? { rejectUnauthorized: false } : ssl });
  await db.connect();
  const q = (sql: string, params?: unknown[]) => db.query(sql, params);
  try {
    await q(`CREATE TABLE IF NOT EXISTS private_files (path TEXT PRIMARY KEY, content BYTEA NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_by TEXT)`);
    if (cmd === "restore") {
      const { rows } = await q(`SELECT count(*)::int AS n FROM private_files`);
      if (!rows[0].n) {
        const n = await importAll(q, root, "first start");
        console.log(n ? `[private-files] database was empty — saved ${n} file(s) found on disk` : "[private-files] nothing stored yet — an admin uploads the config on the Settings page (once)");
      } else console.log(`[private-files] restored ${await restoreAll(q, root)} file(s) from the database`);
    } else if (cmd === "push") {
      console.log(`Saved ${await importAll(q, root, "push from laptop")} private file(s) to that database. Redeploy (or restart) the backend to load them.`);
    } else if (cmd === "status") {
      const { rows } = await q(`SELECT split_part(path, '/', 1) AS area, count(*)::int AS files, max(updated_at) AS updated FROM private_files GROUP BY 1 ORDER BY 1`);
      console.table(rows);
    } else console.log("Usage: npm run private -- restore | push \"<database URL>\" | status");
  } finally {
    await db.end();
  }
}
main().catch((e) => { console.error(e.message || e); process.exit(1); });
