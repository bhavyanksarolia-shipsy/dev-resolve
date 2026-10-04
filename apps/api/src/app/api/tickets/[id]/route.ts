import { getTicket, devrevUrl } from "@/lib/devrev";
import { apiError } from "@/lib/apiError";
import { investigable, resolveDevrevAccount } from "@/lib/config";
import { conversation } from "@/lib/conversation";
import { q } from "@/lib/db";

/**
 * The ticket page. Fast part (ticket, routing, investigations) by default; ?part=conversation returns the
 * comments + attachments, which take DevRev several seconds — cached per ticket until DevRev's modified time changes.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/tickets/[id]">) {
  const { id } = await ctx.params;
  const sp = new URL(req.url).searchParams;
  try {
    const ticket = await getTicket(id);
    const modified = ticket.modified_date ?? "";
    if (sp.get("part") === "conversation") return Response.json(await conversation(ticket.id, modified, sp.get("refresh") === "1"));
    // Start loading the conversation now so it's ready (or nearly) when the page asks for it.
    void conversation(ticket.id, modified).catch(() => {});
    const investigations = await q(`SELECT id, status, confidence, category, created_at, finished_at, posted_at FROM investigations WHERE ticket_display=$1 ORDER BY id DESC`, [ticket.display_id]);
    const routing = resolveDevrevAccount(ticket.account?.id);
    const can = investigable(ticket.account?.id);
    return Response.json({
      ticket,
      devrev_url: devrevUrl(ticket.display_id),
      investigations,
      can_investigate: can.ok, investigate_blocked: can.ok ? null : can.reason,
      routing: routing.kind === "account" ? { kind: "account", account: routing.account.slug, name: routing.account.name }
        : routing.kind === "ambiguous" ? { kind: "ambiguous", candidates: routing.candidates.map((c) => c.slug) }
        : { kind: routing.kind },
    });
  } catch (e) {
    return apiError(e);
  }
}
