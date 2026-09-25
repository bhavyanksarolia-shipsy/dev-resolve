"use client";
import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { HealthBanner } from "@/components/HealthBanner";
import { AccountPicker, type PickerAccount } from "@/components/AccountPicker";

type Account = PickerAccount;
interface Ticket {
  id: string; display_id: string; title: string; stage?: string; severity?: string; created_date: string;
  part?: string; default_part?: boolean; devrev_url: string;
  investigation: { id: number; status: string; confidence: string | null } | null;
}
interface Counts { account: { total: number; wms: number; default_part: number }; org: { total: number; wms: number } }
interface Result { key: string; tick: number; tickets?: Ticket[]; next_cursor?: string; counts?: Counts; error?: string }

const STATUS_STYLE: Record<string, string> = {
  running: "bg-amber-50 text-warn ring-amber-200", draft_ready: "bg-accent-soft text-accent-strong ring-emerald-200",
  posted: "bg-emerald-50 text-ok ring-emerald-200", failed: "bg-red-50 text-bad ring-red-200",
};
const STATUS_LABEL: Record<string, string> = {
  running: "investigating…", draft_ready: "draft ready", posted: "posted", failed: "failed",
};
const pct = (n: number, d: number) => (d ? `${((n / d) * 100).toFixed(1)}%` : "—");

export default function Home() {
  return <Suspense><Inbox /></Suspense>;
}

