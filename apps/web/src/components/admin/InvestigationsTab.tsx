"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { confirmDialog, toast } from "@/components/Dialog";
import { btn, post, Select } from "./ui";
import { Pager } from "@/components/TableTools";

interface Row {
  id: number; ticket_display: string; ticket_title: string; account: string; kind: "investigation" | "chat";
  state: "running" | "queued" | "starting" | "stuck" | "failed" | "draft_ready" | "posted" | string;
  started_by: string | null; who: string | null; email: string | null; chat_by: string | null;
  created_at: string; finished_at: string | null; runningSince: string | null; position: number | null; waitMin: number | null;
  error: string | null; confidence: string | null; superseded: boolean;
}
interface Page { page: number; pageSize: number; total: number; rows: Row[]; counts: { active: number; failed: number }; limits: { parallel: number; perPerson: number } }

const FILTERS = [["all", "All"], ["active", "Running & queued"], ["failed", "Failed"], ["done", "Finished"]] as const;
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
const dur = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
};
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

const CHIP: Record<string, [string, string]> = {
  running: ["running", "bg-amber-50 text-warn ring-amber-200"], queued: ["queued", "bg-sky-50 text-sky-700 ring-sky-200"],
  starting: ["starting", "bg-amber-50 text-warn ring-amber-200"], stuck: ["stuck", "bg-red-50 text-bad ring-red-200"],
  failed: ["failed", "bg-red-50 text-bad ring-red-200"], draft_ready: ["draft ready", "bg-accent-soft text-accent-strong ring-emerald-200"],
  posted: ["posted", "bg-emerald-50 text-ok ring-emerald-200"],
};

/**
 * Admin → Investigations: everything running, waiting or finished, newest first — with Stop (running or stuck),
 * Remove from queue (waiting) and Retry (failed, runs again for the person who started it, with their notes and files).
 */
