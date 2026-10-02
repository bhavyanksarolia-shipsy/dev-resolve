import { devUsers, getTicket, resolveFields, type ResolveField } from "@/lib/devrev";
import { sessionUser } from "@/lib/auth";
import { apiError } from "@/lib/apiError";
import { q } from "@/lib/db";

const empty = (v: unknown) => v == null || (typeof v === "string" && /^\s*(\.|-|na|n\/a)?\s*$/i.test(v));
const pick = (f: ResolveField | undefined, ...want: string[]) => want.find((w) => f?.options?.includes(w));

/**
 * What the Resolve form needs: the fields DevRev wants filled on resolve, each ticket's values pre-filled
 * (what's already on the ticket, else drafted from Dev Resolve's RCA), and DevRev users for the CX Lead picker.
 */
export async function GET(req: Request) {
  const ids = (new URL(req.url).searchParams.get("tickets") || "").split(",").map((t) => t.trim()).filter((t) => /^TKT-\d+$/.test(t)).slice(0, 200);
  if (!ids.length) return Response.json({ error: "tickets is required" }, { status: 400 });
  try {
    const tickets = await Promise.all(ids.map((id) => getTicket(id)));
    const [fields, users, viewer] = await Promise.all([resolveFields(tickets[0]), devUsers(), sessionUser(req)]);
    // The signed-in person's DevRev user (matched by their Google email) — the default CX Lead.
    const [acct] = viewer ? await q<{ email: string | null }>(`SELECT email FROM app_users WHERE name=$1`, [viewer.name]) : [];
    const myEmail = acct?.email?.toLowerCase();
    const me = users.find((u) => myEmail && u.email?.toLowerCase() === myEmail)?.id ?? null;
    const invs = await q<{ ticket_display: string; case_draft: { root_cause?: string; resolution?: string; current_status?: string; current_status_detail?: string } | null; category: string | null }>(
      `SELECT DISTINCT ON (ticket_display) ticket_display, case_draft, category FROM investigations
        WHERE ticket_display = ANY($1) AND draft_rca IS NOT NULL ORDER BY ticket_display, id DESC`, [ids]);
    const byTicket = Object.fromEntries(invs.map((i) => [i.ticket_display, i]));
    const f = (name: string) => fields.find((x) => x.key.endsWith(`__${name}`));

    const prefill = Object.fromEntries(tickets.map((t) => {
      const cur = t.custom_fields || {};
      const cd = byTicket[t.display_id]?.case_draft;
      const v: Record<string, unknown> = {};
      for (const fld of fields) v[fld.key] = empty(cur[fld.key]) ? null : cur[fld.key];
      const lead = f("assignee"), review = f("friday_review"), rc = f("root_cause_and_resolution_details"), res = f("resolution"), by = f("resolved_by");
      if (lead && !v[lead.key]) v[lead.key] = me;
      if (rc && !v[rc.key] && cd?.root_cause) {
        v[rc.key] = [`Root cause: ${cd.root_cause}`, cd.resolution && `Resolution: ${cd.resolution}`, cd.current_status_detail && `Status: ${cd.current_status_detail}`].filter(Boolean).join("\n");
      }
      if (res && !v[res.key] && cd) v[res.key] = pick(res, cd.current_status === "resolved_manually" ? "Technical resolution - Workaround provided" : "Technical resolution / configuration") ?? null;
      if (by && !v[by.key]) v[by.key] = pick(by, "Resolved by Support") ?? null;
      if (review && !v[review.key]) v[review.key] = null; // the reviewer judges Friday's RCA — never guessed
      return [t.display_id, { title: t.title, from_rca: !!cd, values: v }];
    }));
    return Response.json({ fields, prefill, users, me });
  } catch (e) {
    return apiError(e);
  }
}
