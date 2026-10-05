import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Private files (config, knowledge, each person's sign-ins) live in Postgres — the database is the source of truth.
 * On start the backend writes them all to disk (restore), and every change the app makes is saved back (persist).
 * Shared by the app (src/lib) and scripts/private-files.ts, so it takes a query function instead of importing db.ts.
 */
export type Query = (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

/** What counts as private state worth keeping (relative to the backend root). */
export function isPrivate(rel: string) {
  rel = rel.split(path.sep).join("/");
  if (rel === "config/projects.json" || rel === "config/config.env" || rel === "config/welcome-email.json") return true;
  if (rel.startsWith("knowledge/")) return !rel.startsWith("knowledge/_template/") && rel !== "knowledge/README.md" && !/\/\._/.test(rel);
  if (rel.startsWith(".auth/users/")) return true;
  // Agent skills uploaded in Admin (client-specific, so never in the public repo). metabase-sql ships with the code.
  if (/^\.claude\/skills\/[a-z0-9][a-z0-9-]*\/SKILL\.md$/.test(rel)) return !rel.startsWith(".claude/skills/metabase-sql/");
  return false;
}

const MODE = (rel: string) => (rel.startsWith("knowledge/") ? 0o644 : 0o600);

export async function persist(q: Query, root: string, rel: string, by?: string) {
  if (!isPrivate(rel)) return;
  const abs = path.join(root, rel);
  if (!existsSync(abs)) {
    await q(`DELETE FROM private_files WHERE path = $1`, [rel]);
    return;
  }
  await q(
    `INSERT INTO private_files (path, content, updated_at, updated_by) VALUES ($1, $2, now(), $3)
     ON CONFLICT (path) DO UPDATE SET content = EXCLUDED.content, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [rel, readFileSync(abs), by ?? null],
  );
}

/** Every private file currently on disk (for the one-time import). */
export function listLocal(root: string): string[] {
  const out: string[] = [];
  const walk = (relDir: string) => {
    const abs = path.join(root, relDir);
    if (!existsSync(abs)) return;
    for (const name of readdirSync(abs)) {
      const rel = relDir ? `${relDir}/${name}` : name;
      if (statSync(path.join(root, rel)).isDirectory()) walk(rel);
      else if (isPrivate(rel)) out.push(rel);
    }
  };
  for (const f of ["config/projects.json", "config/config.env", "config/welcome-email.json"]) if (existsSync(path.join(root, f))) out.push(f);
  walk("knowledge");
  walk(".auth/users");
  walk(".claude/skills");
  return out;
}

/** DB → disk. Returns how many files were written. */
export async function restoreAll(q: Query, root: string) {
  const { rows } = await q(`SELECT path, content FROM private_files`);
  for (const r of rows) {
    const rel = String(r.path);
    if (!isPrivate(rel) || rel.split("/").includes("..")) continue;
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true, mode: 0o700 });
    writeFileSync(abs, r.content as Buffer, { mode: MODE(rel) });
  }
  return rows.length;
}

/** Disk → DB for everything private on disk (first start with an old volume / secret files, or a push from a laptop). */
export async function importAll(q: Query, root: string, by: string) {
  const files = listLocal(root);
  for (const rel of files) await persist(q, root, rel, by);
  return files.length;
}
