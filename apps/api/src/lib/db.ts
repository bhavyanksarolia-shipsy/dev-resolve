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

export class LockedError extends Error {
  name = "LockedError";
}
/** True for a lock refusal — checked by name, so it also works across module reloads (dev) and bundles. */
export const isLocked = (e: unknown): e is LockedError => !!e && typeof e === "object" && (e as { name?: string }).name === "LockedError";
/**
 * Runs fn while holding a Postgres advisory lock named `key` (works across requests and server instances).
 * If someone else holds it, throws LockedError(busyMessage) instead of waiting — callers answer 409.
 */
export async function withLock<T>(key: string, busyMessage: string, fn: () => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    const [{ ok }] = (await client.query<{ ok: boolean }>(`SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS ok`, [key])).rows;
    if (!ok) throw new LockedError(busyMessage);
    try {
      return await fn();
    } finally {
      await client.query(`SELECT pg_advisory_unlock(hashtextextended($1, 0))`, [key]).catch(() => {});
    }
  } finally {
    client.release();
  }
}
