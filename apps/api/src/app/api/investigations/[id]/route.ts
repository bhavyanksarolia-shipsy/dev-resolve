import { q } from "@/lib/db";
import { cancelInvestigation } from "@/lib/agent/run";
import { sessionUser } from "@/lib/auth";
import { cfgValue } from "@/lib/config";

/** Admins always see the full trail; members only if an admin turned it on (Admin → User access control). */
const trailForMembers = () => (cfgValue("TRAIL_FOR_MEMBERS") || "off").toLowerCase() === "on";

/** Member view: the agent's own updates and milestones, plus which kind of check ran — no queries or results. */
function summarize(steps: Record<string, unknown>[]) {
  return steps
    .filter((s) => ["text", "user_message", "system", "connection_error", "tool_call"].includes(String(s.kind)))
    .map((s) => (s.kind === "tool_call"
      ? { seq: s.seq, kind: s.kind, tool: s.tool, input: null, output: null, created_at: s.created_at }
      : s.kind === "system" ? { ...s, input: null } : s));
}

export async function GET(req: Request, ctx: RouteContext<"/api/investigations/[id]">) {
  const { id } = await ctx.params;
  const after = Number(new URL(req.url).searchParams.get("after") ?? -1);
  const [inv] = await q(`SELECT * FROM investigations WHERE id=$1`, [id]);
  if (!inv) return Response.json({ error: "not found" }, { status: 404 });
  const [steps, proposals, runs] = await Promise.all([
    q(`SELECT seq, kind, tool, input, output, created_at FROM investigation_steps WHERE investigation_id=$1 AND seq > $2 ORDER BY seq`, [id, after]),
    q(`SELECT * FROM knowledge_proposals WHERE investigation_id=$1 ORDER BY id`, [id]),
    q(`SELECT id, kind, started_by, started_at, finished_at, num_turns, cost_usd::float AS cost_usd, input_tokens::int, output_tokens::int,
              cache_read_tokens::int, cache_write_tokens::int, model_usage FROM agent_runs WHERE investigation_id=$1 ORDER BY id`, [id]),
  ]);
  const viewer = await sessionUser(req);
  const full = !!viewer?.isAdmin || trailForMembers();
  // Knowledge proposals are an admin concern; members never see them.
  return Response.json({ investigation: inv, steps: full ? steps : summarize(steps), trail: full ? "full" : "summary", proposals: viewer?.isAdmin ? proposals : [], runs });
}

export async function DELETE(req: Request, ctx: RouteContext<"/api/investigations/[id]">) {
  const { id } = await ctx.params;
  const who = (await sessionUser(req))?.name ?? "someone";
  cancelInvestigation(Number(id));
  // "Cancelled by <name>" — the page shows this as a neutral "stopped" card, not an error.
  await q(`UPDATE investigations SET status='failed', error=$2, finished_at=now() WHERE id=$1 AND status='running'`, [id, `Cancelled by ${who}`]);
  return Response.json({ ok: true });
}
