import { requireAdmin } from "@/lib/adminGuard";
import { getAccount } from "@/lib/config";
import { q } from "@/lib/db";
import { cancelInvestigation, isLive, queueState, startInvestigation, type StartNotes } from "@/lib/agent/run";

/**
 * Admin → Investigations: every investigation (and chat reply) with who started it, when, how long it ran and where it
 * is now — and the admin actions: stop a running one, take one out of the queue, retry a failed one.
 *   GET  ?status=active|failed|done|all &q=<ticket or title> &page=1
 *   POST { id, action: "stop" | "dequeue" | "retry" }
 */
const PAGE = 20;

export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if (g.error) return g.error;
  const sp = new URL(req.url).searchParams;
  const status = sp.get("status") || "active";
  const page = Math.max(1, Number(sp.get("page")) || 1);
  const term = (sp.get("q") || "").trim();
  const where: string[] = [], args: unknown[] = [];
  if (status === "active") where.push(`(i.status = 'running' OR i.chat_running)`);
  else if (status === "failed") where.push(`i.status = 'failed'`);
  else if (status === "done") where.push(`i.status IN ('draft_ready','posted')`);
  if (term) { args.push(`%${term}%`); where.push(`(i.ticket_display ILIKE $${args.length} OR i.ticket_title ILIKE $${args.length})`); }
  const w = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const [{ n }] = await q<{ n: number }>(`SELECT count(*)::int n FROM investigations i ${w}`, args);
  const rows = await q<{ id: number; ticket_display: string; ticket_title: string; account_slug: string; status: string; chat_running: boolean; chat_by: string | null;
    started_by: string | null; who: string | null; email: string | null; created_at: string; finished_at: string | null; error: string | null; confidence: string | null }>(
    `SELECT i.id, i.ticket_display, i.ticket_title, i.account_slug, i.status, i.chat_running, i.chat_by, i.started_by,
            u.display_name AS who, u.email, i.created_at, i.finished_at, i.error, i.confidence
       FROM investigations i LEFT JOIN app_users u ON u.name = i.started_by
       ${w} ORDER BY i.id DESC LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`, args);
  // Where each active one is right now (from the live queue), and whether a "running" one is really alive.
  const st = await queueState();
  const counts = await q<{ active: number; failed: number }>(
    `SELECT count(*) FILTER (WHERE status = 'running' OR chat_running)::int active, count(*) FILTER (WHERE status = 'failed' AND finished_at > now() - interval '24 hours')::int failed FROM investigations`);
  return Response.json({
    page, pageSize: PAGE, total: n, counts: counts[0], limits: { parallel: st.max, perPerson: st.perPerson },
    rows: rows.map((r) => {
      const run = st.running.find((x) => x.id === r.id), wait = st.waiting.find((x) => x.id === r.id);
      const active = r.status === "running" || r.chat_running;
      return {
        ...r, account: getAccount(r.account_slug)?.name ?? r.account_slug,
        kind: r.chat_running ? "chat" : "investigation",
        state: !active ? r.status : wait ? "queued" : run ? "running" : isLive(r.id) ? "starting" : "stuck",
        runningSince: run?.since ?? null, position: wait?.position ?? null, waitMin: wait?.waitMin ?? null,
      };
    }),
  });
}

export async function POST(req: Request) {
  const g = await requireAdmin(req);
  if (g.error) return g.error;
  const b = (await req.json().catch(() => ({}))) as { id?: number; action?: "stop" | "dequeue" | "retry" };
  const id = Number(b.id);
  const [inv] = await q<{ id: number; ticket_display: string; status: string; chat_running: boolean; started_by: string | null }>(
    `SELECT id, ticket_display, status, chat_running, started_by FROM investigations WHERE id=$1`, [id]);
  if (!inv) return Response.json({ error: "No such investigation" }, { status: 404 });
  const admin = g.user.name;

  if (b.action === "stop" || b.action === "dequeue") {
    if (inv.status !== "running" && !inv.chat_running) return Response.json({ error: "It isn't running any more" }, { status: 409 });
    const why = b.action === "dequeue" ? `Removed from the queue by ${admin}` : `Stopped by ${admin}`;
    const live = isLive(id);
    cancelInvestigation(id); // stops it, or takes it out of the line
    // Mark it now — for a stuck one (nothing alive to report back) this is what frees the ticket.
    if (inv.status === "running") await q(`UPDATE investigations SET status='failed', error=$2, finished_at=now() WHERE id=$1 AND status='running'`, [id, why]);
    if (inv.chat_running) {
      await q(`UPDATE investigations SET chat_running=false, chat_error=$2, chat_finished_at=now() WHERE id=$1`, [id, why]);
      await q(`INSERT INTO investigation_steps (investigation_id, seq, kind, tool, input, output)
               SELECT $1, COALESCE(max(seq), -1) + 1, 'system', NULL, '{"error":true}'::jsonb, $2 FROM investigation_steps WHERE investigation_id=$1`, [id, `Chat reply ${why.toLowerCase()}`]);
    }
    console.log(`[admin] ${admin}: ${b.action} #${id} ${inv.ticket_display}${live ? "" : " (was stuck)"}`);
    return Response.json({ ok: true, message: `${inv.ticket_display}: ${why.split(" by ")[0].toLowerCase()}` });
  }

  if (b.action === "retry") {
    if (inv.status !== "failed") return Response.json({ error: "Only failed investigations can be retried" }, { status: 409 });
    // Same notes and files the person gave the first time; it runs for them (they get the notification), not the admin.
    const [start] = await q<{ output: string | null; input: { files?: { id: number }[] } | null }>(
      `SELECT output, input FROM investigation_steps WHERE investigation_id=$1 AND kind='user_message' AND (input->>'start_notes')::boolean ORDER BY seq LIMIT 1`, [id]);
    const fileIds = (start?.input?.files ?? []).map((f) => f.id);
    const files = fileIds.length ? await q<{ name: string; type: string; size: number; data: Buffer }>(`SELECT name, type, size, data FROM chat_files WHERE id = ANY($1)`, [fileIds]) : [];
    const text = start?.output && start.output !== "(files only)" ? start.output : "";
    const notes: StartNotes | undefined = text || files.length ? { text, files: files.map((f) => ({ name: f.name, type: f.type, size: f.size, body: f.data })) } : undefined;
    try {
      const newId = await startInvestigation(inv.ticket_display, inv.started_by || admin, notes);
      await q(`INSERT INTO investigation_steps (investigation_id, seq, kind, tool, input, output)
               SELECT $1, COALESCE(max(seq), -1) + 1, 'system', NULL, '{}'::jsonb, $2 FROM investigation_steps WHERE investigation_id=$1`,
        [newId, `Retried by ${admin} (an admin) after the earlier attempt failed`]).catch(() => {});
      console.log(`[admin] ${admin}: retry #${id} ${inv.ticket_display} → #${newId}`);
      return Response.json({ ok: true, id: newId, message: `${inv.ticket_display}: started again` });
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 400 });
    }
  }
  return Response.json({ error: "Unknown action" }, { status: 400 });
}
