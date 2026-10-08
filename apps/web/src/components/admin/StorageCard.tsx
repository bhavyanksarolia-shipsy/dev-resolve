"use client";
import { useCallback, useEffect, useState } from "react";
import { toast } from "@/components/Dialog";
import { btn, btnPrimary, Field, input, post } from "./ui";
import { Block } from "./ServiceCard";

interface Storage {
  db: { bytes: number; limitBytes: number | null; limitGb: number | null };
  parts: { key: string; label: string; bytes: number; rows: number | null }[];
  growth: { last30: number; total: number; since: string | null; perInvestigation: number; perMonth: number };
  disk: { path: string; total: number; free: number } | null;
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
    const r = await post<{ message?: string }>("/api/admin/storage", { dbLimitGb: limit });
    setBusy(false);
    toast({ ok: !r.error, text: r.error || r.message || "Saved" });
    if (!r.error) { setEdit(false); void load(); }
  };
  if (d === undefined) return <div className="skeleton h-48 w-full rounded-2xl" />;
  if (!d) return <div className="card p-5 text-sm text-bad">Couldn&apos;t load the storage figures.</div>;

  const dbPct = d.db.limitBytes ? pct(d.db.bytes, d.db.limitBytes) : null;
  const diskUsed = d.disk ? d.disk.total - d.disk.free : 0;
  const diskPct = d.disk ? pct(diskUsed, d.disk.total) : null;
  const worst = Math.max(dbPct ?? 0, diskPct ?? 0);
  const monthsLeft = d.db.limitBytes && d.growth.perMonth > 0 ? (d.db.limitBytes - d.db.bytes) / d.growth.perMonth : null;
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
          <button className={btnPrimary} onClick={() => { setLimit(d.db.limitGb ? String(d.db.limitGb) : ""); setEdit((e) => !e); }}>{edit ? "Close" : "Edit"}</button>
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
          <Block title="Database disk" hint="The database can't see its own disk's size — enter your plan's database disk size to see how full it is (Railway: the Postgres service's volume)">
            <Field label="Disk size (GB)">
              <input className={`${input} w-32`} inputMode="decimal" value={limit} placeholder="e.g. 5" onChange={(e) => setLimit(e.target.value.replace(/[^\d.]/g, ""))} />
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
            <div className="mb-3 text-xs text-muted">investigations, RCAs, files, settings, knowledge and sign-ins</div>
            {d.db.limitBytes ? <Bar used={d.db.bytes} total={d.db.limitBytes} />
              : <p className="text-xs text-muted">Set the database disk size under <b>Edit</b> to see how full it is.</p>}
          </Block>
          <Block title="Server disk">
            {d.disk ? <>
              <div className="text-2xl font-semibold tabular-nums">{size(diskUsed)}</div>
              <div className="mb-3 text-xs text-muted">code copies, the agent&apos;s saved conversations{d.sessions ? ` (${d.sessions.files} · ${size(d.sessions.bytes)})` : ""}, logs</div>
              <Bar used={diskUsed} total={d.disk.total} />
            </> : <p className="text-sm text-muted">Not available on this server.</p>}
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
