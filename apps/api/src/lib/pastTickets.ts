import "server-only";
import { listAllWorks, listTimeline, devrevUrl, type WorkRow } from "./devrev";
import { withEmailSenders } from "./attachments";

/**
 * Past DevRev tickets of a client that look like this one, and how they were closed (resolution fields + the last
 * comments, where the real outcome usually is — e.g. "client team confirmed, nothing on Shipsy's end").
 * Closed tickets of the last 9 months are cached per client for 6 h (DevRev takes ~10 s to list them).
 */
const cache = new Map<string, { at: number; works: Promise<WorkRow[]> }>();
const TTL = 6 * 60 * 60 * 1000;

function closedTickets(key: string, accountIds: string[]) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return hit.works;
  const after = new Date(Date.now() - 270 * 864e5).toISOString();
  const works = listAllWorks({ type: ["ticket"], ticket: { account: accountIds }, stage: { name: ["resolved", "canceled"] },
    actual_close_date: { type: "range", after }, sort_by: ["actual_close_date:desc"] }, 1500);
  works.catch(() => cache.delete(key));
  cache.set(key, { at: Date.now(), works });
  return works;
}

const STOP = new Set(["the", "and", "for", "with", "from", "issue", "issues", "regarding", "request", "please", "team", "dear", "not", "are", "this",
  "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec", "january", "february", "march", "april", "june", "july",
  "august", "september", "october", "november", "december", "month", "of"]);
const words = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w)));

export async function pastTickets(key: string, accountIds: string[], title: string, opts: { exclude?: string; limit?: number } = {}) {
  const mine = words(title);
  if (!mine.size) return [];
  const closed = (await closedTickets(key, accountIds)).filter((w) => w.display_id !== opts.exclude);
  const scored = closed.map((w) => {
    const theirs = words(w.title);
    const common = [...mine].filter((x) => theirs.has(x)).length;
    return { w, score: common / Math.max(1, Math.min(mine.size, theirs.size) + 0.5 * Math.abs(mine.size - theirs.size)) };
  }).filter((x) => x.score >= 0.4).sort((a, b) => b.score - a.score || (b.w.actual_close_date ?? "").localeCompare(a.w.actual_close_date ?? ""));
  const top = scored.slice(0, opts.limit ?? 6);
  // The outcome is usually in the last comments — read them for the closest few.
  return Promise.all(top.map(async ({ w, score }, i) => {
    const cf = w.custom_fields || {};
    const tl = i < 4 ? await listTimeline(w.id, 6).then(withEmailSenders).catch(() => []) : [];
    const last = tl.filter((c) => (c.body || "").trim() && !/Ticket Acknowledgement|Was Friday's RCA/i.test(`${c.created_by?.display_name} ${c.body?.slice(0, 60)}`))
      .slice(0, 4).map((c) => ({ when: c.created_date.slice(0, 16), who: c.created_by?.display_name, visibility: c.visibility,
        text: (c.body || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 700) }));
    return {
      ticket: w.display_id, title: w.title, closed: w.actual_close_date?.slice(0, 10), stage: w.stage?.name, similarity: Math.round(score * 100) / 100,
      resolution: cf.tnt__resolution ?? null, resolved_by: cf.tnt__resolved_by ?? null,
      root_cause_note: typeof cf.ctype__root_cause_and_resolution_details === "string" && cf.ctype__root_cause_and_resolution_details.trim().length > 3 ? cf.ctype__root_cause_and_resolution_details : null,
      last_comments: last, url: devrevUrl(w.display_id),
    };
  }));
}
