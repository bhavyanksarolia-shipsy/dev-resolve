"use client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "@/components/Dialog";
import { btn, btnPrimary, Field, input, post } from "./ui";
import { Block } from "./ServiceCard";

interface Storage {
  db: { bytes: number; limitBytes: number | null; limitMb: number | null; disk: { used: number; data: number; system: number; wal: number | null } };
  parts: { key: string; label: string; bytes: number; rows: number | null }[];
  growth: { last30: number; total: number; since: string | null; perInvestigation: number; perMonth: number };
  volume: { path: string; total: number; free: number } | null; // a disk of its own (mounted volume) — else none
  own: { label: string; bytes: number }[];
  sessions: { files: number; bytes: number } | null;
}
const size = (b: number) => (b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(2)} GB` : b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const pct = (a: number, b: number) => (b ? Math.min(100, (a / b) * 100) : 0);

function Bar({ used, total }: { used: number; total: number }) {
  const p = pct(used, total);
  const tone = p >= 90 ? "bg-bad" : p >= 75 ? "bg-warn" : "bg-ok";
  return (
    <div>
      <div className="h-2.5 overflow-hidden rounded-full bg-bg ring-1 ring-line"><div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(p, 1)}%` }} /></div>
      <div className="mt-1.5 flex justify-between text-xs text-muted"><span><b className="font-medium text-fg">{size(used)}</b> used</span><span>{p.toFixed(p < 1 ? 1 : 0)}% of {size(total)}</span></div>
    </div>
  );
}

/**
 * Admin → Files & extension → Storage, laid out like the Claude / DevRev / Email cards: how big the database is, what
 * takes the space, the server's disk, and how fast it grows.
 */
