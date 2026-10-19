import { isLocked, withLock } from "@/lib/db";
import { currentUser } from "@/lib/auth";
import { postRca } from "@/lib/agent/rcaPost";

/** Human review/edit, then post (or re-post) the RCA to the ticket's INTERNAL discussion — most versions already
 * posted themselves automatically on submit; this is for a human who wants to edit first, or post one again. */
/** One post at a time per investigation: a double click or a second reviewer gets "already posting", not a duplicate comment. */
export async function POST(req: Request, ctx: RouteContext<"/api/investigations/[id]/post">) {
  const { id } = await ctx.params;
  try {
    return await withLock(`post-rca:${id}`, "This RCA is being posted right now — wait a moment.", () => handle(req, id));
  } catch (e) {
    if (isLocked(e)) return Response.json({ error: e.message }, { status: 409 });
    throw e;
  }
}

async function handle(req: Request, id: string) {
  const { rca, rating, again } = (await req.json()) as { rca?: string; rating?: number; again?: boolean };
  if (!rca?.trim()) return Response.json({ error: "rca is required" }, { status: 400 });
  const by = await currentUser(req);
  const r = await postRca(id, rca, { by, rating, again });
  if (!r.ok) return Response.json({ error: r.error, ...(r.tag && { tag: r.tag }), ...(r.status === 502 && { connection: "devrev" }) }, { status: r.status });
  return Response.json({ ok: true, comment_id: r.comment_id });
}
