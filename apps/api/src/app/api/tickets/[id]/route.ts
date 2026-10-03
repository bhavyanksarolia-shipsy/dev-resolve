import { getTicket, listTimeline, devrevUrl } from "@/lib/devrev";
import { apiError } from "@/lib/apiError";
import { resolveDevrevAccount } from "@/lib/config";
import { listAttachments, withEmailSenders } from "@/lib/attachments";
import { q } from "@/lib/db";

/**
 * The ticket page. Fast part (ticket, routing, investigations) by default; ?part=conversation returns the
 * comments + attachments, which take DevRev several seconds — cached per ticket until DevRev's modified time changes.
 */
type Conversation = { timeline: Awaited<ReturnType<typeof listTimeline>>; attachments: Awaited<ReturnType<typeof listAttachments>> };
const conversations = new Map<string, { modified: string; at: number; value: Promise<Conversation> }>();
const CONV_TTL_MS = 10 * 60 * 1000;

async function loadConversation(ticketId: string): Promise<Conversation> {
  const timeline = await listTimeline(ticketId).catch(() => []);
  // Senders and attachments both read the attached emails — run together (one download each, see parseEmail).
  const [, attachments] = await Promise.all([withEmailSenders(timeline).catch(() => timeline), listAttachments(timeline).catch(() => [])]);
  return { timeline, attachments };
}

function conversation(ticketId: string, modified: string, force = false) {
  const hit = conversations.get(ticketId);
  if (!force && hit && hit.modified === modified && Date.now() - hit.at < CONV_TTL_MS) return hit.value;
  const value = loadConversation(ticketId);
  value.catch(() => conversations.delete(ticketId));
  conversations.set(ticketId, { modified, at: Date.now(), value });
  if (conversations.size > 300) conversations.delete(conversations.keys().next().value!);
  return value;
}

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
    return Response.json({
      ticket,
      devrev_url: devrevUrl(ticket.display_id),
      investigations,
      routing: routing.kind === "account" ? { kind: "account", account: routing.account.slug, name: routing.account.name }
        : routing.kind === "ambiguous" ? { kind: "ambiguous", candidates: routing.candidates.map((c) => c.slug) }
        : { kind: routing.kind },
    });
  } catch (e) {
    return apiError(e);
  }
}
