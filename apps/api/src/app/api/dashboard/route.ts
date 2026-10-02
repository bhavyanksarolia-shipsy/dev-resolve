import { getAccount, getDevrevView } from "@/lib/config";
import { openTickets, ticketCounts, ticketsClosedSince, ticketsCreatedSince, devrevUrl, type WorkRow } from "@/lib/devrev";
import { apiError } from "@/lib/apiError";
import { q } from "@/lib/db";

const DAY = 864e5;
const owner = (w: WorkRow) => (w.owned_by || []).map((o) => o.full_name || o.display_name).filter((n) => n && !/^unassigned$/i.test(n)).join(", ");
const pod = (w: WorkRow) => (typeof w.custom_fields?.tnt__pod === "string" ? w.custom_fields.tnt__pod : "");
const tally = (xs: string[]) => {
  const m = new Map<string, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
};
const brief = (w: WorkRow) => ({ display_id: w.display_id, title: w.title, created: w.created_date, closed: w.actual_close_date ?? null,
  stage: w.stage?.name ?? "", owner: owner(w) || null, pod: pod(w) || null, url: devrevUrl(w.display_id) });

/** One account's dashboard: queue health, triage gaps, workload, flow over the last N days and Dev Resolve's work. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const account = getAccount(sp.get("account") || "");
  if (!account) return Response.json({ error: "unknown account" }, { status: 400 });
  const days = [7, 30, 90].includes(Number(sp.get("days"))) ? Number(sp.get("days")) : 30;
  if (account.client_active === false && sp.get("force") !== "1") return Response.json({ inactive: true });
  const ids = account.devrev.account_ids;
  const since = new Date(Date.now() - days * DAY);
  try {
    const [open, created, closed, counts, invs] = await Promise.all([
      openTickets(ids), ticketsCreatedSince(ids, since.toISOString()), ticketsClosedSince(ids, since.toISOString()), ticketCounts(ids),
      q<{ status: string; confidence: string | null; created_at: string; finished_at: string | null; posted_at: string | null; ticket_display: string }>(
        `SELECT status, confidence, created_at, finished_at, posted_at, ticket_display FROM investigations WHERE account_slug=$1 AND created_at >= $2`, [account.slug, since]),
    ]);
    const now = Date.now(), defPart = getDevrevView().default_part_id;
    const age = (w: WorkRow) => (now - +new Date(w.created_date)) / DAY;
    const buckets = [["Under 1 day", 0, 1], ["1–3 days", 1, 3], ["3–7 days", 3, 7], ["1–4 weeks", 7, 28], ["Over 4 weeks", 28, Infinity]] as const;

    // Opened / closed per day (IST calendar days).
    const dayKey = (iso: string) => new Date(+new Date(iso) + 5.5 * 3600e3).toISOString().slice(0, 10);
    const flow = Array.from({ length: days }, (_, i) => dayKey(new Date(now - (days - 1 - i) * DAY).toISOString()))
      .map((d) => ({ day: d, opened: created.filter((w) => dayKey(w.created_date) === d).length, closed: closed.filter((w) => w.actual_close_date && dayKey(w.actual_close_date) === d).length }));

    const finished = invs.filter((i) => i.finished_at);
    const avgMin = finished.length ? finished.reduce((n, i) => n + (+new Date(i.finished_at!) - +new Date(i.created_at)), 0) / finished.length / 60e3 : null;
    const investigatedOpen = new Set((await q<{ ticket_display: string }>(`SELECT DISTINCT ticket_display FROM investigations WHERE ticket_display = ANY($1)`, [open.map((w) => w.display_id)])).map((r) => r.ticket_display));

    return Response.json({
      account: { slug: account.slug, name: account.name }, days, counts,
      open: {
        total: open.length,
        by_stage: tally(open.map((w) => w.stage?.name ?? "")),
        by_pod: tally(open.map(pod)),
        by_owner: tally(open.map((w) => owner(w))),
        by_age: buckets.map(([label, lo, hi]) => ({ label, count: open.filter((w) => age(w) >= lo && age(w) < hi).length })),
        oldest: [...open].sort((a, b) => +new Date(a.created_date) - +new Date(b.created_date)).slice(0, 6).map(brief),
        gaps: {
          default_part: open.filter((w) => w.applies_to_part?.id === defPart).length,
          no_pod: open.filter((w) => !pod(w)).length,
          unassigned: open.filter((w) => !owner(w)).length,
          not_investigated: open.filter((w) => !investigatedOpen.has(w.display_id)).length,
        },
      },
      flow: { opened: created.length, closed: closed.length, per_day: flow },
      recently_closed: closed.slice(0, 8).map(brief),
      dev_resolve: {
        investigations: invs.length,
        posted: invs.filter((i) => i.posted_at).length,
        draft_ready: invs.filter((i) => i.status === "draft_ready").length,
        failed: invs.filter((i) => i.status === "failed").length,
        running: invs.filter((i) => i.status === "running").length,
        confidence: tally(invs.map((i) => i.confidence ?? "")).filter((c) => c.value),
        avg_minutes: avgMin && Math.round(avgMin * 10) / 10,
        tickets: new Set(invs.map((i) => i.ticket_display)).size,
      },
    });
  } catch (e) {
    return apiError(e);
  }
}
