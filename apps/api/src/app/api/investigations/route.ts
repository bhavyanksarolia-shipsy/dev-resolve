import { isLocked } from "@/lib/db";
import { queueState, startInvestigation } from "@/lib/agent/run";
import { currentUser } from "@/lib/auth";

const MAX_FILES = 10, MAX_FILE = 20 * 1024 * 1024, MAX_TOTAL = 30 * 1024 * 1024;

/**
 * Start an investigation. JSON { ticket } — or, from the ticket page, multipart form data: ticket + notes (what the
 * reviewer already knows) + files; the agent gets those as leads to verify.
 */
export async function POST(req: Request) {
  let ticket = "", notes = "";
  let uploads: File[] = [];
  if ((req.headers.get("content-type") || "").includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    if (!form) return Response.json({ error: "Couldn't read the upload — try fewer or smaller files" }, { status: 400 });
    ticket = String(form.get("ticket") ?? "");
    notes = String(form.get("notes") ?? "");
    uploads = form.getAll("files").filter((f): f is File => typeof f === "object" && "arrayBuffer" in f);
  } else {
    const b = (await req.json().catch(() => ({}))) as { ticket?: string; notes?: string };
    ticket = String(b.ticket ?? "");
    notes = String(b.notes ?? "");
  }
  if (!ticket) return Response.json({ error: "ticket is required" }, { status: 400 });
  notes = notes.trim().slice(0, 8000);
  if (uploads.length > MAX_FILES) return Response.json({ error: `Attach up to ${MAX_FILES} files` }, { status: 400 });
  const big = uploads.find((f) => f.size > MAX_FILE);
  if (big) return Response.json({ error: `${big.name} is larger than 20 MB` }, { status: 400 });
  if (uploads.reduce((n, f) => n + f.size, 0) > MAX_TOTAL) return Response.json({ error: "Files add up to more than 30 MB" }, { status: 400 });
  const files = [];
  for (const f of uploads) {
    const body = Buffer.from(await f.arrayBuffer());
    files.push({ name: (f.name || "file").replace(/[\\/\r\n"]/g, "_").slice(0, 200), type: f.type || "application/octet-stream", size: body.length, body });
  }
  try {
    const id = await startInvestigation(ticket, await currentUser(req), notes || files.length ? { text: notes, files } : undefined);
    return Response.json({ id });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: isLocked(e) ? 409 : 400 });
  }
}

/**
 * Polled by the notifier in the header: your investigations and chat replies that finished after `since` (exact
 * database timestamps, so nothing is missed or repeated), plus how many runs are going / waiting in line.
 */
export async function GET(req: Request) {
  const since = new URL(req.url).searchParams.get("since") || new URL(req.url).searchParams.get("finished_after");
  const me = await currentUser(req);
  const { q } = await import("@/lib/db");
  const [{ now }] = await q<{ now: string }>(`SELECT now()::text AS now`);
  const st = await queueState();
  const events = since
    ? await q(
        `SELECT * FROM (
           SELECT 'investigation' AS kind, id, ticket_display, ticket_title, status = 'draft_ready' AS ok, confidence, error, finished_at::text AS at, finished_at AS t
             FROM investigations WHERE started_by = $2 AND finished_at > $1::timestamptz AND status IN ('draft_ready','failed')
           UNION ALL
           SELECT 'chat', id, ticket_display, ticket_title, chat_error IS NULL, NULL, chat_error, chat_finished_at::text, chat_finished_at
             FROM investigations WHERE chat_by = $2 AND chat_finished_at > $1::timestamptz
         ) e ORDER BY t LIMIT 20`,
        [since, me],
      )
    : [];
  return Response.json({
    now, events,
    running: st.running.length, waiting: st.waiting.length,
    mine: { running: st.running.filter((r) => r.by === me).length, waiting: st.waiting.filter((w) => w.by === me).length },
  });
}
