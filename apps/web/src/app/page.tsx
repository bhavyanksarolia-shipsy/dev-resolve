"use client";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { BulkBar, EditTicketDialog } from "@/components/TicketActions";
import { useRouter, useSearchParams } from "next/navigation";
import { HealthBanner } from "@/components/HealthBanner";
import { AccountPicker, type PickerAccount } from "@/components/AccountPicker";
import { notify } from "@/components/Dialog";
import { ColumnMenu, Pager } from "@/components/TableTools";

type Account = PickerAccount;
interface Ticket {
  id: string; display_id: string; title: string; stage?: string; severity?: string; created_date: string;
  part?: string; default_part?: boolean; pod?: string | null; owner?: string | null; devrev_url: string;
  investigation: { id: number; status: string; confidence: string | null } | null;
}
interface Counts { account: { total: number; wms: number; default_part: number }; org: { total: number; wms: number } }
interface Result { key: string; tick: number; tickets?: Ticket[]; next_cursor?: string; counts?: Counts; error?: string; inactive?: boolean }

const STATUS_STYLE: Record<string, string> = {
  running: "bg-amber-50 text-warn ring-amber-200", draft_ready: "bg-accent-soft text-accent-strong ring-emerald-200",
  posted: "bg-emerald-50 text-ok ring-emerald-200", failed: "bg-red-50 text-bad ring-red-200",
};
const STATUS_LABEL: Record<string, string> = {
  running: "investigating…", draft_ready: "draft ready", posted: "posted", failed: "failed",
};
/** DevRev stage names → readable ("awaiting_development" → "awaiting development"). */
const stageLabel = (s: string) => s.replace(/_/g, " ");
type Col = "stage" | "pod" | "owner";
const COLS: Col[] = ["stage", "pod", "owner"];
const box = "h-4 w-4 cursor-pointer rounded accent-[var(--accent)]";
/** "17 Jul, 7:34 pm" — the year only when it isn't this year. */
const shortDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", ...(d.getFullYear() !== new Date().getFullYear() && { year: "numeric" }), hour: "numeric", minute: "2-digit" });
};
const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");

export default function Home() {
  return <Suspense><Inbox /></Suspense>;
}

