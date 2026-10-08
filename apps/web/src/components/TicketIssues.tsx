"use client";
import { useEffect, useState } from "react";

interface Issue { id: string; display_id: string; title: string; owner: string | null; stage: string | null; state: string | null; priority: string | null; url: string }

// Answers kept for this page visit, so opening a row again is instant (the server also keeps them 5 min).
const cache = new Map<string, Issue[] | { error: string }>();

/** The row's issue button: the same for every ticket — nothing is asked from DevRev until it's opened. */
export function IssuesToggle({ open, onClick, ticket }: { open: boolean; onClick: () => void; ticket: string }) {
  return (
    <button type="button" onClick={onClick} aria-expanded={open} aria-label={`${open ? "Hide" : "Show"} issues linked to ${ticket}`} title={open ? "Hide linked issues" : "Linked issues"}
      className={`grid h-7 w-7 place-items-center rounded-md transition-colors ${open ? "bg-accent-soft text-accent-strong" : "text-muted hover:bg-accent-soft hover:text-accent-strong"}`}>
      <svg className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
    </button>
  );
}

const STATE_TONE = (s: string | null) =>
  /closed|done|resolved|complete|cancel/i.test(s ?? "") ? "bg-emerald-50 text-ok ring-emerald-200"
  : /progress|develop|review|test/i.test(s ?? "") ? "bg-amber-50 text-warn ring-amber-200"
  : "bg-bg text-muted ring-line";

/**
 * The panel under a ticket row: the DevRev issues linked to it (id, title, owner, status), each opening in DevRev.
 * Fetched only the first time it's opened, with a skeleton meanwhile; opens and closes with a short slide.
 */
export function IssuesPanel({ ticket, open, cols }: { ticket: string; open: boolean; cols: number }) {
  const [data, setData] = useState<Issue[] | { error: string } | null>(() => cache.get(ticket) ?? null);
  const [shown, setShown] = useState(open); // stays mounted while closing, so it can slide shut

  useEffect(() => {
    if (open) { const t = setTimeout(() => setShown(true), 0); return () => clearTimeout(t); }
    const t = setTimeout(() => setShown(false), 220);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open || cache.has(ticket)) return;
    let live = true;
    fetch(`/api/tickets/${encodeURIComponent(ticket)}/issues`, { cache: "no-store" })
      .then(async (r) => { const d = await r.json().catch(() => ({})); return r.ok ? (d.issues as Issue[]) : { error: d.error || `HTTP ${r.status}` }; })
      .catch(() => ({ error: "Couldn't reach DevRev" }))
      .then((v) => { if (!("error" in v)) cache.set(ticket, v); if (live) setData(v); });
    return () => { live = false; };
  }, [open, ticket]);

  if (!open && !shown) return null;
  return (
    <tr className="!border-0">
      <td colSpan={cols} className="p-0">
        <div className={`grid transition-[grid-template-rows] duration-200 ease-out ${open && shown ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
          <div className="overflow-hidden">
            <div className="border-l-[3px] border-accent bg-accent-soft/40 px-5 py-3">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-head-fg">Linked issues</div>
              {!data && (
                <div className="space-y-2">{[0, 1].map((i) => <div key={i} className="flex items-center gap-3"><div className="skeleton h-4 w-20" /><div className="skeleton h-4 flex-1" /><div className="skeleton h-4 w-24" /><div className="skeleton h-4 w-20" /></div>)}</div>
              )}
              {data && "error" in data && <p className="text-sm text-bad">Couldn&apos;t load the issues — {data.error}</p>}
              {data && !("error" in data) && !data.length && <p className="text-sm text-muted">No issues attached to this ticket.</p>}
              {data && !("error" in data) && data.length > 0 && (
                <ul className="divide-y divide-line/70 overflow-hidden rounded-lg bg-panel/80 ring-1 ring-line">
                  {data.map((x) => (
                    <li key={x.id}>
                      <a href={x.url} target="_blank" rel="noreferrer" title="Open in DevRev"
                        className="grid grid-cols-[6.5rem_1fr_auto_auto] items-center gap-4 px-3 py-2 text-sm transition-colors hover:bg-accent-soft/60">
                        <span className="font-mono font-medium text-accent-strong">{x.display_id} <span className="text-xs text-muted">↗</span></span>
                        <span className="truncate" title={x.title}>{x.title}</span>
                        <span className="whitespace-nowrap text-xs text-muted">{x.owner ?? "unassigned"}</span>
                        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${STATE_TONE(x.state || x.stage)}`}>{x.stage ?? x.state ?? "—"}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}
