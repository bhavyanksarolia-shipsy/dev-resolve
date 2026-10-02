import { getTicket, podValues, stageMoves, updateTicket } from "@/lib/devrev";
import { currentUser } from "@/lib/auth";
import { q } from "@/lib/db";

/**
 * Change Stage and/or Pod on one or many tickets in DevRev: { tickets: ["TKT-1", …], stage?: "<stage name>", pod?: "WMS" | null }.
 * The stage is given by name and resolved per ticket, because which moves are allowed depends on each ticket's current stage.
 */
export async function POST(req: Request) {
  const by = await currentUser(req);
  const b = (await req.json().catch(() => ({}))) as { tickets?: string[]; stage?: string; pod?: string | null };
  const tickets = Array.from(new Set((b.tickets || []).map(String).filter((t) => /^TKT-\d+$/.test(t)))).slice(0, 200);
  if (!tickets.length) return Response.json({ error: "Pick at least one ticket" }, { status: 400 });
  if (!b.stage && b.pod === undefined) return Response.json({ error: "Nothing to change" }, { status: 400 });

  const results: { ticket: string; ok: boolean; stage?: string; pod?: string | null; error?: string }[] = [];
  const queue = [...tickets];
  async function worker() {
    for (let t = queue.shift(); t; t = queue.shift()) {
      const change: { stageId?: string; pod?: string | null } = {};
      try {
        const cur = await getTicket(t);
        if (b.stage) {
          if (cur.stage?.name === b.stage) throw new Error(`already ${b.stage}`);
          const target = (await stageMoves(cur.subtype, cur.stage?.stage?.id)).find((s) => s.name === b.stage);
          if (!target) throw new Error(`can't move from "${cur.stage?.name}" to "${b.stage}" in DevRev`);
          change.stageId = target.id;
        }
        if (b.pod !== undefined) {
          if (b.pod !== null && !(await podValues(cur)).includes(b.pod)) throw new Error(`"${b.pod}" isn't a Pod value in DevRev`);
          change.pod = b.pod;
        }
        const w = await updateTicket(cur.id, change);
        results.push({ ticket: t, ok: true, stage: w.stage?.name, pod: typeof w.custom_fields?.tnt__pod === "string" ? w.custom_fields.tnt__pod : null });
        await q(`INSERT INTO ticket_updates (ticket, changed_by, change, ok) VALUES ($1,$2,$3,true)`, [t, by, JSON.stringify({ stage: b.stage, pod: b.pod })]);
      } catch (e) {
        const error = (e as Error).message.replace(/^DevRev \/works\.update HTTP \d+: /, "");
        results.push({ ticket: t, ok: false, error });
        await q(`INSERT INTO ticket_updates (ticket, changed_by, change, ok, error) VALUES ($1,$2,$3,false,$4)`, [t, by, JSON.stringify({ stage: b.stage, pod: b.pod }), error]).catch(() => {});
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, tickets.length) }, worker));
  const failed = results.filter((r) => !r.ok);
  return Response.json({ ok: !failed.length, updated: results.length - failed.length, failed, results });
}
