import { timingSafeEqual } from "node:crypto";
import { relaySecret } from "@/lib/connector";
import { chainFor, forward } from "@/lib/claudeRoute";

/**
 * Internal: every Claude request of the agent when a fallback is set up (or the gateway is only on a VPN). Guarded by the
 * per-process relay secret. Sends it to the main sign-in and, if that fails, the same request to the next one at once —
 * see lib/claudeRoute.ts.
 */
async function handle(req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const given = Buffer.from(req.headers.get("x-relay-secret") || "");
  const want = Buffer.from(relaySecret());
  if (given.length !== want.length || !timingSafeEqual(given, want)) {
    return Response.json({ type: "error", error: { type: "permission_error", message: "forbidden" } }, { status: 403 });
  }
  const { path } = await ctx.params;
  // Only the Messages API family; the agent's other calls (e.g. a hello probe) don't need to go anywhere.
  if (path[0] !== "v1") return Response.json({ type: "error", error: { type: "not_found_error", message: "not found" } }, { status: 404 });
  const user = req.headers.get("x-relay-user") || null;
  const runId = Number(req.headers.get("x-relay-run")) || null;
  return forward(req, chainFor(user), { user, runId, path: `/${path.map(encodeURIComponent).join("/")}${new URL(req.url).search}` });
}

export const GET = handle;
export const POST = handle;
