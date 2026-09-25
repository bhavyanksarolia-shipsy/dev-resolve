import { getAccount, getDevrevView } from "@/lib/config";
import { listTickets, ticketCounts, devrevUrl, DevrevError } from "@/lib/devrev";
import { q } from "@/lib/db";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const account = getAccount(sp.get("account") || "");
  if (!account) return Response.json({ error: "unknown account" }, { status: 400 });
  try {
    const [{ works, next_cursor }, counts] = await Promise.all([
      listTickets(account.devrev.account_ids, { limit: 25, cursor: sp.get("cursor") || undefined }),
      ticketCounts(account.devrev.account_ids),
    ]);
    const ids = works.map((w) => w.display_id);
    const invs = ids.length
      ? await q<{ ticket_display: string; id: number; status: string; confidence: string | null }>(
          `SELECT DISTINCT ON (ticket_display) ticket_display, id, status, confidence
             FROM investigations WHERE ticket_display = ANY($1) ORDER BY ticket_display, id DESC`,
          [ids],
        )
      : [];
    const byTicket = Object.fromEntries(invs.map((i) => [i.ticket_display, i]));
    return Response.json({
      tickets: works.map((w) => ({
        id: w.id, display_id: w.display_id, title: w.title, stage: w.stage?.display_name || w.stage?.name,
        severity: w.severity, created_date: w.created_date, account: w.account?.display_name,
        part: (w as { applies_to_part?: { name?: string } }).applies_to_part?.name,
        default_part: (w as { applies_to_part?: { id?: string } }).applies_to_part?.id === getDevrevView().default_part_id,
        devrev_url: devrevUrl(w.display_id),
        investigation: byTicket[w.display_id] ?? null,
      })),
      next_cursor,
      counts,
    });
  } catch (e) {
    const err = e as DevrevError;
    return Response.json({ error: err.message, tag: err.tag, connection: "devrev" }, { status: 502 });
  }
}
