"use client";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AccountPicker, withAllClients, type PickerAccount } from "@/components/AccountPicker";
import { HealthBanner } from "@/components/HealthBanner";

interface Count { value: string; count: number }
interface Brief { display_id: string; title: string; created: string; closed: string | null; stage: string; owner: string | null; pod: string | null }
interface Dash {
  inactive?: boolean; error?: string;
  account: { slug: string; name: string }; days: number;
  counts: { account: { total: number; wms: number; default_part: number }; org: { total: number; wms: number } };
  open: { total: number; by_stage: Count[]; by_pod: Count[]; by_owner: Count[]; by_age: { label: string; count: number }[]; oldest: Brief[];
    gaps: { default_part: number; no_pod: number; unassigned: number; not_investigated: number } };
  flow: { opened: number; closed: number; per_day: { day: string; opened: number; closed: number }[] };
  recently_closed: Brief[];
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
  const days = [7, 30, 90].includes(Number(params.get("days"))) ? Number(params.get("days")) : 30;
  const go = (patch: Record<string, string>) => {
    const sp = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) sp.set(k, v);
    router.replace(`/?${sp.toString()}`, { scroll: false });
  };

  const [data, setData] = useState<{ key: string; d: Dash } | null>(null);
  const key = `${account}|${days}`;
  useEffect(() => {
    let live = true;
    fetch(`/api/dashboard?account=${account}&days=${days}`, { cache: "no-store" })
      .then(async (r) => { const d = await r.json(); if (live) setData({ key, d: r.ok ? d : { error: d.error || `HTTP ${r.status}` } as Dash }); })
      .catch(() => live && setData({ key, d: { error: "Couldn't reach the backend" } as Dash }));
    return () => { live = false; };
  }, [account, days, key]);
  const d = data?.key === key ? data.d : null;
  const t = (q: string) => `/tickets?account=${account}${q}`; // Tickets table link with filters

  if (loaded && !accounts.length) {
    return <div className="card p-6 text-sm text-muted">No clients on this server yet — an admin adds them in <Link href="/admin" className="text-accent-strong underline">Admin</Link>.</div>;
  }
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <AccountPicker accounts={withAllClients(accounts)} value={account} onChange={(slug) => go({ account: slug })} />
        <div className="inline-flex rounded-lg border border-line bg-panel p-0.5 text-sm font-medium" role="tablist" aria-label="Period">
          {[7, 30, 90].map((n) => (
            <button key={n} role="tab" aria-selected={days === n} onClick={() => go({ days: String(n) })}
              className={`rounded-md px-3 py-1.5 ${days === n ? "bg-accent text-white shadow-sm" : "text-muted hover:text-fg"}`}>{n} days</button>
          ))}
        </div>
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
            <Kpi label={`Opened · ${days} days`} value={d.flow.opened} sub={`${(d.flow.opened / days).toFixed(1)} a day`} />
            <Kpi label={`Closed · ${days} days`} value={d.flow.closed}
              sub={d.flow.closed >= d.flow.opened ? "keeping up with new tickets" : `${d.flow.opened - d.flow.closed} more opened than closed`}
              tone={d.flow.closed >= d.flow.opened ? "ok" : "warn"} />
            <Kpi label={`RCAs posted · ${days} days`} value={d.dev_resolve.posted} sub={`${d.dev_resolve.investigations} investigations on ${d.dev_resolve.tickets} tickets`} />
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
            <Panel title="Opened vs closed" hint={`Per day, last ${days} days`} className="lg:col-span-2">
              <FlowChart rows={d.flow.per_day} />
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel title="Age of open tickets">
              <Bars items={d.open.by_age.map((a) => ({ label: a.label, count: a.count }))} tone={(i) => (i >= 3 ? "bg-warn" : "bg-accent")} />
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
            <Panel title="Dev Resolve" hint={`Last ${days} days`}>
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
            <Panel title="Recently closed" hint={`Last ${days} days`} className="lg:col-span-2">
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