export function InvestigationsTab() {
  const [status, setStatus] = useState<(typeof FILTERS)[number][0]>("all");
  const [term, setTerm] = useState("");
  const [page, setPage] = useState(1);
  const [d, setD] = useState<Page | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [size, setSize] = useState(25);
  const [loading, setLoading] = useState(false);
  const [now, setNow] = useState(0); // the clock for the live run times, ticking every second

  const load = useCallback(() => {
    const qs = new URLSearchParams({ status, page: String(page), size: String(size), ...(term.trim() && { q: term.trim() }) });
    return fetch(`/api/admin/investigations?${qs}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((x) => x && setD(x)).catch(() => {});
  }, [status, page, size, term]);
  useEffect(() => { const t = setTimeout(load, term ? 300 : 0); return () => clearTimeout(t); }, [load, term]);
  useEffect(() => { // live: refresh the list every 10 s, tick the clocks every second
    const a = setInterval(load, 10_000), b = setInterval(() => setNow(Date.now()), 1000), c = setTimeout(() => setNow(Date.now()), 0);
    return () => { clearInterval(a); clearInterval(b); clearTimeout(c); };
  }, [load]);

  const act = async (r: Row, action: "stop" | "dequeue" | "retry") => {
    const what = action === "stop" ? (r.state === "stuck" ? "Clear this stuck run" : "Stop this run") : action === "dequeue" ? "Remove from the queue" : "Retry";
    const ok = await confirmDialog({
      title: `${what} — ${r.ticket_display}?`,
      message: action === "retry"
        ? `It starts again for ${r.who || r.started_by || "the person who started it"}, with the same notes and files, and they get the notification.`
        : action === "dequeue" ? "It won't start. The person can start it again later." : "The agent stops now; what it found so far stays in the trail.",
      confirmLabel: what, danger: action !== "retry",
    });
    if (!ok) return;
    setBusy(r.id);
    const res = await post<{ message?: string }>("/api/admin/investigations", { id: r.id, action });
    setBusy(null);
    toast({ ok: !res.error, text: res.error || res.message || "Done" });
    void load();
    window.dispatchEvent(new Event("investigations-changed"));
  };

  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;
  const th = "px-4 py-3";
  return (
    <div className="space-y-3 lg:flex lg:h-[calc(100dvh-11rem)] lg:flex-col lg:space-y-0 lg:[&>*+*]:mt-3">
      {/* The same compact toolbar as Tickets: which runs · search on the right. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="w-64">
          <Select value={status} onChange={(v) => { setStatus(v as typeof status); setPage(1); }} options={FILTERS.map(([k, l]) => ({
            value: k, label: k === "active" && d ? `${l} · ${d.counts.active}` : k === "failed" && d ? `${l} · ${d.counts.failed}` : l,
            hint: k === "failed" ? "open failures — the ticket's latest run failed" : k === "active" ? "live, refreshes every 10 s" : undefined,
          }))} />
        </div>
        <input value={term} onChange={(e) => { setTerm(e.target.value); setPage(1); }} placeholder="Search ticket or title"
          className="ml-auto w-72 rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft" />
      </div>

      <section className="card overflow-hidden lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
        <div className="flex flex-wrap items-center gap-3 px-5 py-4">
          <div>
            <h2 className="font-semibold">Investigations</h2>
            <p className="text-xs text-muted">Newest first{d ? ` · at most ${d.limits.parallel} run at once, ${d.limits.perPerson} per person while others wait (Connections → Claude)` : ""}</p>
          </div>
          <button onClick={() => { setLoading(true); void load().finally(() => setLoading(false)); }} disabled={loading}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-3 py-1.5 text-sm font-medium hover:border-accent hover:text-accent-strong disabled:opacity-70">
            <span className={`inline-block ${loading ? "spin" : ""}`}>↻</span>{loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        <div className={loading || !d ? "progress" : "h-0.5"} />

        <div data-scroll-table className="overflow-x-auto lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          <table className="w-full min-w-[60rem] text-sm">
            <thead className="sticky top-0 z-10 bg-head text-left text-xs font-semibold uppercase tracking-wide text-head-fg">
              <tr><th className="px-5 py-3">Ticket</th><th className={th}>Title</th><th className={th}>Account</th><th className={th}>Started by</th>
                <th className={th}>Created on</th><th className={th}>Run time</th><th className={th}>Status</th><th className="px-5 py-3 text-right">Action</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {!d && [0, 1, 2, 3, 4].map((i) => <tr key={i}><td colSpan={8} className="px-5 py-3"><div className="skeleton h-5 w-full" /></td></tr>)}
              {d && !d.rows.length && <tr><td colSpan={8} className="px-5 py-12 text-center text-muted">{status === "active" ? "Nothing running or waiting right now." : status === "failed" ? "No open failures — every failed ticket has been investigated again since." : term ? `Nothing matches “${term}”.` : "No investigations yet."}</td></tr>}
              {d?.rows.map((r) => {
                const live = ["running", "queued", "starting", "stuck"].includes(r.state);
                const time = r.state === "queued" ? `waiting ${dur(now - new Date(r.created_at).getTime())}`
                  : live ? dur(now - new Date(r.runningSince ?? r.created_at).getTime())
                  : r.finished_at ? dur(new Date(r.finished_at).getTime() - new Date(r.created_at).getTime()) : "—";
                const tried = r.state === "failed" && r.superseded; // investigated again since — not an open failure
                const [label, tone] = tried ? ["failed · tried again", "text-muted ring-line"] : CHIP[r.state] ?? [r.state, "text-muted ring-line"];
                return (
                  <tr key={r.id} className="transition-colors hover:bg-accent-soft/60">
                    <td className="whitespace-nowrap px-5 py-3 font-mono"><Link href={`/tickets/${r.ticket_display}`} className="font-medium text-accent-strong hover:underline">{r.ticket_display}</Link></td>
                    <td className="min-w-56 max-w-sm px-4 py-3"><span className="line-clamp-2" title={r.ticket_title}>{r.ticket_title}</span></td>
                    <td className="whitespace-nowrap px-4 py-3">{r.account}</td>
                    <td className="px-4 py-3">
                      <div className="whitespace-nowrap">{r.who || r.started_by || "—"}</div>
                      {r.email && <div className="text-xs text-muted">{r.email}</div>}
                      {r.kind === "chat" && r.chat_by && <div className="text-xs text-muted">chat reply for {r.chat_by}</div>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-muted">{when(r.created_at)}</td>
                    <td className="whitespace-nowrap px-4 py-3 tabular-nums">{time}</td>
                    <td className="px-4 py-3">
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ${tone}`}>
                        {r.kind === "chat" && live ? "chat · " : ""}{label}{r.state === "queued" && r.position ? ` · ${ordinal(r.position)} · ~${r.waitMin} min` : ""}{r.confidence && !live && !tried ? ` · ${r.confidence}` : ""}
                      </span>
                      {r.state === "stuck" && <div className="mt-1 text-xs text-bad">Not running on the server — clear it to free the ticket</div>}
                      {r.state === "failed" && r.error && !tried && <div className="mt-1 max-w-xs text-xs text-muted" title={r.error}>{r.error.slice(0, 120)}</div>}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-right">
                      {(r.state === "running" || r.state === "starting") && <button className={`${btn} hover:border-bad hover:text-bad`} disabled={busy === r.id} onClick={() => act(r, "stop")}>Stop</button>}
                      {r.state === "stuck" && <button className={`${btn} hover:border-bad hover:text-bad`} disabled={busy === r.id} onClick={() => act(r, "stop")}>Clear</button>}
                      {r.state === "queued" && <button className={`${btn} hover:border-bad hover:text-bad`} disabled={busy === r.id} onClick={() => act(r, "dequeue")}>Remove from queue</button>}
                      {r.state === "failed" && !tried && <button className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-strong disabled:opacity-40" disabled={busy === r.id} onClick={() => act(r, "retry")}>Retry</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {d && d.total > 0 && (
          <div className="border-t border-line px-5 py-2">
            <Pager where="bottom" noun="investigations" from={(d.page - 1) * d.pageSize + 1} to={Math.min(d.page * d.pageSize, d.total)} total={d.total} all={d.total}
              page={page} pages={pages} onPage={setPage} size={size} onSize={(n) => { setSize(n); setPage(1); }} disabled={loading} />
          </div>
        )}
      </section>
    </div>
  );
}
