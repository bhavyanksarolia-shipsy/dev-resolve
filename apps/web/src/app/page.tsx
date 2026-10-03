"use client";
import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AccountPicker, withAllClients, type PickerAccount } from "@/components/AccountPicker";
import { HealthBanner } from "@/components/HealthBanner";
import { inPodScope, usePodScope } from "@/components/podScope";
import { PodPicker } from "@/components/PodPicker";

interface Count { value: string; count: number }
interface Brief { display_id: string; title: string; created: string; closed: string | null; stage: string; owner: string | null; pod: string | null }
interface Dash {
  inactive?: boolean; error?: string;
  account: { slug: string; name: string }; days: number; from: string; to: string; step: number;
  counts: { account: { total: number; wms: number; default_part: number }; org: { total: number; wms: number } };
  open: { total: number; by_stage: Count[]; by_pod: Count[]; by_owner: Count[]; by_age: { label: string; min: number; max: number | null; count: number }[]; oldest: Brief[];
    gaps: { default_part: number; no_pod: number; unassigned: number; not_investigated: number } };
  flow: { opened: number; closed: number; partial?: boolean; per_day: { day: string; opened: number; closed: number }[] };
  recently_closed: Brief[];
  by_client: { slug: string; name: string; open: number }[];
  pod: string[] | null;
  pod_status: { stages: string[]; rows: { pod: string; open: number; by_stage: Record<string, number>; closed: number }[] };
  dev_resolve: { investigations: number; posted: number; draft_ready: number; failed: number; running: number; confidence: Count[]; avg_minutes: number | null; tickets: number };
}

const stageLabel = (s: string) => { const t = s.replace(/_/g, " "); return t.charAt(0).toUpperCase() + t.slice(1); };
const ago = (iso: string) => {
  const d = (Date.now() - +new Date(iso)) / 864e5;
  return d < 1 ? `${Math.max(1, Math.round(d * 24))} h` : `${Math.round(d)} d`;
};
const shortDate = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short" });

export default function Home() {
  return <Suspense><Dashboard /></Suspense>;
}

