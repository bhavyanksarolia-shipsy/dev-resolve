import "server-only";
import { DevrevError } from "./devrev";

/** Turn any failure into a clear JSON error that names the connection that broke and how to fix it. */
export function apiError(e: unknown) {
  if (e instanceof DevrevError) return Response.json({ error: e.message, tag: e.tag, connection: "devrev" }, { status: 502 });
  const err = e as Error & { code?: string; errors?: (Error & { code?: string })[] };
  const code = err.code ?? err.errors?.[0]?.code;
  const msg = err.message || err.errors?.[0]?.message || String(e);
  if (code === "ECONNREFUSED" && /543\d/.test(msg)) {
    return Response.json({ error: "Dev Resolve's database (Postgres) isn't running — start Docker Desktop, then run `npm run db:up`", tag: "DB_DOWN", connection: "postgres" }, { status: 503 });
  }
  return Response.json({ error: msg, tag: "ERROR", connection: "server" }, { status: 500 });
}
