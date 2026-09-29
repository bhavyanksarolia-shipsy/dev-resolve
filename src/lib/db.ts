import "server-only";
import { Pool } from "pg";

const globalForPg = globalThis as unknown as { devResolvePool?: Pool };

export const pool =
  globalForPg.devResolvePool ?? new Pool({ connectionString: process.env.DATABASE_URL, max: 10 });
if (process.env.NODE_ENV !== "production") globalForPg.devResolvePool = pool;

export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}
