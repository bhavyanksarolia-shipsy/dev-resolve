import { isLocked } from "@/lib/db";
import { startInvestigation } from "@/lib/agent/run";
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

/** Investigations that finished after `finished_after` (ISO) — polled by the browser-notification watcher. */
export async function GET(req: Request) {
  const after = new URL(req.url).searchParams.get("finished_after");
  const { q } = await import("@/lib/db");
  const [running] = await q<{ n: string }>(`SELECT count(*) AS n FROM investigations WHERE status = 'running' OR chat_running`);
  const finished = after
    ? await q(
        `SELECT id, ticket_display, ticket_title, status, confidence, error, finished_at
           FROM investigations WHERE finished_at > $1 AND status IN ('draft_ready','failed') ORDER BY finished_at`,
        [after],
      )
    : [];
  return Response.json({ now: new Date().toISOString(), running: Number(running.n), finished });
}
