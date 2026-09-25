import { q } from "@/lib/db";
import { postInternalComment, DevrevError } from "@/lib/devrev";
import { currentUser } from "@/lib/auth";

/** Human-approved: post the (edited) RCA to the ticket's INTERNAL discussion and record it as a resolved case. */
export async function POST(req: Request, ctx: RouteContext<"/api/investigations/[id]/post">) {
  const { id } = await ctx.params;
  const { rca, rating } = (await req.json()) as { rca?: string; rating?: number };
  if (!rca?.trim()) return Response.json({ error: "rca is required" }, { status: 400 });
  const [inv] = await q<{ ticket_id: string; ticket_display: string; ticket_title: string; account_slug: string; category: string; case_draft: Record<string, unknown> | null; posted_at: string | null; draft_rca: string | null; rca_version: number; posted_version: number }>(
    `SELECT * FROM investigations WHERE id=$1`, [id]);
  if (!inv) return Response.json({ error: "not found" }, { status: 404 });
  // Each RCA version can be posted once; a chat revision (v2, v3…) can be posted as an update.
  if (inv.posted_at && inv.posted_version >= inv.rca_version) return Response.json({ error: `RCA v${inv.rca_version} is already posted` }, { status: 409 });
  const isUpdate = !!inv.posted_at;
  const by = currentUser(req);

  const body = `${isUpdate ? `**Updated RCA (v${inv.rca_version})** — supersedes the earlier Dev Resolve RCA on this ticket.\n\n` : ""}${rca.trim()}\n\n---\n_Dev Resolve RCA v${inv.rca_version} · investigation #${id} · reviewed & posted by ${by}_`;
  let entry;
  try {
    entry = await postInternalComment(inv.ticket_id, body);
  } catch (e) {
    const err = e as DevrevError;
    return Response.json({ error: err.message, tag: err.tag, connection: "devrev" }, { status: 502 });
  }
  await q(`UPDATE investigations SET final_rca=$2, rating=COALESCE($3, rating), status='posted', posted_at=now(), posted_comment_id=$4, posted_version=rca_version, posted_by=$5 WHERE id=$1`, [id, rca, rating ?? null, entry.id, by]);
  const cd = inv.case_draft || {};
  const caseValues = [inv.account_slug, inv.ticket_display, inv.ticket_title, inv.category, cd.symptoms ?? null, cd.root_cause ?? null, cd.resolution ?? null, JSON.stringify(cd.evidence ?? [])];
  const updated = await q(`UPDATE cases SET account_slug=$2, ticket_display=$3, title=$4, category=$5, symptoms=$6, root_cause=$7, resolution=$8, evidence=$9 WHERE investigation_id=$1 RETURNING id`, [id, ...caseValues]);
  if (!updated.length) {
    await q(`INSERT INTO cases (investigation_id, account_slug, ticket_display, title, category, symptoms, root_cause, resolution, evidence) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id, ...caseValues]);
  }
  // The human's edits are the strongest signal: if they changed the draft, queue it for playbook review.
  if (inv.draft_rca && inv.draft_rca.trim() !== rca.trim()) {
    await q(
      `INSERT INTO knowledge_proposals (investigation_id, account_slug, file, content, rationale, source)
       VALUES ($1,$2,'playbook.md',$3,'Reviewer edited the draft RCA before posting — distil what the agent got wrong into a playbook rule, or reject.','human_edit')`,
      [id, inv.account_slug, `**Reviewer correction on ${inv.ticket_display}** — final RCA differed from draft. Final root cause:\n\n${rca.split("## Root cause")[1]?.split("\n## ")[0]?.trim() ?? rca.slice(0, 1500)}`],
    );
  }
  return Response.json({ ok: true, comment_id: entry.id });
}