function Inbox() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const firstActive = accounts.find((a) => a.status === "active" && a.client_active !== false)?.slug ?? "";
  const params = useSearchParams();
  const account = params.get("account") || firstActive;
  // All of the account's open tickets are loaded once; page, sort and column filters live in the URL so opening a
  // ticket and pressing Back returns to exactly the same view.
  const page = Math.max(1, Number(params.get("page")) || 1);
  const sort = params.get("sort") || ""; // "stage:asc" | "pod:desc" | "" (newest first)
  const listParam = (k: string) => (params.get(k) ? params.get(k)!.split("|") : null);
  const filters = { stage: listParam("fstage"), pod: listParam("fpod"), owner: listParam("fowner") };
  const texts = { stage: params.get("qstage") || "", pod: params.get("qpod") || "", owner: params.get("qowner") || "" };
  const setView = (patch: Record<string, string | null>, keepPage = false) => {
    const sp = new URLSearchParams(params.toString());
    sp.set("account", account);
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === "") sp.delete(k); else sp.set(k, v); }
    if (!keepPage) sp.delete("page");
    router.replace(`/?${sp.toString()}`, { scroll: false });
  };
  const [tick, setTick] = useState(0); // bump to refetch the current page
  const [result, setResult] = useState<Result | null>(null);
  const [newIds, setNewIds] = useState<{ account: string; ids: Set<string> }>({ account, ids: new Set() });
  const seen = useRef<{ account: string; ids: Set<string> }>({ account, ids: new Set() });
  const refreshing = useRef(false);
  const [starting, setStarting] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null); // ticket whose Stage / Pod / Part is being edited // tickets ticked for a bulk Stage / Pod / resolve
  const [manual, setManual] = useState("");
  const [loadInactive, setLoadInactive] = useState<string | null>(null); // slug the user chose to load anyway

  useEffect(() => {
    fetch("/api/accounts").then((r) => r.json()).then((d) => { setAccounts(d.accounts ?? []); setAccountsLoaded(true); });
  }, []);

  const key = account;
  useEffect(() => {
    if (!account) return; // wait until the account list tells us the default
    let live = true;
    const force = loadInactive === account ? "&force=1" : "";
    fetch(`/api/tickets?account=${account}&all=1${force}`, { cache: "no-store" }).then(async (r) => {
      const d = await r.json();
      if (!live) return;
      if (!r.ok) return setResult({ key, tick, error: `${d.tag ?? "Error"} (${d.connection ?? "?"}): ${d.error}` });
      const tickets: Ticket[] = d.tickets;
      if (seen.current.account !== account) seen.current = { account, ids: new Set() };
      // After a manual refresh, anything we hadn't seen before is marked "new".
      if (refreshing.current && seen.current.ids.size) {
        const fresh = tickets.filter((t) => !seen.current.ids.has(t.display_id)).map((t) => t.display_id);
        setNewIds({ account, ids: new Set(fresh) });
      }
      refreshing.current = false;
      tickets.forEach((t) => seen.current.ids.add(t.display_id));
      setResult({ key, tick, tickets, next_cursor: d.next_cursor, counts: d.counts ?? undefined, inactive: !!d.inactive });
    });
    return () => { live = false; };
  }, [account, key, tick, loadInactive]);

  const fresh = result?.key === key ? result : null;
  // Anything in flight: first load, page change, manual refresh or the background status refresh.
  const fetching = !result || result.key !== key || result.tick !== tick;
  const tickets = fresh?.tickets ?? null;
  const counts = fresh?.counts ?? (result?.key === account ? result.counts : undefined);
  const error = fresh?.error ?? null;
  const inactive = !!fresh?.inactive;
  const anyRunning = !inactive && !!tickets?.some((t) => t.investigation?.status === "running");

  // After a network error (VPN connecting, Wi-Fi switch), retry on our own every 10s.
  useEffect(() => {
    if (!error || inactive) return;
    const t = setInterval(() => setTick((n) => n + 1), 10000);
    return () => clearInterval(t);
  }, [error, inactive]);

  // While something is being investigated, keep its row status live.
  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(() => setTick((n) => n + 1), 10000);
    return () => clearInterval(t);
  }, [anyRunning]);

  const setAccount = (slug: string) => router.replace(`/?account=${slug}`);
  const refresh = () => { refreshing.current = true; setTick((n) => n + 1); };

  // Sort / filter / page on the client (all tickets are loaded).
  const valueOf = (t: Ticket, col: Col) => (col === "pod" ? t.pod || "" : col === "owner" ? t.owner || "" : t.stage || "");
  const labelOf = (col: Col, v: string) => (col === "stage" ? stageLabel(v) : v);
  const view = useMemo(() => {
    let list = tickets ?? [];
    for (const col of COLS) {
      const sel = filters[col], txt = texts[col].trim().toLowerCase();
      if (sel) list = list.filter((t) => sel.includes(valueOf(t, col)));
      if (txt) list = list.filter((t) => (valueOf(t, col) ? labelOf(col, valueOf(t, col)) : "not set").toLowerCase().includes(txt));
    }
    const [col, dir] = sort.split(":") as [Col | "created" | "", "asc" | "desc"];
    const byCreated = (x: Ticket, y: Ticket) => +new Date(y.created_date) - +new Date(x.created_date); // newest first
    if (!col || col === "created") {
      list = [...list].sort((x, y) => (col === "created" && dir === "asc" ? -1 : 1) * byCreated(x, y));
    } else {
      list = [...list].sort((x, y) => {
        const a = valueOf(x, col), b = valueOf(y, col);
        if (!a !== !b) return a ? -1 : 1; // "not set" always last
        return (dir === "desc" ? -1 : 1) * a.localeCompare(b) || byCreated(x, y);
      });
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickets, sort, params]);
  const PAGE = 25;
  const pages = Math.max(1, Math.ceil(view.length / PAGE));
  const pageNow = Math.min(page, pages);
  const rows = view.slice((pageNow - 1) * PAGE, pageNow * PAGE);
  const goto = (n: number) => { setView({ page: n > 1 ? String(n) : null }, true); };
  // Counts in a column's menu reflect the OTHER column's filter, so they always add up to what you'd see.
  const passes = (t: Ticket, col: Col) => {
    const sel = filters[col], txt = texts[col].trim().toLowerCase(), v = valueOf(t, col);
    return (!sel || sel.includes(v)) && (!txt || (v ? labelOf(col, v) : "not set").toLowerCase().includes(txt));
  };
  const distinct = (col: Col) => {
    const others = COLS.filter((c) => c !== col);
    const m = new Map<string, number>();
    for (const t of tickets ?? []) m.set(valueOf(t, col), m.get(valueOf(t, col)) ?? 0);
    for (const t of tickets ?? []) if (others.every((o) => passes(t, o))) m.set(valueOf(t, col), (m.get(valueOf(t, col)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => (!a[0] ? 1 : !b[0] ? -1 : a[0].localeCompare(b[0]))).map(([value, count]) => ({ value, count }));
  };
  const anyFilter = !!(COLS.some((c) => filters[c] || texts[c]) || sort);
  const clearAll = { sort: null, fstage: null, fpod: null, fowner: null, qstage: null, qpod: null, qowner: null };
  const colMenu = (col: Col, label: string) => (
    <ColumnMenu label={label} values={distinct(col)} selected={filters[col]} text={texts[col]}
      sort={sort.startsWith(`${col}:`) ? (sort.split(":")[1] as "asc" | "desc") : null}
      onSort={(d) => setView({ sort: d ? `${col}:${d}` : null })}
      onSelected={(v) => setView({ [`f${col}`]: v ? v.join("|") : null })}
      onText={(v) => setView({ [`q${col}`]: v || null })}
      onClear={() => setView({ [`f${col}`]: null, [`q${col}`]: null, ...(sort.startsWith(`${col}:`) ? { sort: null } : {}) })}
      format={(v) => labelOf(col, v)} />
  );
  const pager = (where: "top" | "bottom") => (
    <Pager where={where} from={view.length ? (pageNow - 1) * PAGE + 1 : 0} to={Math.min(pageNow * PAGE, view.length)} total={view.length}
      all={tickets?.length ?? 0} page={pageNow} pages={pages} onPage={goto} disabled={fetching && !tickets} />
  );

  async function investigate(t: Ticket) {
    setStarting((s) => new Set(s).add(t.display_id));
    const r = await fetch("/api/investigations", { method: "POST", body: JSON.stringify({ ticket: t.display_id }) });
    const d = await r.json();
    setStarting((s) => { const n = new Set(s); n.delete(t.display_id); return n; });
    if (!r.ok) return notify({ title: `Couldn't start ${t.display_id}`, message: d.error, tone: "error" });
    setTick((n) => n + 1);
  }

  const current = accounts.find((a) => a.slug === account);
  const marked = newIds.account === account ? newIds.ids : new Set<string>();

  // Fresh server: no projects.json yet → say what to do instead of showing loading rows forever.
  if (accountsLoaded && !accounts.length) {
    return (
      <div className="card mx-auto mt-10 max-w-xl p-6 text-sm">
        <h1 className="mb-2 text-lg font-semibold">No accounts on this server yet</h1>
        <p className="text-muted">The backend doesn&apos;t have its private config. An admin uploads <b>projects.json</b> and <b>config.env</b> (and the knowledge archive) on the{" "}
          <Link href="/admin?tab=files" className="text-accent-strong underline">Admin → Files</Link> page — then tickets appear here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <AccountPicker accounts={accounts} value={account} onChange={setAccount} />
        <form className="ml-auto flex gap-2" onSubmit={(e) => { e.preventDefault(); if (manual.trim()) router.push(`/tickets/${manual.trim().toUpperCase()}`); }}>
          <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Open TKT-…"
            className="w-44 rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft" />
          <button className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-strong">Open</button>
        </form>
      </div>

      <HealthBanner account={account} />

      {/* Queue numbers follow DevRev's WMS "Support" view (config devrev_view): Support subtype, support-workflow stages. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Stat loading={!counts && !error && !inactive} label={`${current?.name ?? account} · open tickets`} value={counts ? String(counts.account.total) : "—"}
          sub={counts ? `${counts.account.wms} WMS · ${counts.account.default_part} TMS (default)` : undefined} />
        <Stat loading={!counts && !error && !inactive} label="In DevRev WMS view" value={counts ? String(counts.account.wms) : "—"} sub="matches DevRev"
          hint="Part under the WMS product. Tickets still on the default TMS part aren't counted here until triaged." />
        <Stat loading={!counts && !error && !inactive} label="Share of DevRev WMS view" value={counts ? pct(counts.account.wms, counts.org.wms) : "—"}
          sub={counts ? `${counts.account.wms} of ${counts.org.wms}` : undefined} />
        <Stat loading={!counts && !error && !inactive} label="Share of all open Support tickets" value={counts ? pct(counts.account.total, counts.org.total) : "—"}
          sub={counts ? `${counts.account.total} of ${counts.org.total}` : undefined} />
      </div>
      {counts && counts.account.default_part > 0 && (
        <p className="-mt-2 text-xs text-muted">
          <span className="font-medium text-warn">{counts.account.default_part} ticket(s)</span> are still on the default <b>TMS</b> part (new email tickets land there),
          so DevRev&apos;s WMS view doesn&apos;t count them yet. They&apos;re tagged <span className="font-medium text-warn">TMS (default)</span> below.
        </p>
      )}

      {inactive && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-panel px-4 py-3 text-sm">
          <span><b>{current?.name ?? account}</b> is marked as an <b>inactive client</b> — no ticket counts, ticket list or connection checks are fetched for it.</span>
          <button onClick={() => setLoadInactive(account)} className="rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:border-accent hover:text-accent-strong">Load tickets anyway</button>
          <a href="/knowledge" className="text-xs text-accent-strong hover:underline">Change on the Knowledge page</a>
        </div>
      )}

      {current && current.status !== "active" && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
          <b className="text-warn">{current.name}: logs and DB are not configured yet.</b>{" "}
          Investigations can only use code search and past cases until its OpenSearch / Metabase connection is added to{" "}
          <code>config/projects.json</code> + <code>config/config.env</code>.
        </div>
      )}

      <section className="card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 px-5 py-4">
          <div>
            <h2 className="font-semibold">Open Support tickets</h2>
            <p className="text-xs text-muted">DevRev support stages · {sort === "created:asc" ? "oldest first" : sort && !sort.startsWith("created") ? `sorted by ${sort.split(":")[0]} ${sort.endsWith("desc") ? "Z→A" : "A→Z"}` : "newest first"}
              {anyFilter && <> · <button className="text-accent-strong underline" onClick={() => setView(clearAll)}>clear sort &amp; filters</button></>}</p>
          </div>
          {marked.size > 0 && <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent-strong">{marked.size} new since last refresh</span>}
          <div className="ml-auto flex gap-2 text-sm">
            <button onClick={refresh} disabled={fetching}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-3 py-1.5 font-medium hover:border-accent hover:text-accent-strong disabled:opacity-70">
              <span className={`inline-block ${fetching ? "spin" : ""}`}>↻</span>{fetching ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
        <div className={fetching ? "progress" : "h-0.5"} />

        {error && (
          <div className="m-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-bad">
            {error}
            <div className="mt-1 text-xs text-muted">
              {error.startsWith("NETWORK") ? "Network looks unavailable — often the VPN connecting or a Wi-Fi switch. " : ""}Retrying automatically every 10 seconds…
            </div>
          </div>
        )}
        {!error && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-head text-left text-xs font-semibold uppercase tracking-wide text-head-fg">
                <tr className="[&>th]:whitespace-nowrap">
                  <th className="w-10 py-3 pl-5 pr-0">
                    <input type="checkbox" className={box} aria-label="Select the tickets on this page"
                      checked={rows.length > 0 && rows.every((t) => picked.has(t.display_id))}
                      onChange={(e) => setPicked((p) => { const n = new Set(p); for (const t of rows) { if (e.target.checked) n.add(t.display_id); else n.delete(t.display_id); } return n; })} />
                  </th>
                  <th className="px-5 py-3">Ticket</th><th className="px-4 py-3">Title</th><th className="px-4 py-3">{colMenu("pod", "Pod")}</th><th className="px-4 py-3">Part</th>
                  <th className="px-4 py-3">{colMenu("stage", "Stage")}</th><th className="px-4 py-3">{colMenu("owner", "Assigned to")}</th><th className="px-4 py-3"><CreatedSort value={sort === "created:asc" ? "asc" : sort && !sort.startsWith("created") ? null : "desc"}
                    onChange={(d) => setView({ sort: d === "asc" ? "created:asc" : "created:desc" })} /></th><th className="px-5 py-3">Dev Resolve</th>
                </tr>
              </thead>
              <tbody className={`divide-y divide-line transition-opacity ${fetching && tickets ? "opacity-60" : ""}`}>
                {!tickets && Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)}
                {tickets && rows.map((t) => {
                  const inv = t.investigation;
                  const busy = starting.has(t.display_id) || inv?.status === "running";
                  return (
                    <tr key={t.id} className={`transition-colors hover:bg-accent-soft/60 ${picked.has(t.display_id) ? "bg-accent-soft/70" : marked.has(t.display_id) ? "bg-accent-soft" : ""}`}>
                      <td className="py-3 pl-5 pr-0">
                        <input type="checkbox" className={box} aria-label={`Select ${t.display_id}`} checked={picked.has(t.display_id)}
                          onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(t.display_id); else n.delete(t.display_id); return n; })} />
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 font-mono">
                        <Link className="font-medium text-accent-strong hover:underline" href={`/tickets/${t.display_id}`}>{t.display_id}</Link>
                        <a href={t.devrev_url} target="_blank" rel="noreferrer" title="Open in DevRev" aria-label={`Open ${t.display_id} in DevRev`} className="ml-1.5 text-xs text-muted hover:text-accent">↗</a>
                        {marked.has(t.display_id) && <span className="ml-2 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">new</span>}
                      </td>
                      <td className="min-w-56 max-w-sm px-4 py-3"><span className="line-clamp-2" title={t.title}>{t.title}</span></td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {t.pod
                          ? <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-strong">{t.pod}</span>
                          : <span className="text-xs text-muted" title="Pod isn't set on this ticket in DevRev yet">not set</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted">
                        {t.default_part
                          ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-warn ring-1 ring-amber-200" title="Default part — not triaged to WMS yet, so not in DevRev's WMS view">TMS (default)</span>
                          : t.part}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3"><span className="rounded-full bg-bg px-2 py-0.5 text-xs text-muted ring-1 ring-line">{stageLabel(t.stage || "")}</span></td>
                      <td className="max-w-40 truncate whitespace-nowrap px-4 py-3 text-sm" title={t.owner || "Nobody is assigned in DevRev"}>{t.owner || <span className="text-xs text-muted">unassigned</span>}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted" title={new Date(t.created_date).toLocaleString("en-IN", { dateStyle: "full", timeStyle: "short" })}>{shortDate(t.created_date)}</td>
                      <td className="whitespace-nowrap px-5 py-3">
                        <div className="flex items-center gap-2">
                          <button onClick={() => setEditing(t.display_id)} title="Edit stage, Pod and part" aria-label={`Edit ${t.display_id}`}
                            className="grid h-7 w-7 place-items-center rounded-lg text-muted ring-1 ring-line hover:text-accent-strong hover:ring-accent">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                          </button>
                          {inv && (
                            <Link href={`/tickets/${t.display_id}`} className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 hover:underline ${STATUS_STYLE[inv.status] ?? "text-muted ring-line"}`}>
                              {STATUS_LABEL[inv.status] ?? inv.status}{inv.confidence ? ` · ${inv.confidence}` : ""}
                            </Link>
                          )}
                          {/* Investigated tickets: the status chip (and the ticket number) open the page — no extra button. */}
                          {(!inv || inv.status === "failed" || busy) && (
                            <button onClick={() => investigate(t)} disabled={busy}
                              className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-accent-strong disabled:opacity-60">
                              {busy && <span className="spin inline-block">↻</span>}
                              {busy ? "Investigating…" : inv ? "Try again" : "Investigate"}
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {tickets && !tickets.length && <tr><td colSpan={9} className="px-5 py-10 text-center text-muted">No open Support tickets for this account.</td></tr>}
                {tickets && tickets.length > 0 && !view.length && (
                  <tr><td colSpan={9} className="px-5 py-10 text-center text-muted">No tickets match these filters.{" "}
                    <button className="text-accent-strong underline" onClick={() => setView(clearAll)}>Clear filters</button></td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {!error && tickets && tickets.length > 0 && <div className="border-t border-line px-5 py-3">{pager("bottom")}</div>}
      </section>
      {picked.size > 0 && rows.length > 0 && rows.every((t) => picked.has(t.display_id)) && view.length > picked.size && (
        <p className="mt-2 text-center text-sm text-muted">
          All {rows.length} on this page are selected ·{" "}
          <button className="font-medium text-accent-strong underline" onClick={() => setPicked(new Set(view.map((t) => t.display_id)))}>select all {view.length} matching</button>
        </p>
      )}
      {editing && <EditTicketDialog ticket={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} />}
      {picked.size > 0 && (
        <BulkBar selected={[...picked]} onClear={() => setPicked(new Set())}
          onDone={() => { setPicked(new Set()); refresh(); }} />
      )}
    </div>
  );
}

function SkeletonRow() {
  return (
    <tr>
      <td className="py-4 pl-5 pr-0"><div className="skeleton h-4 w-4" /></td>
      <td className="px-5 py-4"><div className="skeleton h-4 w-24" /></td>
      <td className="px-4 py-4"><div className="skeleton h-4 w-72 max-w-full" /></td>
      <td className="px-4 py-4"><div className="skeleton h-5 w-12 rounded-full" /></td>
      <td className="px-4 py-4"><div className="skeleton h-4 w-16" /></td>
      <td className="px-4 py-4"><div className="skeleton h-5 w-20 rounded-full" /></td>
      <td className="px-4 py-4"><div className="skeleton h-4 w-24" /></td>
      <td className="px-4 py-4"><div className="skeleton h-4 w-32" /></td>
      <td className="px-5 py-4"><div className="skeleton h-7 w-24 rounded-lg" /></td>
    </tr>
  );
}

function Stat({ label, value, sub, hint, loading }: { label: string; value: string; sub?: string; hint?: string; loading?: boolean }) {
  return (
    <div className="card relative overflow-hidden px-5 py-4" title={hint}>
      <div className="absolute inset-y-0 left-0 w-1 bg-accent/70" />
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      {loading ? (
        <div className="mt-2 space-y-2"><div className="skeleton h-7 w-20" /><div className="skeleton h-3 w-32" /></div>
      ) : (
        <>
          <div className="mt-1 text-3xl font-semibold tabular-nums text-fg">{value}</div>
          {sub && <div className="mt-0.5 text-xs text-muted">{sub}</div>}
        </>
      )}
    </div>
  );
}

/** "Created" column header: choose newest first (descending) or oldest first (ascending). */
function CreatedSort({ value, onChange }: { value: "asc" | "desc" | null; onChange: (d: "asc" | "desc") => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  return (
    <div ref={box} className="relative inline-block">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}
        className={`inline-flex items-center gap-1 uppercase hover:text-accent-strong ${value ? "text-accent-strong" : ""}`}>
        Created <span aria-hidden>{value === "asc" ? "↑" : value === "desc" ? "↓" : "↕"}</span>
      </button>
      {open && (
        <ul role="menu" className="absolute left-0 z-40 mt-2 w-48 rounded-xl border border-line bg-panel py-1 text-sm font-normal normal-case tracking-normal text-fg shadow-lg">
          {([["desc", "Newest first", "Descending ↓"], ["asc", "Oldest first", "Ascending ↑"]] as const).map(([d, l, h]) => (
            <li key={d} role="menuitemradio" aria-checked={value === d} onClick={() => { onChange(d); setOpen(false); }}
              className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-accent-soft ${value === d ? "font-medium text-accent-strong" : ""}`}>
              <span className={`w-4 ${value === d ? "" : "invisible"}`}>✓</span>
              <span>{l}<span className="block text-xs text-muted">{h}</span></span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
