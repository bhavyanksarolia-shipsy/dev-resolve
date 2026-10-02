import "server-only";
import path from "node:path";
import { ROOT } from "./config";
import { getPool } from "./db";
import { persist } from "./privateFiles";

const q = (sql: string, params?: unknown[]) => getPool().query(sql, params);

/** Save a private file the app just wrote (absolute or backend-relative path) to Postgres. Never throws. */
export async function savePrivate(file: string, by?: string) {
  const rel = path.isAbsolute(file) ? path.relative(ROOT, file) : file;
  await persist(q, ROOT, rel, by).catch((e) => console.error(`[private-files] couldn't save ${rel}:`, (e as Error).message));
}
