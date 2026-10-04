"use client";
import Link from "next/link";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { BulkBar, InlineEdit, type SavedChange } from "@/components/TicketActions";
import { EmptyState } from "@/components/EmptyState";
import { TicketSheet } from "@/components/TicketSheet";
import { inPodScope, usePodScope } from "@/components/podScope";
import { useRouter, useSearchParams } from "next/navigation";
import { HealthBanner } from "@/components/HealthBanner";
import { AccountPicker, withAllClients, type PickerAccount } from "@/components/AccountPicker";
import { notify } from "@/components/Dialog";
import { ColumnMenu, Pager } from "@/components/TableTools";

type Account = PickerAccount;
interface Ticket {
  id: string; display_id: string; title: string; stage?: string; severity?: string; created_date: string;
  part?: string; default_part?: boolean; pod?: string | null; owner?: string | null; account?: string; account_id?: string; can_investigate?: boolean; devrev_url: string;
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

export default function Home() {
  return <Suspense><Inbox /></Suspense>;
}

function Inbox() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [allOpen, setAllOpen] = useState<number | null>(null);
  const [accountsLoaded, setAccountsLoaded] = useState(false);
  const params = useSearchParams();
  const account = params.get("account") || "all"; // all clients by default, like the dashboard
  // All of the account's open tickets are loaded once; page, sort and column filters live in the URL so opening a
  // ticket and pressing Back returns to exactly the same view.
  const page = Math.max(1, Number(params.get("page")) || 1);
  const sort = params.get("sort") || ""; // "stage:asc" | "pod:desc" | "" (newest first)
  // "not set" / "unassigned" is the empty value — written as "-" in the URL so it survives there.
  // "~" = nothing ticked → no tickets shown (the table follows the boxes; Select all brings them back).
  const listParam = (k: string) => (params.get(k) === "~" ? [] : params.get(k) ? params.get(k)!.split("|").map((v) => (v === "-" ? "" : v)) : null);
  const onlyDefaultPart = params.get("part") === "default"; // from the dashboard: tickets still on the default TMS part
  // From the dashboard's age buckets: age=<min days>-<max days> (max empty = no upper limit).
  const ageMatch = (params.get("age") || "").match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)?$/);
  // From the dashboard: created between cfrom and cto (IST calendar days, inclusive).
  const isDay = (v: string | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const created = isDay(params.get("cfrom")) && isDay(params.get("cto"))
    ? { from: +new Date(`${params.get("cfrom")}T00:00:00+05:30`), to: +new Date(`${params.get("cto")}T23:59:59.999+05:30`), label: params.get("clabel") || `${params.get("cfrom")} – ${params.get("cto")}` }
    : null;
  const [loadedAt] = useState(() => Date.now()); // "now" for the age filter, fixed while the page is open
  // One DevRev account (from a dashboard "By client" row that isn't a client: not routed / not set up).
  const acct = params.get("acct") ? { id: params.get("acct")!, name: params.get("acctname") || "this account" } : null;
  const ageRange = ageMatch ? { min: Number(ageMatch[1]), max: ageMatch[2] ? Number(ageMatch[2]) : Infinity, label: params.get("agelabel") || `${ageMatch[1]}+ days` } : null;
  const filters = { stage: listParam("fstage"), pod: listParam("fpod"), owner: listParam("fowner") };
  const texts = { stage: params.get("qstage") || "", pod: params.get("qpod") || "", owner: params.get("qowner") || "" };
  const setView = (patch: Record<string, string | null>, keepPage = false) => {
    const sp = new URLSearchParams(params.toString());
    sp.set("account", account);
    for (const [k, v] of Object.entries(patch)) { if (v === null || v === "") sp.delete(k); else sp.set(k, v); }
    if (!keepPage) sp.delete("page");
    router.replace(`/tickets?${sp.toString()}`, { scroll: false });
  };
  const [tick, setTick] = useState(0); // bump to refetch the current page
  const [result, setResult] = useState<Result | null>(null);
  const [newIds, setNewIds] = useState<{ account: string; ids: Set<string> }>({ account, ids: new Set() });
  const seen = useRef<{ account: string; ids: Set<string> }>({ account, ids: new Set() });
  const refreshing = useRef(false);
  const [starting, setStarting] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Set<string>>(new Set()); // tickets ticked for a bulk resolve
  // Opening a ticket from the table: a sheet slides up over it (the table stays as it is). The address bar shows
  // /tickets/TKT-… (keeping this page's filters in the query) and the browser's Back closes the sheet.
  const [sheet, setSheet] = useState<string | null>(null);
  const openSheet = (e: React.MouseEvent, id: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // new tab / window: normal link
    e.preventDefault();
    window.history.pushState({ sheet: id }, "", `/tickets/${id}${window.location.search}`);
    setSheet(id);
  };
  useEffect(() => {
    const onPop = () => setSheet(/^\/tickets\/[^/]+$/.test(window.location.pathname) ? decodeURIComponent(window.location.pathname.split("/").pop()!) : null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  // Hovering a row warms the server's cache for that ticket, so opening it is quick.
  const warmed = useRef(new Set<string>());
  const warm = (id: string) => {
    if (warmed.current.has(id)) return;
    warmed.current.add(id);
    fetch(`/api/tickets/${id}`, { priority: "low" } as RequestInit).catch(() => warmed.current.delete(id));
  };
  const [manual, setManual] = useState("");
  const [loadInactive, setLoadInactive] = useState<string | null>(null); // slug the user chose to load anyway
  const scope = usePodScope(); // header "My Pods" (tickets with no Pod always stay)
  const scopeKey = scope.join("|");

  useEffect(() => {
    let live = true; // only the latest request wins (see the dashboard)
    fetch(`/api/accounts${scope.length ? `?pods=${encodeURIComponent(scope.join("|"))}` : ""}`).then((r) => r.json()).then((d) => { if (live) { setAccounts(d.accounts ?? []); setAllOpen(d.all_open ?? null); setAccountsLoaded(true); } });
    // Ticket resolved / moved here → refresh the picker's per-client counts (they're cached on the server).
    const onChange = () => setTimeout(() => fetch(`/api/accounts?refresh=1${scope.length ? `&pods=${encodeURIComponent(scope.join("|"))}` : ""}`).then((r) => r.json()).then((d) => { if (live && d.accounts) { setAccounts(d.accounts); setAllOpen(d.all_open ?? null); } }).catch(() => {}), 2500);
    window.addEventListener("ticket-changed", onChange);
    window.addEventListener("tickets-refreshed", onChange);
    return () => { live = false; window.removeEventListener("ticket-changed", onChange); window.removeEventListener("tickets-refreshed", onChange); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);

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
  // Changes made here show at once: closed tickets drop out, edited rows update (DevRev's list can lag a few seconds).
  const [local, setLocal] = useState<Record<string, SavedChange>>({});
  const tickets = useMemo(() => (fresh?.tickets ?? null)?.filter((t) => !local[t.display_id]?.closed).map((t) => {
    const c = local[t.display_id];
    if (!c) return t;
    return { ...t, ...(c.stage && { stage: c.stage, stage_name: c.stage }), ...(c.pod !== undefined && { pod: c.pod }), ...(c.part && { part: c.part, default_part: false }), ...(c.owner && { owner: c.owner }) };
  }).filter((t) => inPodScope(scope, t.pod)) ?? null, [fresh, local, scope]);
  const saved = (id: string) => (c: SavedChange) => { setLocal((m) => ({ ...m, [id]: { ...m[id], ...c } })); refresh(); window.dispatchEvent(new Event("tickets-refreshed")); };
  // Changes made in the ticket sheet (opened over this table) arrive as "ticket-changed".
  useEffect(() => {
    const on = (e: Event) => { const { id, change } = (e as CustomEvent<{ id: string; change: SavedChange }>).detail; setLocal((m) => ({ ...m, [id]: { ...m[id], ...change } })); };
    window.addEventListener("ticket-changed", on);
    return () => window.removeEventListener("ticket-changed", on);
  }, []);

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

  const setAccount = (slug: string) => router.replace(`/tickets?account=${slug}`);
  const refresh = () => { refreshing.current = true; setTick((n) => n + 1); };

  // Sort / filter / page on the client (all tickets are loaded).
  const valueOf = (t: Ticket, col: Col) => (col === "pod" ? t.pod || "" : col === "owner" ? t.owner || "" : t.stage || "");
  const labelOf = (col: Col, v: string) => (col === "stage" ? stageLabel(v) : v);
  const view = useMemo(() => {
    let list = tickets ?? [];
    if (onlyDefaultPart) list = list.filter((t) => t.default_part);
    if (created) list = list.filter((t) => { const c = +new Date(t.created_date); return c >= created.from && c <= created.to; });
    if (acct) list = list.filter((t) => t.account_id === acct.id);
    if (ageRange) list = list.filter((t) => { const a = (loadedAt - +new Date(t.created_date)) / 864e5; return a >= ageRange.min && a < ageRange.max; });
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
  const PAGE = [10, 25, 50, 100].includes(Number(params.get("size"))) ? Number(params.get("size")) : 25; // rows per page (URL)
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
  const anyFilter = !!(COLS.some((c) => filters[c] || texts[c]) || sort || onlyDefaultPart || ageRange || created || acct);
  const clearAll = { sort: null, fstage: null, fpod: null, fowner: null, qstage: null, qpod: null, qowner: null, part: null, age: null, agelabel: null, acct: null, acctname: null, cfrom: null, cto: null, clabel: null };
  const colMenu = (col: Col, label: string) => (
    <ColumnMenu label={label} values={distinct(col)} selected={filters[col]} text={texts[col]}
      sort={sort.startsWith(`${col}:`) ? (sort.split(":")[1] as "asc" | "desc") : null}
      onSort={(d) => setView({ sort: d ? `${col}:${d}` : null })}
      onSelected={(v) => setView({ [`f${col}`]: v ? (v.length ? v.map((x) => x || "-").join("|") : "~") : null })}
      onText={(v) => setView({ [`q${col}`]: v || null })}
      onClear={() => setView({ [`f${col}`]: "~", [`q${col}`]: null, ...(sort.startsWith(`${col}:`) ? { sort: null } : {}) })}
      format={(v) => labelOf(col, v)} />
  );
  const pager = (where: "top" | "bottom") => (
    <Pager where={where} from={view.length ? (pageNow - 1) * PAGE + 1 : 0} to={Math.min(pageNow * PAGE, view.length)} total={view.length}
      all={tickets?.length ?? 0} page={pageNow} pages={pages} onPage={goto} size={PAGE} onSize={(n) => setView({ size: n === 25 ? null : String(n) })} disabled={fetching && !tickets} />
  );

  async function investigate(t: Ticket) {
    setStarting((s) => new Set(s).add(t.display_id));
    const r = await fetch("/api/investigations", { method: "POST", body: JSON.stringify({ ticket: t.display_id }) });
    window.dispatchEvent(new Event("investigations-changed")); // header count
    const d = await r.json();
    setStarting((s) => { const n = new Set(s); n.delete(t.display_id); return n; });
    if (!r.ok) return notify({ title: `Couldn't start ${t.display_id}`, message: d.error, tone: "error" });
    setTick((n) => n + 1);
  }

  const current = withAllClients(accounts, allOpen).find((a) => a.slug === account);
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
    <div className="space-y-5 lg:flex lg:h-[calc(100dvh-7.5rem)] lg:flex-col lg:space-y-0 lg:[&>*+*]:mt-3">
      {/* One compact toolbar: client · active filter chips · connection status · open a ticket by number. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <AccountPicker label={false} accounts={withAllClients(accounts, allOpen)} value={account} onChange={setAccount} />
        {onlyDefaultPart && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent-strong">
            On DevRev&apos;s default part
            <button onClick={() => setView({ part: null })} aria-label="Remove the default-part filter" className="hover:text-fg">✕</button>
          </span>
        )}
        {created && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent-strong">
            Created {created.label === "Today" || created.label === "Yesterday" ? created.label.toLowerCase() : `in ${created.label.toLowerCase()}`}
            <button onClick={() => setView({ cfrom: null, cto: null, clabel: null })} aria-label="Remove the created-date filter" className="hover:text-fg">✕</button>
          </span>
        )}
        {acct && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent-strong">
            Account: {acct.name}
            <button onClick={() => setView({ acct: null, acctname: null })} aria-label="Remove the account filter" className="hover:text-fg">✕</button>
          </span>
        )}
        {ageRange && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent-strong">
            Open for {ageRange.label}
            <button onClick={() => setView({ age: null, agelabel: null })} aria-label="Remove the age filter" className="hover:text-fg">✕</button>
          </span>
        )}
        <div className="min-w-0 text-sm [&>*]:mb-0"><HealthBanner account={account === "all" ? undefined : account} compact /></div>
        <form className="ml-auto flex gap-2" onSubmit={(e) => { e.preventDefault(); if (manual.trim()) router.push(`/tickets/${manual.trim().toUpperCase()}`); }}>
          <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Open TKT-…"
            className="w-40 rounded-lg border border-line bg-panel px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft" />
          <button className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-strong">Open</button>
        </form>
      </div>

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

      <section className="card overflow-hidden lg:flex lg:min-h-0 lg:flex-1 lg:flex-col">
        <div className="flex flex-wrap items-center gap-3 px-5 py-4">
          <div>
            <h2 className="font-semibold">Open Support tickets</h2>
            <p className="text-xs text-muted">DevRev support stages · {sort === "created:asc" ? "oldest first" : sort && !sort.startsWith("created") ? `sorted by ${sort.split(":")[0]} ${sort.endsWith("desc") ? "Z→A" : "A→Z"}` : "newest first"}
              {anyFilter && <> · <button className="text-accent-strong underline" onClick={() => setView(clearAll)}>clear sort &amp; filters</button></>}</p>
          </div>
          {marked.size > 0 && <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent-strong">{marked.size} new since last refresh</span>}
          <div className="ml-auto flex items-center gap-2 text-sm">
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
          <div data-scroll-table className="overflow-x-auto lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-head text-left text-xs font-semibold uppercase tracking-wide text-head-fg">
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
                    <tr key={t.id} onMouseEnter={() => warm(t.display_id)} className={`transition-colors hover:bg-accent-soft/60 ${picked.has(t.display_id) ? "bg-accent-soft/70" : marked.has(t.display_id) ? "bg-accent-soft" : ""}`}>
                      <td className="py-3 pl-5 pr-0">
                        <input type="checkbox" className={box} aria-label={`Select ${t.display_id}`} checked={picked.has(t.display_id)}
                          onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(t.display_id); else n.delete(t.display_id); return n; })} />
                      </td>
                      <td className="whitespace-nowrap px-5 py-3 font-mono">
                        <Link className="font-medium text-accent-strong hover:underline" href={`/tickets/${t.display_id}`} onClick={(e) => openSheet(e, t.display_id)}>{t.display_id}</Link>
                        <a href={t.devrev_url} target="_blank" rel="noreferrer" title="Open in DevRev" aria-label={`Open ${t.display_id} in DevRev`} className="ml-1.5 text-xs text-muted hover:text-accent">↗</a>
                        {marked.has(t.display_id) && <span className="ml-2 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">new</span>}
                      </td>
                      <td className="min-w-56 max-w-sm px-4 py-3"><span className="line-clamp-2" title={t.title}>{t.title}</span>
                        {account === "all" && t.account && <span className="block truncate text-xs text-muted">{t.account}</span>}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <InlineEdit ticket={t.display_id} kind="pod" current={t.pod} onSaved={saved(t.display_id)}>
                          {t.pod
                            ? <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-strong">{t.pod}</span>
                            : <span className="text-xs text-muted">not set</span>}
                        </InlineEdit>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted">
                        <InlineEdit ticket={t.display_id} kind="part" current={t.default_part ? "TMS (default)" : t.part} onSaved={saved(t.display_id)}>
                          {t.default_part
                            ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-warn ring-1 ring-amber-200">TMS (default)</span>
                            : t.part}
                        </InlineEdit>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <InlineEdit ticket={t.display_id} kind="stage" current={(t as { stage_name?: string }).stage_name ?? t.stage} onSaved={saved(t.display_id)}>
                          <span className="rounded-full bg-bg px-2 py-0.5 text-xs text-muted ring-1 ring-line">{stageLabel(t.stage || "")}</span>
                        </InlineEdit>
                      </td>
                      <td className="max-w-44 whitespace-nowrap px-4 py-3 text-sm">
                        <InlineEdit ticket={t.display_id} kind="owner" current={t.owner} onSaved={saved(t.display_id)}>
                          {t.owner ? <span className="inline-block max-w-36 truncate align-bottom">{t.owner}</span> : <span className="text-xs text-muted">unassigned</span>}
                        </InlineEdit>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-muted" title={new Date(t.created_date).toLocaleString("en-IN", { dateStyle: "full", timeStyle: "short" })}>{shortDate(t.created_date)}</td>
                      <td className="whitespace-nowrap px-5 py-3">
                        <div className="flex items-center gap-2">
                          {inv && (
                            <Link href={`/tickets/${t.display_id}`} onClick={(e) => openSheet(e, t.display_id)} className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 hover:underline ${STATUS_STYLE[inv.status] ?? "text-muted ring-line"}`}>
                              {STATUS_LABEL[inv.status] ?? inv.status}{inv.confidence ? ` · ${inv.confidence}` : ""}
                            </Link>
                          )}
                          {/* Investigated tickets: the status chip (and the ticket number) open the page — no extra button. */}
                          {/* Running: the status chip says "investigating…" — no second button. */}
                          {/* Only active clients' tickets are investigated (not inactive clients or accounts not set up). */}
                          {(!inv || inv.status === "failed") && inv?.status !== "running" && t.can_investigate !== false && (
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
                {tickets && !tickets.length && <tr><td colSpan={9}><EmptyState title="All clear" text="No open Support tickets for this account." /></td></tr>}
                {tickets && tickets.length > 0 && !view.length && (
                  <tr><td colSpan={9}>
                    <EmptyState title="No tickets match these filters" text="We looked through every open ticket — none fit what's ticked right now."
                      action={<button className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-strong" onClick={() => setView(clearAll)}>Clear filters</button>} />
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {!error && tickets && tickets.length > 0 && <div className="border-t border-line px-5 py-2">{pager("bottom")}</div>}
      </section>
      {picked.size > 0 && rows.length > 0 && rows.every((t) => picked.has(t.display_id)) && view.length > picked.size && (
        <p className="mt-2 text-center text-sm text-muted">
          All {rows.length} on this page are selected ·{" "}
          <button className="font-medium text-accent-strong underline" onClick={() => setPicked(new Set(view.map((t) => t.display_id)))}>select all {view.length} matching</button>
        </p>
      )}
      {/* Floats over the page (fixed), so ticking rows never changes the layout. */}
      {picked.size > 0 && (
        <BulkBar selected={[...picked]} onClear={() => setPicked(new Set())}
          onDone={(done) => { setLocal((m) => ({ ...m, ...Object.fromEntries(done.map((id) => [id, { closed: true }])) })); setPicked(new Set()); refresh(); window.dispatchEvent(new Event("tickets-refreshed")); }} />
      )}
      {sheet && <TicketSheet key={sheet} ticketId={sheet} onClosed={() => window.history.back()} />}
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
