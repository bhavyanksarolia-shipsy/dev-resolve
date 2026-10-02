"use client";
import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AccountPicker, withAllClients, type PickerAccount } from "@/components/AccountPicker";
import { HealthBanner } from "@/components/HealthBanner";

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
  useEffect(() => {
    fetch("/api/accounts").then((r) => r.json()).then((d) => { setAccounts(d.accounts ?? []); setLoaded(true); }).catch(() => setLoaded(true));
  }, []);
  const account = params.get("account") || "all"; // all clients by default; narrow down in the picker
  const range = resolveRange(params.get("range"), params.get("from"), params.get("to"));
  const podParam = params.get("pod"); // null = all Pods; "A|B" = those Pods ("-" = not set)
  const podSel = podParam ? podParam.split("|") : null;
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
  const t = (q: string) => `/tickets?account=${account}${podParam != null && !q.includes("fpod=") ? `&fpod=${encodeURIComponent(podParam)}` : ""}${q}`;
  // Pod choices: every Pod with open tickets (the server sends all of them even when one Pod is selected).
  const podChoices = (d?.pod_status?.rows ?? []).filter((r) => r.open).map((r) => ({ value: r.pod, count: r.open }));

  if (loaded && !accounts.length) {
    return <div className="card p-6 text-sm text-muted">No clients on this server yet — an admin adds them in <Link href="/admin" className="text-accent-strong underline">Admin</Link>.</div>;
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <AccountPicker accounts={withAllClients(accounts)} value={account} onChange={(slug) => go({ account: slug })} />
        <PodPicker value={podSel} choices={podChoices} onChange={(v) => go({ pod: v && v.length ? v.join("|") : null })} />
        <DateRangePicker range={range} onChange={(r) => go(r.key === "custom" ? { range: "custom", from: r.from, to: r.to } : { range: r.key, from: null, to: null })} />
        <Link href={t("")} className="ml-auto rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-strong">Open tickets →</Link>
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

          <div className="grid gap-4 lg:grid-cols-3">
            {/* Needs attention */}
            <Panel title="Needs triage" hint="Click to see those tickets">
              <ul className="divide-y divide-line">
                <Gap label="Still on the default TMS part" sub="Not in DevRev's WMS view yet" n={d.open.gaps.default_part} href={t("&part=default")} />
                <Gap label="No Pod" n={d.open.gaps.no_pod} href={t("&fpod=-")} />
                <Gap label="Unassigned" n={d.open.gaps.unassigned} href={t("&fowner=-")} />
                <Gap label="Not investigated yet" sub="No Dev Resolve RCA" n={d.open.gaps.not_investigated} href={t("")} />
              </ul>
            </Panel>
            {/* Flow */}
            <Panel title="Opened vs closed" hint={`${d.step > 1 ? "Per week" : "Per day"} · ${range.label}`} className="lg:col-span-2">
              <FlowChart rows={d.flow.per_day} />
              {d.flow.partial && <p className="mt-2 text-xs text-warn">Very busy period — the chart shows the most recent 5,000 tickets; the totals above are exact.</p>}
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
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

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Workload" hint="Open tickets per person">
              <Bars items={d.open.by_owner.map((o) => ({ label: o.value || "Unassigned", count: o.count, href: t(`&fowner=${encodeURIComponent(o.value || "-")}`), muted: !o.value }))} />
            </Panel>
            <Panel title="Oldest open" className="lg:col-span-2">
              <TicketList rows={d.open.oldest} right={(r) => <span className="text-warn">{ago(r.created)} old</span>} />
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
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
    <section className={`card p-5 ${className}`}>
      <div className="mb-3 flex items-baseline gap-2"><h2 className="font-semibold">{title}</h2>{hint && <span className="text-xs text-muted">{hint}</span>}</div>
      {children}
    </section>
  );
}

