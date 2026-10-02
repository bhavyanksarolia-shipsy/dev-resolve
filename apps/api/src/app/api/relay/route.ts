import { timingSafeEqual } from "node:crypto";
import { ConnectorOffline, relay, relaySecret, type RelayRequest } from "@/lib/connector";

/**
 * Internal: the Python tools (Metabase, OpenSearch) call this on the same server for VPN-only hosts, and it is carried
 * out by the local connector of the person the investigation runs for. Guarded by a per-process secret.
 */
export async function POST(req: Request) {
  const given = Buffer.from(req.headers.get("x-relay-secret") || "");
  const want = Buffer.from(relaySecret());
  if (given.length !== want.length || !timingSafeEqual(given, want)) return Response.json({ error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { user?: string; req?: RelayRequest };
  if (!b.user || !b.req?.url) return Response.json({ error: "user and req required" }, { status: 400 });
  try {
    return Response.json(await relay(b.user, { ...b.req, timeout_ms: Math.min(Number(b.req.timeout_ms) || 30_000, 300_000) }));
  } catch (e) {
    const offline = e instanceof ConnectorOffline;
    return Response.json({ error: (e as Error).message, code: offline ? "CONNECTOR_OFFLINE" : "RELAY_FAILED" }, { status: offline ? 503 : 502 });
  }
}
