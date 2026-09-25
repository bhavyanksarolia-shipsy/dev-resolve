import { startInvestigation } from "@/lib/agent/run";

export async function POST(req: Request) {
  const { ticket } = (await req.json()) as { ticket?: string };
  if (!ticket) return Response.json({ error: "ticket is required" }, { status: 400 });
  try {
    const id = await startInvestigation(ticket);
    return Response.json({ id });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

/** Investigations that finished after `finished_after` (ISO) — polled by the browser-notification watcher. */
export async function GET(req: Request) {
  const after = new URL(req.url).searchParams.get("finished_after");
  const { q } = await import("@/lib/db");
  const [running] = await q<{ n: string }>(`SELECT count(*) AS n FROM investigations WHERE status = 'running'`);
  const finished = after
    ? await q(
        `SELECT id, ticket_display, ticket_title, status, confidence, error, finished_at
           FROM investigations WHERE finished_at > $1 AND status IN ('draft_ready','failed') ORDER BY finished_at`,
        [after],
      )
    : [];
  return Response.json({ now: new Date().toISOString(), running: Number(running.n), finished });
}
