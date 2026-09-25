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
interface Result { key: string; tickets?: Ticket[]; next_cursor?: string; counts?: Counts; error?: string }

const STATUS_STYLE: Record<string, string> = {
  running: "text-warn", draft_ready: "text-accent", posted: "text-ok", failed: "text-bad",
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
      if (!r.ok) return setResult({ key, error: `${d.tag ?? "Error"} (${d.connection ?? "?"}): ${d.error}` });
      const tickets: Ticket[] = d.tickets;
      if (seen.current.account !== account) seen.current = { account, ids: new Set() };
      // After a manual refresh, anything we hadn't seen before is marked "new".
      if (refreshing.current && seen.current.ids.size) {
        const fresh = tickets.filter((t) => !seen.current.ids.has(t.display_id)).map((t) => t.display_id);
        setNewIds({ account, ids: new Set(fresh) });
      }
      refreshing.current = false;
      tickets.forEach((t) => seen.current.ids.add(t.display_id));
      setResult({ key, tickets, next_cursor: d.next_cursor, counts: d.counts });
    });
    return () => { live = false; };
  }, [account, cursor, key, tick]);

  const fresh = result?.key === key ? result : null;
  const tickets = fresh?.tickets ?? null;
  const counts = fresh?.counts ?? (result?.key.startsWith(`${account}|`) ? result.counts : undefined);
  const error = fresh?.error ?? null;
  const anyRunning = !!tickets?.some((t) => t.investigation?.status === "running");

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
    <div>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <AccountPicker accounts={accounts} value={account} onChange={setAccount} />
        <form className="ml-auto flex gap-2" onSubmit={(e) => { e.preventDefault(); if (manual.trim()) router.push(`/tickets/${manual.trim().toUpperCase()}`); }}>
          <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Open TKT-…" className="w-40 rounded-md border border-line bg-panel px-2 py-1.5 text-sm" />
          <button className="rounded-md bg-accent px-3 py-1.5 text-sm text-white">Open</button>
        </form>
      </div>

      <HealthBanner account={account} />

      {/* Queue numbers follow DevRev's WMS "Support" view (config devrev_view): Support subtype, support-workflow stages. */}
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`${current?.name ?? account} · open tickets`} value={counts ? String(counts.account.total) : "…"}
          sub={counts ? `${counts.account.wms} WMS · ${counts.account.default_part} TMS (default)` : undefined} />
        <Stat label="In DevRev WMS view" value={counts ? String(counts.account.wms) : "…"} sub="matches DevRev"
          hint="Part under the WMS product. Tickets still on the default TMS part aren't counted here until triaged." />
        <Stat label="Share of DevRev WMS view" value={counts ? pct(counts.account.wms, counts.org.wms) : "…"}
          sub={counts ? `${counts.account.wms} of ${counts.org.wms}` : undefined} />
        <Stat label="Share of all open Support tickets" value={counts ? pct(counts.account.total, counts.org.total) : "…"}
          sub={counts ? `${counts.account.total} of ${counts.org.total}` : undefined} />
      </div>
      {counts && counts.account.default_part > 0 && (
        <div className="mb-4 text-xs text-muted">
          <span className="text-warn">{counts.account.default_part} ticket(s)</span> are still on the default <b>TMS</b> part (new email tickets land there),
          so DevRev&apos;s WMS view doesn&apos;t count them yet. They&apos;re listed below with a <span className="text-warn">TMS (default)</span> tag.
        </div>
      )}

      {current && current.status !== "active" && (
        <div className="mb-4 rounded-md border border-warn/40 bg-warn/5 px-3 py-2 text-sm">
          <b className="text-warn">{current.name}: logs and DB are not configured yet.</b>{" "}
          Investigations can only use code search and past cases until its OpenSearch / Metabase connection is added to{" "}
          <code>config/projects.json</code> + <code>config/config.env</code>.
        </div>
      )}

      <div className="mb-2 flex items-center gap-3 text-sm">
        <span className="text-muted">Open Support tickets (DevRev support stages) · newest first · page {stack.length}</span>
        {marked.size > 0 && <span className="text-ok">{marked.size} new since last refresh</span>}
        <div className="ml-auto flex gap-2">
          <button onClick={refresh} className="rounded-md border border-line bg-panel px-3 py-1 hover:bg-bg">↻ Refresh</button>
          <button onClick={prev} disabled={stack.length <= 1} className="rounded-md border border-line bg-panel px-3 py-1 hover:bg-bg disabled:opacity-40">← Prev</button>
          <button onClick={next} disabled={!fresh?.next_cursor} className="rounded-md border border-line bg-panel px-3 py-1 hover:bg-bg disabled:opacity-40">Next →</button>
        </div>
      </div>

      {error && <div className="rounded-md border border-bad/40 bg-bad/5 px-3 py-2 text-sm text-bad">{error}</div>}
      {!tickets && !error && <div className="text-sm text-muted">Loading tickets…</div>}
      {tickets && (
        <div className="overflow-x-auto rounded-lg border border-line bg-panel">
          <table className="w-full text-sm">
            <thead className="border-b border-line text-left text-muted">
              <tr>
                <th className="px-3 py-2">Ticket</th><th className="px-3 py-2">Title</th><th className="px-3 py-2">Part</th>
                <th className="px-3 py-2">Stage</th><th className="px-3 py-2">Created</th><th className="px-3 py-2">Dev Resolve</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => {
                const inv = t.investigation;
                const busy = starting.has(t.display_id) || inv?.status === "running";
                return (
                  <tr key={t.id} className={`border-b border-line last:border-0 hover:bg-bg ${marked.has(t.display_id) ? "bg-ok/5" : ""}`}>
                    <td className="whitespace-nowrap px-3 py-2 font-mono">
                      <Link className="text-accent hover:underline" href={`/tickets/${t.display_id}`}>{t.display_id}</Link>
                      <a href={t.devrev_url} target="_blank" rel="noreferrer" title="Open in DevRev" className="ml-2 text-xs text-muted hover:text-accent">DevRev ↗</a>
                      {marked.has(t.display_id) && <span className="ml-2 rounded bg-ok/15 px-1 text-xs text-ok">new</span>}
                    </td>
                    <td className="px-3 py-2">{t.title}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted">
                      {t.default_part
                        ? <span className="rounded border border-warn/40 bg-warn/5 px-1.5 text-xs text-warn" title="Default part — not triaged to WMS yet, so not in DevRev's WMS view">TMS (default)</span>
                        : t.part}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted">{t.stage}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-muted">{new Date(t.created_date).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <div className="flex items-center gap-2">
                        {inv && (
                          <Link href={`/tickets/${t.display_id}`} className={`hover:underline ${STATUS_STYLE[inv.status] ?? "text-muted"}`}>
                            {STATUS_LABEL[inv.status] ?? inv.status}{inv.confidence ? ` · ${inv.confidence}` : ""}
                          </Link>
                        )}
                        <button onClick={() => investigate(t)} disabled={busy}
                          className="rounded-md bg-accent px-2.5 py-1 text-xs text-white disabled:opacity-50">
                          {busy ? "Investigating…" : inv ? "Re-investigate" : "Investigate"}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {!tickets.length && <tr><td colSpan={6} className="px-3 py-6 text-center text-muted">No open Support tickets for this account.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, hint }: { label: string; value: string; sub?: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel px-3 py-2" title={hint}>
      <div className="text-xs text-muted">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}{sub && <span className="ml-1 text-sm font-normal text-muted">{sub}</span>}</div>
    </div>
  );
}
