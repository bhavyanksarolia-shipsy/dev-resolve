import { timingSafeEqual } from "node:crypto";
import { adminSetting } from "@/lib/config";
import { ConnectorOffline, gatewayCarrier, gatewayViaConnector, relay, relaySecret } from "@/lib/connector";

/**
 * Internal: the agent's Claude requests when the API gateway (e.g. Bifrost) is only reachable on a VPN. The agent on this
 * server calls here (guarded by the per-process relay secret); a connector on a laptop that is on the VPN makes the real
 * request. Responses come back whole (a streamed answer arrives at once), which the agent handles fine.
 */
const fail = (status: number, type: string, message: string) => Response.json({ type: "error", error: { type, message } }, { status });
const DROP = /^(host|connection|content-length|transfer-encoding|accept-encoding|x-relay-secret|x-relay-user)$/i;

async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const given = Buffer.from(req.headers.get("x-relay-secret") || "");
  const want = Buffer.from(relaySecret());
  if (given.length !== want.length || !timingSafeEqual(given, want)) return fail(403, "permission_error", "forbidden");
  if (!gatewayViaConnector()) return fail(403, "permission_error", "Claude isn't set to go through the Dev Resolve extension");
  // 403 (not 5xx) when nobody can carry it, so the agent stops at once with this message instead of retrying for minutes.
  const user = gatewayCarrier(req.headers.get("x-relay-user"));
  if (!user) return fail(403, "permission_error",
    "Nobody's Dev Resolve extension (1.2 or newer) is online to reach the Claude gateway. Open Chrome with the extension on a laptop connected to the company VPN (Pritunl), then try again.");
  const { path } = await ctx.params;
  const target = `${adminSetting("ANTHROPIC_BASE_URL")!.replace(/\/+$/, "")}/${path.map(encodeURIComponent).join("/")}${new URL(req.url).search}`;
  const headers: Record<string, string> = {};
  req.headers.forEach((v, k) => { if (!DROP.test(k)) headers[k] = v; });
  const body = req.method === "POST" ? Buffer.from(await req.arrayBuffer()) : null;
  try {
    const r = await relay(user, { method: req.method, url: target, headers, body_b64: body?.toString("base64"), timeout_ms: 600_000 });
    return new Response(new Uint8Array(Buffer.from(r.body_b64, "base64")), { status: r.status, headers: { "content-type": r.headers["content-type"] || "application/json" } });
  } catch (e) {
    const msg = (e as Error).message;
    if (e instanceof ConnectorOffline) return fail(503, "api_error", `${user}'s Dev Resolve extension went offline — retrying`);
    if (/host not allowed/.test(msg)) return fail(403, "permission_error", `${user}'s Dev Resolve extension isn't allowed to reach the Claude gateway yet — download it again from the Connector page`);
    return fail(502, "api_error", `Couldn't reach the Claude gateway through ${user}'s laptop: ${msg}`);
  }
}

export const GET = handle;
export const POST = handle;
