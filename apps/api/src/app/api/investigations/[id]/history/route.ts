import { q } from "@/lib/db";

/** Chat messages from this ticket's earlier investigations, so a re-investigation doesn't hide the old conversation. */
export async function GET(_req: Request, ctx: RouteContext<"/api/investigations/[id]/history">) {
  const { id } = await ctx.params;
  const rows = await q<{ investigation_id: number; started: string; seq: number; kind: string; input: unknown; output: string | null; created_at: string }>(
    `SELECT s.investigation_id, o.created_at AS started, s.seq, s.kind, s.input, s.output, s.created_at
       FROM investigations cur
       JOIN investigations o ON o.ticket_display = cur.ticket_display AND o.id < cur.id
       JOIN investigation_steps s ON s.investigation_id = o.id
      WHERE cur.id = $1
        AND s.kind IN ('user_message', 'text')
        AND s.seq >= (SELECT min(seq) FROM investigation_steps f WHERE f.investigation_id = o.id AND f.kind = 'user_message')
      ORDER BY o.id, s.seq`, [id]);
  const groups: { investigation_id: number; started: string; messages: { seq: number; kind: string; input: unknown; output: string | null; created_at: string }[] }[] = [];
  for (const r of rows) {
    let g = groups.find((x) => x.investigation_id === r.investigation_id);
    if (!g) groups.push((g = { investigation_id: r.investigation_id, started: r.started, messages: [] }));
    g.messages.push({ seq: r.seq, kind: r.kind, input: r.input, output: r.output, created_at: r.created_at });
  }
  return Response.json({ groups });
}
