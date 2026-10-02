import { getDevrevView, ticketScope } from "@/lib/config";
import { listTickets, ticketCounts, devrevUrl } from "@/lib/devrev";
import { apiError } from "@/lib/apiError";
import { q } from "@/lib/db";

export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const account = ticketScope(sp.get("account"));
  if (!account) return Response.json({ error: "unknown account" }, { status: 400 });
  // Inactive client: don't call DevRev unless the user explicitly asks to load anyway.
  if (account.inactive && sp.get("force") !== "1") {
    return Response.json({ inactive: true, tickets: [], next_cursor: null, counts: null });
  }
  try {
    // all=1: every open ticket of the account (the inbox sorts / filters / pages them itself). Capped at 1000.
    const all = sp.get("all") === "1";
    const loadAll = async () => {
      const works: Awaited<ReturnType<typeof listTickets>>["works"] = [];
      let cursor: string | undefined;
      for (let i = 0; i < 10; i++) {
        const r = await listTickets(account.ids, { limit: 100, cursor });
        works.push(...r.works);
        cursor = r.next_cursor;
        if (!cursor) break;
      }
      return { works, next_cursor: undefined as string | undefined };
    };
    const [{ works, next_cursor }, counts] = await Promise.all([
      all ? loadAll() : listTickets(account.ids, { limit: 25, cursor: sp.get("cursor") || undefined }),
      ticketCounts(account.ids),
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
        id: w.id, display_id: w.display_id, title: w.title, stage: w.stage?.display_name || w.stage?.name, stage_name: w.stage?.name,
        severity: w.severity, created_date: w.created_date, account: w.account?.display_name,
        part: (w as { applies_to_part?: { name?: string } }).applies_to_part?.name,
        default_part: (w as { applies_to_part?: { id?: string } }).applies_to_part?.id === getDevrevView().default_part_id,
        pod: typeof w.custom_fields?.tnt__pod === "string" ? w.custom_fields.tnt__pod : null,
        // DevRev's placeholder user "Unassigned" means nobody — same rule as the dashboard.
        owner: (w.owned_by || []).map((o) => o.full_name || o.display_name).filter((n) => n && !/^unassigned$/i.test(n)).join(", ") || null,
        devrev_url: devrevUrl(w.display_id),
        investigation: byTicket[w.display_id] ?? null,
      })),
      next_cursor,
      counts,
    });
  } catch (e) {
    return apiError(e);
  }
}
