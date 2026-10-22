import "server-only";
import { DevrevError } from "./devrev";

/** Turn any failure into a clear JSON error that names the connection that broke and how to fix it. */
export function apiError(e: unknown) {
  if (e instanceof DevrevError) {
    // AUTH_FAILED / NETWORK already carry a clear, specific, actionable message (devrev.ts) — nothing to split out.
    // A generic HTTP failure (most often DevRev's own 5xx) just wraps DevRev's raw response: split it into a loud,
    // unambiguous headline ("this is on DevRev, not us") plus the raw technical detail as a secondary field, so a
    // caller can show the headline prominently and tuck the raw JSON into a collapsed "Technical detail" instead of
    // dumping one wall of text.
    if (e.tag !== "HTTP_ERROR") return Response.json({ error: e.message, tag: e.tag, connection: "devrev" }, { status: 502 });
    const headline = e.status >= 500
      ? "DevRev is having a problem on their end right now — this isn't a Dev Resolve issue. Try again shortly."
      : `DevRev refused this request (HTTP ${e.status}).`;
    return Response.json({ error: headline, detail: e.message, tag: e.tag, connection: "devrev" }, { status: 502 });
  }
  const err = e as Error & { code?: string; errors?: (Error & { code?: string })[] };
  const code = err.code ?? err.errors?.[0]?.code;
  const msg = err.message || err.errors?.[0]?.message || String(e);
  if (code === "ECONNREFUSED" && /543\d/.test(msg)) {
    return Response.json({ error: "Dev Resolve's database (Postgres) isn't running — start Docker Desktop, then run `npm run db:up`", tag: "DB_DOWN", connection: "postgres" }, { status: 503 });
  }
  return Response.json({ error: msg, tag: "ERROR", connection: "server" }, { status: 500 });
}
