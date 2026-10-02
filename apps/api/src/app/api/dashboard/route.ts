import { getAccount, getDevrevView, ticketScope } from "@/lib/config";
import { countClosed, countCreated, openTickets, ticketCounts, ticketsClosedSince, ticketsCreatedSince, devrevUrl, type WorkRow } from "@/lib/devrev";
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
  const account = ticketScope(sp.get("account") || "all");
  if (!account) return Response.json({ error: "unknown account" }, { status: 400 });
  // Period: from / to as IST calendar dates (YYYY-MM-DD), inclusive. Default: the last 30 days. At most a year.
  const IST = 5.5 * 3600e3;
  const istDay = (t: number) => new Date(t + IST).toISOString().slice(0, 10);
  const isDate = (v: string | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const today = istDay(Date.now());
  let to = isDate(sp.get("to")) ? sp.get("to")! : today;
  if (to > today) to = today;
  let from = isDate(sp.get("from")) ? sp.get("from")! : istDay(+new Date(`${to}T00:00:00Z`) - 29 * DAY);
  if (from > to) from = to;
  if (+new Date(to) - +new Date(from) > 365 * DAY) from = istDay(+new Date(`${to}T00:00:00Z`) - 365 * DAY);
  const days = Math.round((+new Date(to) - +new Date(from)) / DAY) + 1;
  if (account.inactive && sp.get("force") !== "1") return Response.json({ inactive: true });
  const ids = account.ids;
  const since = new Date(+new Date(`${from}T00:00:00Z`) - IST);          // from, 00:00 IST
  const until = new Date(+new Date(`${to}T00:00:00Z`) - IST + DAY - 1);  // to, 23:59:59 IST
  try {
    const [openedTotal, closedTotal] = await Promise.all([countCreated(ids, since.toISOString(), until.toISOString()), countClosed(ids, since.toISOString(), until.toISOString())]);
    const [openAll, createdAll, closedAll, counts, invsAll] = await Promise.all([
      openTickets(ids), ticketsCreatedSince(ids, since.toISOString(), until.toISOString()), ticketsClosedSince(ids, since.toISOString(), until.toISOString()), ticketCounts(ids),
      q<{ status: string; confidence: string | null; created_at: string; finished_at: string | null; posted_at: string | null; ticket_display: string }>(
        `SELECT status, confidence, created_at, finished_at, posted_at, ticket_display FROM investigations WHERE account_slug = ANY($1) AND created_at BETWEEN $2 AND $3`, [account.slugs, since, until]),
    ]);
    // Pod filter: pod=A|B ("-" = not set) applies to everything below. The list of Pods (for the picker) is always complete.
    const podParam = sp.get("pod");
    const podWanted = podParam ? new Set(podParam.split("|").map((v) => (v === "-" ? "" : v))) : null;
    const byPod = <T extends WorkRow>(xs: T[]) => (podWanted == null ? xs : xs.filter((w) => podWanted.has(pod(w))));
    const open = byPod(openAll), created = byPod(createdAll), closed = byPod(closedAll);
    const podTickets = podWanted == null ? null : new Set([...openAll, ...createdAll, ...closedAll].filter((w) => podWanted.has(pod(w))).map((w) => w.display_id));
    const invs = podTickets ? invsAll.filter((i) => podTickets.has(i.ticket_display)) : invsAll;

    // Pod × status: open tickets per Pod and stage, plus how many of that Pod closed in the period.
    const stages = tally(openAll.map((w) => w.stage?.name ?? "")).map((x) => x.value);
    const podRows = tally(openAll.map(pod)).map(({ value, count }) => {
      const mine = openAll.filter((w) => pod(w) === value);
      return { pod: value, open: count, by_stage: Object.fromEntries(stages.map((st) => [st, mine.filter((w) => (w.stage?.name ?? "") === st).length])),
        closed: closedAll.filter((w) => pod(w) === value).length };
    });
    for (const v of new Set(closedAll.map(pod))) if (!podRows.some((r) => r.pod === v)) podRows.push({ pod: v, open: 0, by_stage: Object.fromEntries(stages.map((st) => [st, 0])), closed: closedAll.filter((w) => pod(w) === v).length });
    const now = Date.now(), defPart = getDevrevView().default_part_id;
    const age = (w: WorkRow) => (now - +new Date(w.created_date)) / DAY;
    const buckets = [["Under 1 day", 0, 1], ["1–3 days", 1, 3], ["3–7 days", 3, 7], ["1–4 weeks", 7, 28], ["Over 4 weeks", 28, Infinity]] as const;

    // Opened / closed per IST day — per week (starting on `from`) when the period is longer than ~3 months.
    const step = days > 92 ? 7 : 1;
    const bucketOf = (iso: string) => Math.floor((+new Date(`${istDay(+new Date(iso))}T00:00:00Z`) - +new Date(`${from}T00:00:00Z`)) / DAY / step);
    const flow = Array.from({ length: Math.ceil(days / step) }, (_, i) => ({ day: istDay(+new Date(`${from}T00:00:00Z`) + i * step * DAY - IST + 1), opened: 0, closed: 0 }));
    for (const w of created) { const b = bucketOf(w.created_date); if (flow[b]) flow[b].opened++; }
    for (const w of closed) { if (!w.actual_close_date) continue; const b = bucketOf(w.actual_close_date); if (flow[b]) flow[b].closed++; }

    const finished = invs.filter((i) => i.finished_at);
    const avgMin = finished.length ? finished.reduce((n, i) => n + (+new Date(i.finished_at!) - +new Date(i.created_at)), 0) / finished.length / 60e3 : null;
    const investigatedOpen = new Set((await q<{ ticket_display: string }>(`SELECT DISTINCT ticket_display FROM investigations WHERE ticket_display = ANY($1)`, [open.map((w) => w.display_id)])).map((r) => r.ticket_display));

    return Response.json({
      account: { slug: account.slug, name: account.name }, days, from, to, step, counts,
      open: {
        total: open.length,
        by_stage: tally(open.map((w) => w.stage?.name ?? "")),
        by_pod: tally(open.map(pod)),
        by_owner: tally(open.map((w) => owner(w))),
        by_age: buckets.map(([label, lo, hi]) => ({ label, min: lo, max: Number.isFinite(hi) ? hi : null, count: open.filter((w) => age(w) >= lo && age(w) < hi).length })),
        oldest: [...open].sort((a, b) => +new Date(a.created_date) - +new Date(b.created_date)).slice(0, 6).map(brief),
        gaps: {
          default_part: open.filter((w) => w.applies_to_part?.id === defPart).length,
          no_pod: open.filter((w) => !pod(w)).length,
          unassigned: open.filter((w) => !owner(w)).length,
          not_investigated: open.filter((w) => !investigatedOpen.has(w.display_id)).length,
        },
      },
      // Totals are exact (DevRev counts); the chart covers what was fetched — `partial` if a list hit its cap.
      // Per client (in this scope): open now, opened / closed in the period, unassigned, oldest open — Pod filter applied.
      by_client: account.slugs.map((slug) => {
        const a = getAccount(slug)!;
        const mine = new Set(a.devrev.account_ids);
        const of = (xs: WorkRow[]) => xs.filter((w) => w.account?.id && mine.has(w.account.id));
        const o = of(open);
        const oldest = o.reduce((m, w) => Math.max(m, age(w)), 0);
        return { slug, name: a.name, open: o.length, opened: of(created).length, closed: of(closed).length,
          unassigned: o.filter((w) => !owner(w)).length, oldest_days: o.length ? Math.floor(oldest) : null };
      }).filter((c) => c.open || c.opened || c.closed).sort((x, y) => y.open - x.open || y.opened - x.opened || x.name.localeCompare(y.name)),
      pod: podWanted ? [...podWanted] : null, pod_status: { stages, rows: podRows },
      // Totals: exact DevRev counts for all Pods; with a Pod filter they're counted from the fetched tickets.
      flow: podWanted == null
        ? { opened: openedTotal, closed: closedTotal, per_day: flow, partial: createdAll.length < openedTotal || closedAll.length < closedTotal }
        : { opened: created.length, closed: closed.length, per_day: flow, partial: createdAll.length < openedTotal || closedAll.length < closedTotal },
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
