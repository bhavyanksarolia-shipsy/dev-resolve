import { getTicket, listTimeline, devrevUrl } from "@/lib/devrev";
import { apiError } from "@/lib/apiError";
import { resolveDevrevAccount } from "@/lib/config";
import { listAttachments, withEmailSenders } from "@/lib/attachments";
import { q } from "@/lib/db";

export async function GET(_req: Request, ctx: RouteContext<"/api/tickets/[id]">) {
  const { id } = await ctx.params;
  try {
    const ticket = await getTicket(id);
    const [timeline, investigations] = await Promise.all([
      listTimeline(ticket.id).then(withEmailSenders).catch(() => []),
      q(`SELECT id, status, confidence, category, created_at, finished_at, posted_at FROM investigations WHERE ticket_display=$1 ORDER BY id DESC`, [ticket.display_id]),
    ]);
    const attachments = await listAttachments(timeline).catch(() => []);
    const routing = resolveDevrevAccount(ticket.account?.id);
    return Response.json({
      ticket,
      devrev_url: devrevUrl(ticket.display_id),
      timeline,
      attachments,
      investigations,
      routing: routing.kind === "account" ? { kind: "account", account: routing.account.slug, name: routing.account.name }
        : routing.kind === "ambiguous" ? { kind: "ambiguous", candidates: routing.candidates.map((c) => c.slug) }
        : { kind: routing.kind },
    });
  } catch (e) {
    return apiError(e);
  }
}