export function StorageCard() {
  const [d, setD] = useState<Storage | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);
  const [limit, setLimit] = useState("");
  const load = useCallback(() => fetch("/api/admin/storage", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then(setD).catch(() => setD(null)), []);
  useEffect(() => { void load(); }, [load]);
  const recheck = async () => { setBusy(true); await load(); setBusy(false); };
  const save = async () => {
    setBusy(true);
    const r = await post<{ message?: string }>("/api/admin/storage", { dbLimitMb: limit });
    setBusy(false);
    toast({ ok: !r.error, text: r.error || r.message || "Saved" });
    if (!r.error) { setEdit(false); void load(); }
  };
  if (d === undefined) return <div className="skeleton h-48 w-full rounded-2xl" />;
  if (!d) return <div className="card p-5 text-sm text-bad">Couldn&apos;t load the storage figures.</div>;

  const dbPct = d.db.limitBytes ? pct(d.db.disk.used, d.db.limitBytes) : null;
  const diskUsed = d.volume ? d.volume.total - d.volume.free : 0;
  const diskPct = d.volume ? pct(diskUsed, d.volume.total) : null;
  const ownTotal = d.own.reduce((n, x) => n + x.bytes, 0);
  const worst = Math.max(dbPct ?? 0, diskPct ?? 0);
  const monthsLeft = d.db.limitBytes && d.growth.perMonth > 0 ? (d.db.limitBytes - d.db.disk.used) / d.growth.perMonth : null;
  const biggest = d.parts[0]?.bytes || 1;

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-semibold">Storage — database &amp; disk</h3>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${worst >= 90 ? "bg-red-50 text-bad" : worst >= 75 ? "bg-amber-50 text-warn" : "bg-accent-soft text-accent-strong"}`}>
          {worst >= 90 ? "almost full" : worst >= 75 ? "filling up" : "plenty of space"}
        </span>
        <div className="ml-auto flex gap-2">
          <button className={btn} disabled={busy} onClick={recheck}>{busy && !edit ? "Checking…" : "Refresh"}</button>
          <button className={btnPrimary} onClick={() => { setLimit(d.db.limitMb ? String(d.db.limitMb) : ""); setEdit((e) => !e); }}>{edit ? "Close" : "Edit"}</button>
        </div>
      </div>

      {worst >= 75 && (
        <div className={`mt-4 rounded-xl px-4 py-3 text-sm ring-1 ${worst >= 90 ? "bg-red-50 ring-red-200" : "bg-amber-50 ring-amber-200"}`}>
          <b className={`font-semibold ${worst >= 90 ? "text-bad" : "text-warn"}`}>{diskPct && diskPct >= (dbPct ?? 0) ? "The server's disk" : "The database"} is {Math.round(worst)}% full.</b>
          <span className="text-muted"> Investigation trails and attached files are what grows — archive closed tickets, or move to a bigger plan.</span>
        </div>
      )}

      {edit ? (
        <div className="mt-4 space-y-4 rounded-xl bg-bg p-4">
          <Block title="Database disk" hint="The database can't see its own disk's size — enter it to see how full it is. Railway: Postgres service → Volume (the trial gives 500 MB)">
            <Field label="Disk size (MB)">
              <input className={`${input} w-32`} inputMode="numeric" value={limit} placeholder="e.g. 500" onChange={(e) => setLimit(e.target.value.replace(/\D/g, ""))} />
            </Field>
          </Block>
          <div className="flex gap-2">
            <button className={btnPrimary} disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
            <button className={btn} onClick={() => setEdit(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Block title="Database">
            <div className="text-2xl font-semibold tabular-nums">{size(d.db.bytes)}</div>
            <div className="mb-3 text-xs text-muted">Dev Resolve&apos;s data: investigations, RCAs, files, settings, knowledge and sign-ins</div>
            <div className="mb-1.5 text-xs font-medium">Postgres disk</div>
            {d.db.limitBytes ? <Bar used={d.db.disk.used} total={d.db.limitBytes} />
              : <p className="text-xs"><b className="font-medium">{size(d.db.disk.used)}</b> used · <span className="text-muted">set the disk size under <b>Edit</b> to see how full it is</span></p>}
            <ul className="mt-2 space-y-0.5 text-xs text-muted">
              <li className="flex justify-between"><span>Dev Resolve&apos;s data</span><span className="tabular-nums">{size(d.db.disk.data)}</span></li>
              <li className="flex justify-between"><span>Postgres&apos;s system databases</span><span className="tabular-nums">{size(d.db.disk.system)}</span></li>
              {d.db.disk.wal != null && <li className="flex justify-between"><span>Change log (kept for crash safety)</span><span className="tabular-nums">{size(d.db.disk.wal)}</span></li>}
            </ul>
            <p className="mt-2 text-[11px] text-muted">The host&apos;s own volume page may show a little more (file-system overhead).</p>
          </Block>
          <Block title="Server files">
            <div className="text-2xl font-semibold tabular-nums">{size(ownTotal)}</div>
            <div className="mb-3 text-xs text-muted">Dev Resolve&apos;s own files on the server</div>
            <ul className="mb-3 space-y-1 text-sm">
              {d.own.map((x) => <li key={x.label} className="flex justify-between gap-3"><span className="text-muted">{x.label}</span><span className="tabular-nums">{size(x.bytes)}</span></li>)}
            </ul>
            {d.volume ? <Bar used={diskUsed} total={d.volume.total} />
              : <p className="rounded-lg bg-bg px-3 py-2 text-xs text-muted">No disk of its own: these files live on the server&apos;s temporary space and are cleared on every deploy (code is copied again; chats rebuild their context). Add a volume at <code>/data</code> in Railway to keep them and see its size here.</p>}
          </Block>
          <Block title="What takes the space">
            <ul className="space-y-2.5 text-sm">
              {d.parts.map((p) => (
                <li key={p.key}>
                  <div className="flex items-baseline gap-2"><span className="min-w-0 flex-1 truncate">{p.label}</span>
                    {p.rows != null && <span className="text-xs text-muted">{p.rows.toLocaleString("en-IN")} items</span>}
                    <span className="w-20 text-right font-medium tabular-nums">{size(p.bytes)}</span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-bg"><div className="h-full rounded-full bg-accent/70" style={{ width: `${Math.max(pct(p.bytes, biggest), 1)}%` }} /></div>
                </li>
              ))}
              <li className="flex items-baseline gap-2 border-t border-line pt-2.5 font-semibold">
                <span className="flex-1">Total</span><span className="w-20 text-right tabular-nums">{size(d.parts.reduce((n, p) => n + p.bytes, 0))}</span>
              </li>
            </ul>
          </Block>
          <Block title="Growth">
            <div className="flex flex-wrap gap-8">
              <div><div className="text-xl font-semibold tabular-nums">{d.growth.last30}</div><div className="text-xs text-muted">investigations, last 30 days</div></div>
              <div><div className="text-xl font-semibold tabular-nums">{size(d.growth.perInvestigation)}</div><div className="text-xs text-muted">per investigation (trail + files)</div></div>
              <div><div className="text-xl font-semibold tabular-nums">~{size(d.growth.perMonth)}</div><div className="text-xs text-muted">added per month</div></div>
            </div>
            <p className="mt-3 text-xs text-muted">
              {monthsLeft != null ? (monthsLeft > 120 ? "At this rate the database disk lasts for years." : `At this rate the database disk is full in about ${Math.max(1, Math.round(monthsLeft))} month${Math.round(monthsLeft) === 1 ? "" : "s"}.`)
                : `${d.growth.total} investigations kept${d.growth.since ? ` since ${new Date(d.growth.since).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : ""}.`}
            </p>
          </Block>
        </div>
      )}
    </section>
  );
}