function Inbox() {
  const router = useRouter();
  const account = useSearchParams().get("account") || "reliance-vf";
  const [accounts, setAccounts] = useState<Account[]>([]);
  // Pagination: DevRev is cursor-based, so keep the stack of cursors that led to each page.
  const [nav, setNav] = useState<{ account: string; stack: (string | undefined)[] }>({ account, stack: [undefined] });
  const stack = nav.account === account ? nav.stack : [undefined];
  const cursor = stack[stack.length - 1];
  const [tick, setTick] = useState(0); // bump to refetch the current page
  const [result, setResult] = useState<Result | null>(null);
  const [newIds, setNewIds] = useState<{ account: string; ids: Set<string> }>({ account, ids: new Set() });
  const seen = useRef<{ account: string; ids: Set<string> }>({ account, ids: new Set() });
  const refreshing = useRef(false);
  const [starting, setStarting] = useState<Set<string>>(new Set());
  const [manual, setManual] = useState("");

  useEffect(() => {
    fetch("/api/accounts").then((r) => r.json()).then((d) => setAccounts(d.accounts));
  }, []);

  const key = `${account}|${cursor ?? ""}`;
  useEffect(() => {
    let live = true;
    fetch(`/api/tickets?account=${account}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store" }).then(async (r) => {
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
      setResult({ key, tick, tickets, next_cursor: d.next_cursor, counts: d.counts });
    });
    return () => { live = false; };
  }, [account, cursor, key, tick]);

  const fresh = result?.key === key ? result : null;
  // Anything in flight: first load, page change, manual refresh or the background status refresh.
  const fetching = !result || result.key !== key || result.tick !== tick;
  const tickets = fresh?.tickets ?? null;
  const counts = fresh?.counts ?? (result?.key.startsWith(`${account}|`) ? result.counts : undefined);
  const error = fresh?.error ?? null;
  const anyRunning = !!tickets?.some((t) => t.investigation?.status === "running");

  // After a network error (VPN connecting, Wi-Fi switch), retry on our own every 10s.
  useEffect(() => {
    if (!error) return;
    const t = setInterval(() => setTick((n) => n + 1), 10000);
    return () => clearInterval(t);
  }, [error]);

  // While something is being investigated, keep its row status live.
  useEffect(() => {
    if (!anyRunning) return;
    const t = setInterval(() => setTick((n) => n + 1), 10000);
    return () => clearInterval(t);
  }, [anyRunning]);

  const setAccount = (slug: string) => router.replace(`/?account=${slug}`);
  const next = () => fresh?.next_cursor && setNav({ account, stack: [...stack, fresh.next_cursor] });
  const prev = () => stack.length > 1 && setNav({ account, stack: stack.slice(0, -1) });
  const refresh = () => {
    refreshing.current = true;
    setNav({ account, stack: [undefined] });
    setTick((n) => n + 1);
  };

  async function investigate(t: Ticket) {
    setStarting((s) => new Set(s).add(t.display_id));
    const r = await fetch("/api/investigations", { method: "POST", body: JSON.stringify({ ticket: t.display_id }) });
    const d = await r.json();
    setStarting((s) => { const n = new Set(s); n.delete(t.display_id); return n; });
    if (!r.ok) return alert(d.error);
    setTick((n) => n + 1);
  }

  const current = accounts.find((a) => a.slug === account);
  const marked = newIds.account === account ? newIds.ids : new Set<string>();

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
        <Stat loading={!counts && !error} label={`${current?.name ?? account} · open tickets`} value={counts ? String(counts.account.total) : "—"}
          sub={counts ? `${counts.account.wms} WMS · ${counts.account.default_part} TMS (default)` : undefined} />
        <Stat loading={!counts && !error} label="In DevRev WMS view" value={counts ? String(counts.account.wms) : "—"} sub="matches DevRev"
          hint="Part under the WMS product. Tickets still on the default TMS part aren't counted here until triaged." />
        <Stat loading={!counts && !error} label="Share of DevRev WMS view" value={counts ? pct(counts.account.wms, counts.org.wms) : "—"}
          sub={counts ? `${counts.account.wms} of ${counts.org.wms}` : undefined} />
        <Stat loading={!counts && !error} label="Share of all open Support tickets" value={counts ? pct(counts.account.total, counts.org.total) : "—"}
          sub={counts ? `${counts.account.total} of ${counts.org.total}` : undefined} />
      </div>
      {counts && counts.account.default_part > 0 && (
        <p className="-mt-2 text-xs text-muted">
          <span className="font-medium text-warn">{counts.account.default_part} ticket(s)</span> are still on the default <b>TMS</b> part (new email tickets land there),
          so DevRev&apos;s WMS view doesn&apos;t count them yet. They&apos;re tagged <span className="font-medium text-warn">TMS (default)</span> below.
        </p>
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
            <p className="text-xs text-muted">DevRev support stages · newest first · page {stack.length}</p>
          </div>
          {marked.size > 0 && <span className="rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent-strong">{marked.size} new since last refresh</span>}
          <div className="ml-auto flex gap-2 text-sm">
            <button onClick={refresh} disabled={fetching}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-3 py-1.5 font-medium hover:border-accent hover:text-accent-strong disabled:opacity-70">
              <span className={`inline-block ${fetching ? "spin" : ""}`}>↻</span>{fetching ? "Refreshing…" : "Refresh"}
            </button>
            <button onClick={prev} disabled={stack.length <= 1 || fetching} className="rounded-lg border border-line bg-panel px-3 py-1.5 hover:border-accent disabled:opacity-40">← Prev</button>
            <button onClick={next} disabled={!fresh?.next_cursor || fetching} className="rounded-lg border border-line bg-panel px-3 py-1.5 hover:border-accent disabled:opacity-40">Next →</button>
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
                <tr>
                  <th className="px-5 py-3">Ticket</th><th className="px-4 py-3">Title</th><th className="px-4 py-3">Part</th>
                  <th className="px-4 py-3">Stage</th><th className="px-4 py-3">Created</th><th className="px-5 py-3">Dev Resolve</th>
                </tr>
              </thead>
              <tbody className={`divide-y divide-line transition-opacity ${fetching && tickets ? "opacity-60" : ""}`}>
                {!tickets && Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)}
                {tickets?.map((t) => {
                  const inv = t.investigation;
                  const busy = starting.has(t.display_id) || inv?.status === "running";
                  return (
                    <tr key={t.id} className={`transition-colors hover:bg-accent-soft/60 ${marked.has(t.display_id) ? "bg-accent-soft" : ""}`}>
                      <td className="whitespace-nowrap px-5 py-3.5 font-mono">
                        <Link className="font-medium text-accent-strong hover:underline" href={`/tickets/${t.display_id}`}>{t.display_id}</Link>
                        <a href={t.devrev_url} target="_blank" rel="noreferrer" title="Open in DevRev" className="ml-2 text-xs text-muted hover:text-accent">DevRev ↗</a>
                        {marked.has(t.display_id) && <span className="ml-2 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase text-white">new</span>}
                      </td>
                      <td className="min-w-72 px-4 py-3.5">{t.title}</td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-muted">
                        {t.default_part
                          ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-warn ring-1 ring-amber-200" title="Default part — not triaged to WMS yet, so not in DevRev's WMS view">TMS (default)</span>
                          : t.part}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3.5"><span className="rounded-full bg-bg px-2 py-0.5 text-xs text-muted ring-1 ring-line">{t.stage}</span></td>
                      <td className="whitespace-nowrap px-4 py-3.5 text-muted">{new Date(t.created_date).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</td>
                      <td className="whitespace-nowrap px-5 py-3.5">
                        <div className="flex items-center gap-2">
                          {inv && (
                            <Link href={`/tickets/${t.display_id}`} className={`rounded-full px-2 py-0.5 text-xs font-medium ring-1 hover:underline ${STATUS_STYLE[inv.status] ?? "text-muted ring-line"}`}>
                              {STATUS_LABEL[inv.status] ?? inv.status}{inv.confidence ? ` · ${inv.confidence}` : ""}
                            </Link>
                          )}
                          <button onClick={() => investigate(t)} disabled={busy}
                            className="inline-flex items-center gap-1 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-accent-strong disabled:opacity-60">
                            {busy && <span className="spin inline-block">↻</span>}
                            {busy ? "Investigating…" : inv ? "Re-investigate" : "Investigate"}
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {tickets && !tickets.length && <tr><td colSpan={6} className="px-5 py-10 text-center text-muted">No open Support tickets for this account.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function SkeletonRow() {
  return (
    <tr>
      <td className="px-5 py-4"><div className="skeleton h-4 w-24" /></td>
      <td className="px-4 py-4"><div className="skeleton h-4 w-72 max-w-full" /></td>
      <td className="px-4 py-4"><div className="skeleton h-4 w-16" /></td>
      <td className="px-4 py-4"><div className="skeleton h-5 w-20 rounded-full" /></td>
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
