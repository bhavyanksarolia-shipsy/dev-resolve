import { devUsers, getTicket, podValues, resolveFields, stageMoves, updateTicket } from "@/lib/devrev";
import { currentUser } from "@/lib/auth";
import { q } from "@/lib/db";
import { sessionUser } from "@/lib/auth";

// Resolving: DevRev wants these filled. Anything already on the ticket is kept; empty ones get these defaults.
const DEFAULTS: Record<string, string> = { friday_review: "N/A", resolution: "Others", resolved_by: "Resolved by Support", root_cause_and_resolution_details: "NA" };
const blank = (v: unknown) => v == null || (typeof v === "string" && !v.trim());

/**
 * Change Stage and/or Pod on one or many tickets in DevRev: { tickets: ["TKT-1", …], stage?: "<stage name>", pod?: "WMS" | null }.
 * The stage is given by name and resolved per ticket, because which moves are allowed depends on each ticket's current stage.
 */
export async function POST(req: Request) {
  const by = await currentUser(req);
  // fields: resolve-time custom fields (same for every ticket); perTicket: per-ticket overrides (e.g. each ticket's root cause).
  const b = (await req.json().catch(() => ({}))) as { tickets?: string[]; stage?: string; pod?: string | null;
    fields?: Record<string, unknown>; perTicket?: Record<string, Record<string, unknown>> };
  const tickets = Array.from(new Set((b.tickets || []).map(String).filter((t) => /^TKT-\d+$/.test(t)))).slice(0, 200);
  if (!tickets.length) return Response.json({ error: "Pick at least one ticket" }, { status: 400 });
  if (!b.stage && b.pod === undefined && !b.fields && !b.perTicket) return Response.json({ error: "Nothing to change" }, { status: 400 });

  // The signed-in person's DevRev user — the CX Lead when a resolved ticket has none.
  let me: string | null | undefined;
  const myDevUser = async () => {
    if (me !== undefined) return me;
    const viewer = await sessionUser(req);
    const [acct] = viewer ? await q<{ email: string | null }>(`SELECT email FROM app_users WHERE name=$1`, [viewer.name]) : [];
    me = (await devUsers()).find((u) => acct?.email && u.email?.toLowerCase() === acct.email.toLowerCase())?.id ?? null;
    return me;
  };

  const results: { ticket: string; ok: boolean; stage?: string; pod?: string | null; error?: string }[] = [];
  const queue = [...tickets];
  async function worker() {
    for (let t = queue.shift(); t; t = queue.shift()) {
      const change: { stageId?: string; pod?: string | null; fields?: Record<string, unknown> } = {};
      try {
        const cur = await getTicket(t);
        const want = { ...(b.fields ?? {}), ...(b.perTicket?.[t] ?? {}) };
        if (Object.keys(want).length) {
          const defs = await resolveFields(cur);
          const users = await devUsers();
          for (const [k, v] of Object.entries(want)) {
            const d = defs.find((x) => x.key === k);
            if (!d) throw new Error(`${k} can't be set from Dev Resolve`);
            if (v == null || v === "") continue;
            if (d.type === "enum" && !d.options?.includes(String(v))) throw new Error(`"${v}" isn't a ${d.label} choice`);
            if (d.type === "user" && !users.some((u) => u.id === v)) throw new Error(`${d.label}: unknown DevRev user`);
          }
          change.fields = Object.fromEntries(Object.entries(want).filter(([, v]) => v != null && v !== "").map(([k, v]) => [k, typeof v === "string" ? v.slice(0, 5000) : v]));
        }
        if (b.stage) {
          if (cur.stage?.name === b.stage) throw new Error(`already ${b.stage}`);
          const target = (await stageMoves(cur.subtype, cur.stage?.stage?.id)).find((s) => s.name === b.stage);
          if (!target) throw new Error(`can't move from "${cur.stage?.name}" to "${b.stage}" in DevRev`);
          change.stageId = target.id;
        }
        if (b.stage === "resolved") {
          const cf = cur.custom_fields || {};
          const fill: Record<string, unknown> = {};
          for (const d of await resolveFields(cur)) {
            if (!blank(cf[d.key]) || change.fields?.[d.key] != null) continue;
            const name = d.key.replace(/^(tnt|ctype)__/, "");
            let v: unknown = DEFAULTS[name];
            if (name === "root_cause_and_resolution_details") {
              const [inv] = await q<{ case_draft: { root_cause?: string; resolution?: string } | null }>(
                `SELECT case_draft FROM investigations WHERE ticket_display=$1 AND draft_rca IS NOT NULL ORDER BY id DESC LIMIT 1`, [t]);
              const cd = inv?.case_draft;
              if (cd?.root_cause) v = [`Root cause: ${cd.root_cause}`, cd.resolution && `Resolution: ${cd.resolution}`].filter(Boolean).join("\n").slice(0, 5000);
            }
            if (d.type === "user") v = await myDevUser();
            if (d.type === "enum" && !d.options?.includes(String(v))) v = undefined;
            if (v != null) fill[d.key] = v;
          }
          if (Object.keys(fill).length) change.fields = { ...fill, ...(change.fields ?? {}) };
        }
        if (b.pod !== undefined) {
          if (b.pod !== null && !(await podValues(cur)).includes(b.pod)) throw new Error(`"${b.pod}" isn't a Pod value in DevRev`);
          change.pod = b.pod;
        }
        const w = await updateTicket(cur.id, change, cur.subtype);
        results.push({ ticket: t, ok: true, stage: w.stage?.name, pod: typeof w.custom_fields?.tnt__pod === "string" ? w.custom_fields.tnt__pod : null });
        await q(`INSERT INTO ticket_updates (ticket, changed_by, change, ok) VALUES ($1,$2,$3,true)`, [t, by, JSON.stringify({ stage: b.stage, pod: b.pod, fields: change.fields })]);
      } catch (e) {
        // DevRev answers with JSON ({"message","reason",…}) — show its reason, not the raw body.
        const raw = (e as Error).message.replace(/^DevRev \/works\.update HTTP \d+: /, "");
        let error = raw;
        try { const j = JSON.parse(raw); error = j.reason || j.message || raw; } catch { /* plain text */ }
        results.push({ ticket: t, ok: false, error });
        await q(`INSERT INTO ticket_updates (ticket, changed_by, change, ok, error) VALUES ($1,$2,$3,false,$4)`, [t, by, JSON.stringify({ stage: b.stage, pod: b.pod }), error]).catch(() => {});
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, tickets.length) }, worker));
  const failed = results.filter((r) => !r.ok);
  return Response.json({ ok: !failed.length, updated: results.length - failed.length, failed, results });
}
