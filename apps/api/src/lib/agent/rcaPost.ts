import "server-only";
import { q } from "../db";
import { postInternalComment, DevrevError } from "../devrev";
import { forgetConversation } from "../conversation";

/**
 * Post an RCA to the ticket's INTERNAL discussion and record it as posted — shared by the human "Approve & post"
 * route and the agent's own automatic post-on-submit. Every new RCA version posts itself now, clearly labeled as
 * unreviewed, because relying on a human to remember to click "Approve & post" was leaving investigations that had
 * a perfectly good draft sitting unposted — which also silently undercounted the dashboard's "posted" number.
 * A human can still review and re-post (edited or not) afterward; that goes through the same repost path as today.
 */
export async function postRca(
  id: string | number,
  rca: string,
  opts: { by: string; rating?: number; again?: boolean; auto?: boolean },
): Promise<{ ok: true; comment_id: string } | { ok: false; error: string; status: number; tag?: string }> {
  const [inv] = await q<{
    ticket_id: string; ticket_display: string; ticket_title: string; account_slug: string; category: string;
    case_draft: Record<string, unknown> | null; posted_at: string | null; draft_rca: string | null; final_rca: string | null;
    rca_version: number; posted_version: number;
  }>(`SELECT * FROM investigations WHERE id=$1`, [id]);
  if (!inv) return { ok: false, error: "not found", status: 404 };
  // A version that's already posted goes again only when asked explicitly (again: true, after a confirm) — auto-post
  // never hits this itself, since it always runs right after rca_version was just bumped.
  const repost = !!inv.posted_at && inv.posted_version >= inv.rca_version;
  if (repost && !opts.again) return { ok: false, error: `RCA v${inv.rca_version} is already posted`, status: 409 };
  const isUpdate = !!inv.posted_at;
  const label = opts.auto ? "posted automatically — not yet reviewed by a human" : `reviewed & posted by ${opts.by}`;

  const body = `${repost ? `**RCA v${inv.rca_version} (posted again${inv.final_rca && inv.final_rca.trim() !== rca.trim() ? ", edited" : ""})** — supersedes the earlier Dev Resolve RCA on this ticket.\n\n`
    : isUpdate ? `**Updated RCA (v${inv.rca_version})** — supersedes the earlier Dev Resolve RCA on this ticket.\n\n` : ""
  }${rca.trim()}\n\n---\n_Dev Resolve RCA v${inv.rca_version} · investigation #${id} · ${label}_`;

  let entry;
  try {
    entry = await postInternalComment(inv.ticket_id, body);
    forgetConversation(inv.ticket_id); // the ticket page shows the new comment on its next load
  } catch (e) {
    const err = e as DevrevError;
    return { ok: false, error: err.message, status: 502, tag: err.tag };
  }

  await q(`UPDATE investigations SET final_rca=$2, rating=COALESCE($3, rating), status='posted', posted_at=now(), posted_comment_id=$4, posted_version=rca_version, posted_by=$5 WHERE id=$1`,
    [id, rca, opts.rating ?? null, entry.id, opts.by]);

  const cd = inv.case_draft || {};
  const caseValues = [inv.account_slug, inv.ticket_display, inv.ticket_title, inv.category, cd.symptoms ?? null, cd.root_cause ?? null, cd.resolution ?? null, JSON.stringify(cd.evidence ?? [])];
  const updated = await q(`UPDATE cases SET account_slug=$2, ticket_display=$3, title=$4, category=$5, symptoms=$6, root_cause=$7, resolution=$8, evidence=$9 WHERE investigation_id=$1 RETURNING id`, [id, ...caseValues]);
  if (!updated.length) {
    await q(`INSERT INTO cases (investigation_id, account_slug, ticket_display, title, category, symptoms, root_cause, resolution, evidence) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [id, ...caseValues]);
  }

  // A human's edit is the strongest signal — only meaningful when a human actually reviewed/changed it, not on an
  // automatic post where "rca" is exactly what the agent already drafted.
  if (!opts.auto && inv.draft_rca && inv.draft_rca.trim() !== rca.trim()) {
    await q(
      `INSERT INTO knowledge_proposals (investigation_id, account_slug, file, content, rationale, source)
       VALUES ($1,$2,'playbook.md',$3,'Reviewer edited the draft RCA before posting — distil what the agent got wrong into a playbook rule, or reject.','human_edit')`,
      [id, inv.account_slug, `**Reviewer correction on ${inv.ticket_display}** — final RCA differed from draft. Final root cause:\n\n${rca.split("## Root cause")[1]?.split("\n## ")[0]?.trim() ?? rca.slice(0, 1500)}`],
    );
  }
  return { ok: true, comment_id: entry.id };
}
