import { currentUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { queueState } from "@/lib/agent/run";

/** The queue, for the UI: what's running, what's waiting (position, expected wait) — with ticket ids and whose it is. */
export async function GET(req: Request) {
  const me = await currentUser(req);
  const st = await queueState();
  const ids = [...st.running, ...st.waiting].map((x) => x.id);
  const t = ids.length ? await q<{ id: number; ticket_display: string }>(`SELECT id, ticket_display FROM investigations WHERE id = ANY($1)`, [ids]) : [];
  const ticket = new Map(t.map((r) => [r.id, r.ticket_display]));
  const add = <T extends { id: number; by: string }>(x: T) => ({ ...x, ticket: ticket.get(x.id) ?? null, mine: x.by === me });
  return Response.json({ ...st, running: st.running.map(add), waiting: st.waiting.map(add) });
}
