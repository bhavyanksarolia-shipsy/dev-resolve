import { q } from "@/lib/db";
import { cancelInvestigation } from "@/lib/agent/run";

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
  return Response.json({ investigation: inv, steps, proposals, runs });
}

export async function DELETE(_req: Request, ctx: RouteContext<"/api/investigations/[id]">) {
  const { id } = await ctx.params;
  cancelInvestigation(Number(id));
  await q(`UPDATE investigations SET status='failed', error='Cancelled by user', finished_at=now() WHERE id=$1 AND status='running'`, [id]);
  return Response.json({ ok: true });
}