function Gap({ label, sub, n, href }: { label: string; sub?: string; n: number; href: string }) {
  return (
    <li>
      <Link href={href} className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-accent-soft/60">
        <span className="min-w-0 flex-1"><span className="block text-sm">{label}</span>{sub && <span className="block text-xs text-muted">{sub}</span>}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold tabular-nums ${n ? "bg-amber-50 text-warn" : "bg-accent-soft text-accent-strong"}`}>{n}</span>
        <span className="text-muted" aria-hidden>›</span>
      </Link>
    </li>
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
  const max = Math.max(1, ...rows.flatMap((r) => [r.opened, r.closed]));
  const label = (d: string) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return (
    <div>
      <div className="flex h-40 items-end gap-[3px]">
        {rows.map((r) => (
          <div key={r.day} className="group flex h-full flex-1 items-end gap-px" title={`${label(r.day)} · opened ${r.opened}, closed ${r.closed}`}>
            <span className="flex-1 rounded-t bg-accent transition group-hover:opacity-80" style={{ height: `${(r.opened / max) * 100}%`, minHeight: r.opened ? 3 : 0 }} />
            <span className="flex-1 rounded-t bg-muted/40 transition group-hover:opacity-80" style={{ height: `${(r.closed / max) * 100}%`, minHeight: r.closed ? 3 : 0 }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted">
        <span>{label(rows[0].day)}</span>
        <span className="flex gap-4"><span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-accent" />opened</span><span><span className="mr-1 inline-block h-2 w-2 rounded-sm bg-muted/40" />closed</span></span>
        <span>{label(rows[rows.length - 1].day)}</span>
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
      <div className="grid gap-4 lg:grid-cols-3"><div className="skeleton h-56 rounded-2xl" /><div className="skeleton h-56 rounded-2xl lg:col-span-2" /></div>
      <div className="grid gap-4 lg:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-48 rounded-2xl" />)}</div>
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
  // Right-hand month = the end of the current range (never past this month).
  const [right, setRight] = useState(monthStart(initial.to > today ? today : initial.to));
  const left = addMonths(right, -1);
  const canNext = right < monthStart(today);

  function pick(day: string) {
    if (!from || (from && to)) { setFrom(day); setTo(null); return; }
    if (day < from) { setTo(from); setFrom(day); } else setTo(day);
  }
  const end = to ?? (from && hover ? (hover < from ? from : hover) : null);
  const start = to ? from : from && hover && hover < from ? hover : from;
  const tooLong = !!(from && to && daysBetween(from, to) > 365);

  const month = (first: string) => {
    const lead = (new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday first
    const len = daysBetween(first, addMonths(first, 1));
    const cells: (string | null)[] = [...Array(lead).fill(null), ...Array.from({ length: len }, (_, i) => shift(first, i))];
    return (
      <div className="w-60">
        <div className="mb-2 text-center font-semibold">{new Date(`${first}T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })}</div>
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
      <div className="mb-1 flex items-center justify-between">
        <button type="button" onClick={() => setRight(addMonths(right, -1))} aria-label="Previous month"
          className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-accent-soft hover:text-accent-strong">‹</button>
        <button type="button" onClick={() => canNext && setRight(addMonths(right, 1))} disabled={!canNext} aria-label="Next month"
          className="grid h-8 w-8 place-items-center rounded-full text-muted hover:bg-accent-soft hover:text-accent-strong disabled:opacity-30">›</button>
      </div>
      <div className="-mt-9 flex gap-6">
        <div className="hidden sm:block">{month(left)}</div>
        {month(right)}
      </div>
      <div className="mt-4 flex items-center gap-3 border-t border-line pt-3">
        <span className={`min-w-0 flex-1 text-xs ${tooLong ? "text-bad" : "text-muted"}`}>
          {!from ? "Pick a start date" : !to ? <>From <b className="text-fg">{fmt(from)}</b> — now pick the end date</>
            : tooLong ? "Pick a range of a year or less"
            : <><b className="text-fg">{fmt(from)}{from !== to && ` – ${fmt(to)}`}</b> · {daysBetween(from, to) + 1} day{from !== to ? "s" : ""}</>}
        </span>
        <button type="button" onClick={onCancel} className="rounded-lg border border-line px-3 py-1.5 font-medium hover:border-accent">Cancel</button>
        <button type="button" disabled={!from || !to || tooLong} onClick={() => from && to && onApply(from, to)}
          className="rounded-lg bg-accent px-4 py-1.5 font-medium text-white hover:bg-accent-strong disabled:opacity-50">Apply</button>
      </div>
    </div>
  );
}

/** Multi-select Pod filter for the whole dashboard (none ticked = all Pods). */
function PodPicker({ value, choices, onChange }: { value: string[] | null; choices: { value: string; count: number }[]; onChange: (v: string[] | null) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const name = (v: string) => (v === "-" ? "Not set" : v);
  const label = !value?.length ? "All Pods" : value.length === 1 ? name(value[0]) : `${value.length} Pods`;
  const items = choices.map((c) => ({ v: c.value || "-", label: c.value || "Not set", count: c.count }));
  const toggle = (v: string) => setDraft((d) => (d.includes(v) ? d.filter((x) => x !== v) : [...d, v]));
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => { setDraft(value ?? []); setOpen((o) => !o); }} aria-haspopup="listbox" aria-expanded={open}
        title={value?.length ? value.map(name).join(", ") : undefined}
        className={`flex items-center gap-2 rounded-lg border bg-panel px-3 py-2 text-sm shadow-sm transition hover:border-accent ${open ? "border-accent ring-2 ring-accent-soft" : value?.length ? "border-accent" : "border-line"}`}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted" aria-hidden><path d="M3 5h18l-7 8v6l-4 2v-8Z" /></svg>
        <span className={`max-w-48 truncate font-medium ${value?.length ? "text-accent-strong" : ""}`}>{label}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-muted" aria-hidden><path d={open ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} /></svg>
      </button>
      {open && (
        <div className="absolute left-0 z-40 mt-1.5 w-64 overflow-hidden rounded-xl border border-line bg-panel text-sm shadow-xl">
          <div className="flex items-center justify-between border-b border-line px-3 py-2 text-xs">
            <span className="text-muted">{draft.length ? `${draft.length} selected` : "All Pods"}</span>
            <span className="flex gap-3">
              <button type="button" className="text-accent-strong hover:underline" onClick={() => setDraft(items.map((i) => i.v))}>Select all</button>
              <button type="button" className="text-accent-strong hover:underline" onClick={() => setDraft([])}>Clear</button>
            </span>
          </div>
          <ul role="listbox" aria-multiselectable="true" className="max-h-72 overflow-auto py-1">
            {!items.length && <li className="px-3 py-2 text-muted">Loading…</li>}
            {items.map((it) => (
              <li key={it.v}>
                <label className={`flex cursor-pointer items-center gap-2.5 px-3 py-1.5 hover:bg-accent-soft ${it.v === "-" ? "text-muted" : ""}`}>
                  <input type="checkbox" checked={draft.includes(it.v)} onChange={() => toggle(it.v)} className="h-4 w-4 accent-[var(--accent)]" />
                  <span className="flex-1 truncate">{it.label}</span>
                  <span className="text-xs tabular-nums text-muted">{it.count}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2 border-t border-line px-3 py-2">
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-line px-3 py-1 font-medium hover:border-accent">Cancel</button>
            <button type="button" onClick={() => { onChange(draft.length && draft.length < items.length ? draft : null); setOpen(false); }}
              className="rounded-lg bg-accent px-3 py-1 font-medium text-white hover:bg-accent-strong">Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}