/** Dashboard: how one client's support queue is doing. Every number links to the Tickets table, already filtered. */
function Dashboard() {
  const router = useRouter();
  const params = useSearchParams();
  const [accounts, setAccounts] = useState<PickerAccount[]>([]);
  const [loaded, setLoaded] = useState(false);
  const scope = usePodScope(); // header "My Pods"
  const scopeKey = scope.join("|");
  useEffect(() => {
    // Only the latest request wins (an earlier, unscoped one can finish later and must not overwrite the counts).
    let live = true;
    fetch(`/api/accounts${scope.length ? `?pods=${encodeURIComponent(scope.join("|"))}` : ""}`).then((r) => r.json())
      .then((d) => { if (live) { setAccounts(d.accounts ?? []); setLoaded(true); } }).catch(() => live && setLoaded(true));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey]);
  const account = params.get("account") || "all"; // all clients by default; narrow down in the picker
  const range = resolveRange(params.get("range"), params.get("from"), params.get("to"));
  // Header "My Pods" scope: those Pods + tickets with no Pod ("-"). Empty = every Pod.
  // Dashboard Pod filter: narrows inside the header scope (e.g. WMS team → just "WMS Inbound"). Empty = whole scope.
  const podPick = params.get("pod") ? params.get("pod")!.split("|") : null;
  const podParam = podPick?.length ? podPick.join("|") : scope.length ? [...scope, "-"].join("|") : null;
  const go = (patch: Record<string, string | null>) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v == null) sp.delete(k); else sp.set(k, v); }
    router.replace(`/?${sp.toString()}`, { scroll: false });
  };

  const [data, setData] = useState<{ key: string; d: Dash } | null>(null);
  const key = `${account}|${range.from}|${range.to}|${podParam ?? ""}`;
  useEffect(() => {
    let live = true;
    fetch(`/api/dashboard?account=${account}&from=${range.from}&to=${range.to}${podParam != null ? `&pod=${encodeURIComponent(podParam)}` : ""}`, { cache: "no-store" })
      .then(async (r) => { const d = await r.json(); if (live) setData({ key, d: r.ok ? d : { error: d.error || `HTTP ${r.status}` } as Dash }); })
      .catch(() => live && setData({ key, d: { error: "Couldn't reach the backend" } as Dash }));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const d = data?.key === key ? data.d : null;
  // Tickets table link with filters (the dashboard's Pod filter carries over unless the link sets its own).
  const t = (q: string) => `/tickets?account=${account}${podPick?.length && !q.includes("fpod=") ? `&fpod=${encodeURIComponent(podPick.join("|"))}` : ""}${q}`;
  const podChoices = (d?.pod_status?.rows ?? []).filter((r) => r.open && inPodScope(scope, r.pod)).map((r) => ({ value: r.pod, count: r.open }));

  if (loaded && !accounts.length) {
    return <div className="card p-6 text-sm text-muted">No clients on this server yet — an admin adds them in <Link href="/admin" className="text-accent-strong underline">Admin</Link>.</div>;
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <AccountPicker accounts={withAllClients(accounts)} value={account} onChange={(slug) => go({ account: slug })} />
        <PodPicker allLabel={scope.length === 1 ? scope[0] : scope.length ? `${scope.length} Pods` : "All Pods"} value={podPick} choices={podChoices} onChange={(v) => go({ pod: v && v.length && v.length < podChoices.length ? v.join("|") : null })} />
        <DateRangePicker range={range} onChange={(r) => go(r.key === "custom" ? { range: "custom", from: r.from, to: r.to } : { range: r.key, from: null, to: null })} />
      </div>
      {loaded && <HealthBanner account={account === "all" ? undefined : account} compact />}

      {d?.inactive && <div className="card p-5 text-sm">This client is marked <b>inactive</b> — nothing is fetched for it. <Link href={t("")} className="text-accent-strong underline">Open its tickets anyway</Link>.</div>}
      {d?.error && <div className="rounded-xl bg-red-50 px-4 py-3 text-sm text-bad ring-1 ring-red-200">{d.error}</div>}
      {!d && <Skeleton />}

      {d && !d.inactive && !d.error && (
        <>
          {/* Headline numbers */}
          <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Kpi label="Open tickets" value={d.open.total} sub={`${d.open.gaps.unassigned} unassigned`} href={t("")} />
            <Kpi label={`Opened · ${range.label}`} value={d.flow.opened} sub={`${(d.flow.opened / d.days).toFixed(1)} a day`} />
            <Kpi label={`Closed · ${range.label}`} value={d.flow.closed}
              sub={d.flow.closed >= d.flow.opened ? "keeping up with new tickets" : `${d.flow.opened - d.flow.closed} more opened than closed`}
              tone={d.flow.closed >= d.flow.opened ? "ok" : "warn"} />
            <Kpi label={`RCAs posted · ${range.label}`} value={d.dev_resolve.posted} sub={`${d.dev_resolve.investigations} investigations on ${d.dev_resolve.tickets} tickets`} />
          </div>

          {/* Clients and the opened-vs-closed chart side by side, same height. */}
          <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
            <ClientTable rows={d.by_client}
              link={(slug) => `/tickets?account=${slug}${podPick?.length ? `&fpod=${encodeURIComponent(podPick.join("|"))}` : ""}`} />
            <Panel title="Opened vs closed" hint={`${d.step > 1 ? "Per week" : "Per day"} · ${range.label}`} className="flex flex-col lg:col-span-2">
              <FlowChart rows={d.flow.per_day} />
              {d.flow.partial && <p className="mt-2 text-xs text-warn">Very busy period — the chart shows the most recent 5,000 tickets; the totals above are exact.</p>}
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
            <Panel title="Age of open tickets">
              <Bars items={d.open.by_age.map((a) => ({ label: a.label, count: a.count, href: t(`&age=${a.min}-${a.max ?? ""}&agelabel=${encodeURIComponent(a.label)}`) }))} tone={(i) => (i >= 3 ? "bg-warn" : "bg-accent")} />
            </Panel>
            <Panel title="By stage">
              <Bars items={d.open.by_stage.map((s) => ({ label: stageLabel(s.value), count: s.count, href: t(`&fstage=${encodeURIComponent(s.value)}`) }))} />
            </Panel>
            <Panel title="By Pod">
              <Bars items={d.open.by_pod.map((p) => ({ label: p.value || "Not set", count: p.count, href: t(`&fpod=${encodeURIComponent(p.value || "-")}`), muted: !p.value }))} />
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
            <Panel title="Workload" hint="Open tickets per person">
              <Bars items={d.open.by_owner.map((o) => ({ label: o.value || "Unassigned", count: o.count, href: t(`&fowner=${encodeURIComponent(o.value || "-")}`), muted: !o.value }))} />
            </Panel>
            <Panel title="Oldest open" className="lg:col-span-2">
              <TicketList rows={d.open.oldest} right={(r) => <span className="text-warn">{ago(r.created)} old</span>} />
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
            <Panel title="Dev Resolve" hint={`Last ${range.label}`}>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <Stat k="Investigations" v={d.dev_resolve.investigations} />
                <Stat k="RCAs posted" v={d.dev_resolve.posted} />
                <Stat k="Drafts to review" v={d.dev_resolve.draft_ready} />
                <Stat k="Failed" v={d.dev_resolve.failed} />
                <Stat k="Avg. time" v={d.dev_resolve.avg_minutes != null ? `${d.dev_resolve.avg_minutes} min` : "—"} />
                <Stat k="Running now" v={d.dev_resolve.running} />
              </dl>
              {d.dev_resolve.confidence.length > 0 && (
                <div className="mt-4">
                  <div className="mb-1.5 text-xs text-muted">Confidence</div>
                  <div className="flex h-2.5 overflow-hidden rounded-full bg-bg">
                    {d.dev_resolve.confidence.map((c) => (
                      <span key={c.value} title={`${c.value}: ${c.count}`} style={{ flexGrow: c.count }}
                        className={c.value === "high" ? "bg-ok" : c.value === "medium" ? "bg-accent/60" : "bg-warn"} />
                    ))}
                  </div>
                  <div className="mt-1 flex gap-3 text-xs text-muted">{d.dev_resolve.confidence.map((c) => <span key={c.value}>{c.value} {c.count}</span>)}</div>
                </div>
              )}
            </Panel>
            <Panel title="Recently closed" hint={`Last ${range.label}`} className="lg:col-span-2">
              {d.recently_closed.length ? <TicketList rows={d.recently_closed} right={(r) => <span className="text-ok">{r.closed ? shortDate(r.closed) : ""}</span>} />
                : <p className="py-6 text-center text-sm text-muted">Nothing closed in this period.</p>}
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, sub, href, tone }: { label: string; value: number; sub?: string; href?: string; tone?: "ok" | "warn" }) {
  const body = (
    <>
      <div className="absolute inset-y-0 left-0 w-1 bg-accent/70" />
      <div className="text-xs font-medium uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-3xl font-semibold tabular-nums">{value}</div>
      {sub && <div className={`mt-0.5 text-xs ${tone === "warn" ? "text-warn" : tone === "ok" ? "text-ok" : "text-muted"}`}>{sub}</div>}
    </>
  );
  return href
    ? <Link href={href} className="card relative block overflow-hidden px-5 py-4 transition hover:ring-2 hover:ring-accent-soft">{body}</Link>
    : <div className="card relative overflow-hidden px-5 py-4">{body}</div>;
}

function Panel({ title, hint, className = "", children }: { title: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <section className={`card min-w-0 p-5 ${className}`}>
      <div className="mb-3 flex items-baseline gap-2"><h2 className="font-semibold">{title}</h2>{hint && <span className="text-xs text-muted">{hint}</span>}</div>
      {children}
    </section>
  );
}

function Bars({ items, tone }: { items: { label: string; count: number; href?: string; muted?: boolean }[]; tone?: (i: number) => string }) {
  const max = Math.max(1, ...items.map((i) => i.count));
  if (!items.length) return <p className="py-4 text-center text-sm text-muted">Nothing open.</p>;
  return (
    <ul className="space-y-2">
      {items.slice(0, 10).map((it, i) => {
        const row = (
          <>
            <span className={`w-36 shrink-0 truncate text-sm ${it.muted ? "text-muted" : ""}`} title={it.label}>{it.label}</span>
            <span className="h-2 flex-1 overflow-hidden rounded-full bg-bg">
              <span className={`block h-full rounded-full ${tone ? tone(i) : it.muted ? "bg-line" : "bg-accent"}`} style={{ width: `${(it.count / max) * 100}%` }} />
            </span>
            <span className="w-8 text-right text-sm font-medium tabular-nums">{it.count}</span>
          </>
        );
        return <li key={it.label}>{it.href ? <Link href={it.href} className="-mx-1 flex items-center gap-3 rounded-md px-1 py-0.5 hover:bg-accent-soft/60">{row}</Link> : <div className="flex items-center gap-3">{row}</div>}</li>;
      })}
      {items.length > 10 && <li className="text-xs text-muted">+{items.length - 10} more</li>}
    </ul>
  );
}

/** Opened (green) and closed (grey) per day as paired bars. */
function FlowChart({ rows }: { rows: { day: string; opened: number; closed: number }[] }) {
  // Fills its panel (the panel sits next to the client table and takes its height).
  const max = Math.max(1, ...rows.flatMap((r) => [r.opened, r.closed]));
  const label = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  const few = rows.length <= 7; // short periods: normal-width bars, centred, with the numbers on top
  return (
    <div className="flex min-h-56 flex-1 flex-col">
      <div className={`flex min-h-40 flex-1 items-end ${few ? "justify-center gap-10" : "gap-[3px]"}`}>
        {rows.map((r) => (
          <div key={r.day} className={`group flex h-full flex-col ${few ? "w-24" : "flex-1"}`} title={`${label(r.day)} · opened ${r.opened}, closed ${r.closed}`}>
            <div className="flex flex-1 items-end gap-px">
              {([["opened", r.opened, "bg-accent"], ["closed", r.closed, "bg-muted/40"]] as const).map(([k, n, c]) => (
                <div key={k} className="flex h-full flex-1 flex-col justify-end">
                  {few && <span className="mb-1 text-center text-xs font-semibold tabular-nums">{n}</span>}
                  <span className={`rounded-t ${c} transition group-hover:opacity-80`} style={{ height: `${(n / max) * (few ? 85 : 100)}%`, minHeight: n ? 3 : 0 }} />
                </div>
              ))}
            </div>
            {few && rows.length > 1 && <span className="mt-1 text-center text-xs text-muted">{label(r.day)}</span>}
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted">
        <span>{few && rows.length > 1 ? "" : label(rows[0].day)}</span>
        <span className="flex gap-4"><span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-accent" />opened</span><span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-muted/40" />closed</span></span>
        <span>{few && rows.length > 1 ? "" : rows.length > 1 ? label(rows[rows.length - 1].day) : ""}</span>
      </div>
    </div>
  );
}

function TicketList({ rows, right }: { rows: Brief[]; right: (r: Brief) => React.ReactNode }) {
  return (
    <ul className="divide-y divide-line">
      {rows.map((r) => (
        <li key={r.display_id}>
          <Link href={`/tickets/${r.display_id}`} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-accent-soft/60">
            <span className="w-24 shrink-0 font-mono text-xs font-semibold text-accent-strong">{r.display_id}</span>
            <span className="min-w-0 flex-1 truncate" title={r.title}>{r.title}</span>
            <span className="hidden w-32 shrink-0 truncate text-xs text-muted sm:block">{r.owner ?? "Unassigned"}</span>
            <span className="w-20 shrink-0 text-right text-xs">{right(r)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Stat({ k, v }: { k: string; v: number | string }) {
  return <div className="rounded-lg bg-bg px-3 py-2"><dt className="text-xs text-muted">{k}</dt><dd className="text-lg font-semibold tabular-nums">{v}</dd></div>;
}

function Skeleton() {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-24 rounded-2xl" />)}</div>
      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0"><div className="skeleton h-56 rounded-2xl" /><div className="skeleton h-56 rounded-2xl lg:col-span-2" /></div>
      <div className="grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-48 rounded-2xl" />)}</div>
    </div>
  );
}

/* ── Date range ───────────────────────────────────────────────────────────── */
interface Range { key: string; label: string; from: string; to: string }
const IST = 5.5 * 3600e3;
const istToday = () => new Date(Date.now() + IST).toISOString().slice(0, 10);
const shift = (day: string, n: number) => new Date(+new Date(`${day}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const fmt = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: day.slice(0, 4) === istToday().slice(0, 4) ? undefined : "numeric", timeZone: "UTC" });
const PRESETS: { key: string; label: string; get: () => [string, string] }[] = [
  { key: "today", label: "Today", get: () => [istToday(), istToday()] },
  { key: "yesterday", label: "Yesterday", get: () => [shift(istToday(), -1), shift(istToday(), -1)] },
  { key: "7d", label: "Last 7 days", get: () => [shift(istToday(), -6), istToday()] },
  { key: "30d", label: "Last 30 days", get: () => [shift(istToday(), -29), istToday()] },
  { key: "90d", label: "Last 90 days", get: () => [shift(istToday(), -89), istToday()] },
  { key: "month", label: "This month", get: () => [`${istToday().slice(0, 8)}01`, istToday()] },
  { key: "lastmonth", label: "Last month", get: () => { const first = `${istToday().slice(0, 8)}01`; const end = shift(first, -1); return [`${end.slice(0, 8)}01`, end]; } },
];
/** The period from the URL: a preset key (default last 30 days) or range=custom with from / to. */
function resolveRange(key: string | null, from: string | null, to: string | null): Range {
  const ok = (v: string | null) => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if (key === "custom" && ok(from) && ok(to)) {
    const [a, b] = from! <= to! ? [from!, to!] : [to!, from!];
    return { key: "custom", from: a, to: b, label: a === b ? fmt(a) : `${fmt(a)} – ${fmt(b)}` };
  }
  const p = PRESETS.find((x) => x.key === key) ?? PRESETS[3];
  const [f, t] = p.get();
  return { key: p.key, label: p.label, from: f, to: t };
}

function DateRangePicker({ range, onChange }: { range: Range; onChange: (r: Range) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="dialog" aria-expanded={open}
        className={`flex items-center gap-2 rounded-lg border bg-panel px-3 py-2 text-sm shadow-sm transition hover:border-accent ${open ? "border-accent ring-2 ring-accent-soft" : "border-line"}`}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="text-muted" aria-hidden><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></svg>
        <span className="font-medium">{range.label}</span>
        {range.key !== "custom" && range.from !== range.to && <span className="hidden text-xs text-muted sm:inline">{fmt(range.from)} – {fmt(range.to)}</span>}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-muted" aria-hidden><path d={open ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} /></svg>
      </button>
      {open && (
        <div role="dialog" aria-label="Choose a period"
          className="absolute left-0 z-40 mt-1.5 flex max-w-[calc(100vw-2rem)] overflow-hidden rounded-2xl border border-line bg-panel text-sm shadow-xl">
          <ul className="w-36 shrink-0 border-r border-line bg-bg/40 py-2">
            {PRESETS.map((p) => (
              <li key={p.key}>
                <button type="button" onClick={() => { onChange(resolveRange(p.key, null, null)); setOpen(false); }}
                  className={`mx-1.5 flex w-[calc(100%-0.75rem)] items-center justify-between rounded-lg px-2.5 py-1.5 text-left transition hover:bg-accent-soft ${range.key === p.key ? "bg-accent-soft font-medium text-accent-strong" : ""}`}>
                  {p.label}{range.key === p.key && <span aria-hidden>✓</span>}
                </button>
              </li>
            ))}
          </ul>
          <RangeCalendar initial={range} onCancel={() => setOpen(false)} onApply={(f, t) => { onChange(resolveRange("custom", f, t)); setOpen(false); }} />
        </div>
      )}
    </div>
  );
}

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const monthStart = (day: string) => `${day.slice(0, 8)}01`;
const addMonths = (first: string, n: number) => {
  const d = new Date(`${first}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) => Math.round((+new Date(`${b}T00:00:00Z`) - +new Date(`${a}T00:00:00Z`)) / 864e5);

/** Two months side by side: click a start day, then an end day (hover previews the range). Future days are off. */
function RangeCalendar({ initial, onApply, onCancel }: { initial: Range; onApply: (from: string, to: string) => void; onCancel: () => void }) {
  const today = istToday();
  const [from, setFrom] = useState<string | null>(initial.from);
  const [to, setTo] = useState<string | null>(initial.to);
  const [hover, setHover] = useState<string | null>(null);
  const [single, setSingle] = useState(initial.from === initial.to); // single-day mode: one click = that day
  // Right-hand month = the end of the current range (never past this month).
  const [right, setRight] = useState(monthStart(initial.to > today ? today : initial.to));
  const left = addMonths(right, -1);
  const canNext = right < monthStart(today);

  function pick(day: string) {
    if (single) { setFrom(day); setTo(day); return; }
    if (!from || (from && to)) { setFrom(day); setTo(null); return; }
    if (day < from) { setTo(from); setFrom(day); } else setTo(day);
  }
  const end = to ?? (!single && from && hover ? (hover < from ? from : hover) : from);
  const start = to ? from : !single && from && hover && hover < from ? hover : from;
  const tooLong = !!(from && to && daysBetween(from, to) > 365);

  const navBtn = "grid h-8 w-8 place-items-center rounded-full text-lg text-muted hover:bg-accent-soft hover:text-accent-strong disabled:opacity-30 disabled:hover:bg-transparent";
  const prev = <button type="button" onClick={() => setRight(addMonths(right, -1))} aria-label="Previous month" className={navBtn}>‹</button>;
  const next = <button type="button" onClick={() => canNext && setRight(addMonths(right, 1))} disabled={!canNext} aria-label="Next month" className={navBtn}>›</button>;
  const month = (first: string, nav: { left?: React.ReactNode; right?: React.ReactNode }) => {
    const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday first
    const len = daysBetween(first, addMonths(first, 1));
    const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: len }, (_, i) => shift(first, i))];
    return (
      <div className="w-60">
        <div className="mb-2 flex items-center justify-between">
          <span className="w-8">{nav.left}</span>
          <span className="font-semibold">{new Date(`${first}T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}</span>
          <span className="w-8">{nav.right}</span>
        </div>
        <div className="grid grid-cols-7 text-center text-[11px] font-medium text-muted">{WEEKDAYS.map((w) => <span key={w} className="py-1">{w}</span>)}</div>
        <div className="grid grid-cols-7" onMouseLeave={() => setHover(null)}>
          {cells.map((day, i) => {
            if (!day) return <span key={`x${i}`} />;
            const future = day > today;
            const edge = day === start || day === end;
            const inside = !!(start && end && day > start && day < end);
            return (
              <button key={day} type="button" disabled={future} onClick={() => pick(day)} onMouseEnter={() => setHover(day)}
                className={`relative h-8 text-sm tabular-nums transition disabled:cursor-not-allowed disabled:text-line
                  ${inside ? "bg-accent-soft text-accent-strong" : ""}
                  ${day === start && end && end !== start ? "rounded-l-full bg-accent-soft" : ""} ${day === end && start && end !== start ? "rounded-r-full bg-accent-soft" : ""}`}>
                <span className={`mx-auto grid h-8 w-8 place-items-center rounded-full
                  ${edge ? "bg-accent font-semibold text-white" : !future ? "hover:bg-accent-soft" : ""}
                  ${day === today && !edge ? "ring-1 ring-accent" : ""}`}>{Number(day.slice(8))}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="p-4">
      <div className="mb-3 inline-flex rounded-lg border border-line bg-bg p-0.5 text-xs font-medium" role="tablist" aria-label="Pick">
        {([[false, "Range"], [true, "Single day"]] as const).map(([v, l]) => (
          <button key={l} type="button" role="tab" aria-selected={single === v}
            onClick={() => { setSingle(v); if (v && from) setTo(from); }}
            className={`rounded-md px-3 py-1 ${single === v ? "bg-panel text-accent-strong shadow-sm" : "text-muted hover:text-fg"}`}>{l}</button>
        ))}
      </div>
      <div className="flex gap-6">
        <div className="hidden sm:block">{month(left, { left: prev })}</div>
        <div className="sm:hidden">{month(right, { left: prev, right: next })}</div>
        <div className="hidden sm:block">{month(right, { right: next })}</div>
      </div>
      <div className="mt-4 flex items-center gap-3 border-t border-line pt-3">
        <span className={`min-w-0 flex-1 text-xs ${tooLong ? "text-bad" : "text-muted"}`}>
          {!from ? (single ? "Pick a day" : "Pick a start date") : !to ? <>From <b className="text-fg">{fmt(from)}</b> — pick the end date, or Apply for just this day</>
            : tooLong ? "Pick a range of a year or less"
            : <><b className="text-fg">{fmt(from)}{from !== to && ` – ${fmt(to)}`}</b> · {daysBetween(from, to) + 1} day{from !== to ? "s" : ""}</>}
        </span>
        <button type="button" onClick={onCancel} className="rounded-lg border border-line px-3 py-1.5 font-medium hover:border-accent">Cancel</button>
        <button type="button" disabled={!from || tooLong} onClick={() => from && onApply(from, to ?? from)}
          className="rounded-lg bg-accent px-4 py-1.5 font-medium text-white hover:bg-accent-strong disabled:opacity-50">Apply</button>
      </div>
    </div>
  );
}


/** One row per client: open tickets created in the selected period (date and Pod filters apply). */
function ClientTable({ rows, link }: { rows: Dash["by_client"]; link: (slug: string) => string }) {
  const total = rows.reduce((n, r) => n + r.open, 0);
  return (
    <section className="card flex max-h-[28rem] min-h-80 min-w-0 flex-col overflow-hidden">
      <div className="flex flex-wrap items-baseline gap-x-2 px-5 pt-4">
        <h2 className="font-semibold">By client</h2>
        <span className="text-xs text-muted">Open tickets right now · click a client to see them</span>
      </div>
      <div className="mt-3 min-h-0 flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-head text-xs font-semibold uppercase tracking-wide text-head-fg">
            <tr><th className="px-5 py-2.5 text-left">Client</th><th className="px-5 py-2.5 text-right">Open tickets</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.slug} className="hover:bg-accent-soft/40">
                <td className="px-5 py-2.5"><Link href={link(r.slug)} className="font-medium hover:text-accent-strong hover:underline">{r.name}</Link></td>
                <td className="px-5 py-2.5 text-right font-semibold tabular-nums"><Link href={link(r.slug)} className="hover:underline">{r.open}</Link></td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={2} className="px-5 py-6 text-center text-muted">No open tickets.</td></tr>}
          </tbody>
          {rows.length > 1 && (
            <tfoot className="sticky bottom-0 bg-panel">
              <tr className="border-t border-line font-semibold">
                <td className="px-5 py-2.5">Total · {rows.length} clients</td>
                <td className="px-5 py-2.5 text-right tabular-nums">{total}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}
