import "server-only";
import { Pool } from "pg";
import { pgConfig } from "./pgConfig";

function createPool() {
  const p = new Pool(pgConfig());
  // An idle connection dropping (DB restart / failover) must not crash the server; the next query reconnects.
  p.on("error", (e) => console.error("[db] idle connection error:", e.message));
  return p;
}

const globalForPg = globalThis as unknown as { devResolvePool?: Pool };

/** Created on first use, so building the app (no DATABASE_URL) doesn't need a database. */
export function getPool(): Pool {
  return (globalForPg.devResolvePool ??= createPool());
}

export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await getPool().query(text, params);
  return res.rows as T[];
}
