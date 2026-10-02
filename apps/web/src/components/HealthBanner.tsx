"use client";
import { useCallback, useEffect, useRef, useState } from "react";

interface Check {
  id: string; label: string; host?: string; status: string; message: string; fix?: string; used_by: string[];
}

const TITLE: Record<string, string> = {
  vpn_required: "Connect VPN",
  auth_failed: "Fix credentials",
  not_configured: "Not configured",
  error: "Connection error",
};

/** One row per failing connection, naming exactly which one failed and how to fix it. */
export function HealthBanner({ account, compact }: { account?: string; compact?: boolean }) {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [paused, setPaused] = useState(false);
  const fetchChecks = useCallback(
    (force = false) => fetch(`/api/health?${new URLSearchParams({ ...(account && { account }), ...(force && { refresh: "1" }) })}`, { cache: "no-store" })
      .then((r) => r.json()).then((d) => { setPaused(!!d.inactive); return d.checks as Check[]; }),
    [account],
  );
  useEffect(() => {
    let live = true;
    fetchChecks().then((c) => live && setChecks(c));
    return () => { live = false; };
  }, [fetchChecks]);
  // While something is failing (e.g. VPN still connecting), re-check on our own instead of waiting for a click.
  const failing = !!checks?.some((c) => c.status === "vpn_required" || c.status === "error" || c.status === "auth_failed");
  useEffect(() => {
    if (!failing) return;
    const t = setInterval(() => { fetchChecks().then(setChecks).catch(() => {}); }, 15000);
    return () => clearInterval(t);
  }, [failing, fetchChecks]);
  const load = async () => {
    setLoading(true);
    try {
      setChecks(await fetchChecks(true));
    } finally {
      setLoading(false);
    }
  };

  if (!checks) return <div className="mb-4 text-sm text-muted">Checking connections…</div>;
  if (paused) return <div className="mb-4 text-xs text-muted">Connection checks paused — this client is marked inactive.</div>;
  const bad = checks.filter((c) => c.status !== "ok");
  // Compact: one quiet line while everything works; click it for a tidy list (no hosts or session details).
  if (compact && !bad.length) return <CompactStatus checks={checks} loading={loading} onRecheck={load} />;
  return (
    <div className="mb-5">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {checks.map((c) => (
          <span key={c.id} title={`${c.host ?? ""} — ${c.message}`}
            className={`rounded-full border px-2 py-0.5 ${c.status === "ok" ? "border-ok/40 text-ok" : c.status === "not_configured" ? "border-warn/50 bg-warn/5 text-warn" : "border-bad/50 text-bad"}`}>
            {c.status === "ok" ? "●" : c.status === "not_configured" ? "◐" : "○"} {c.label}{c.status === "not_configured" ? " · not configured" : ""}
          </span>
        ))}
        <button onClick={load} disabled={loading} className="ml-1 text-accent underline-offset-2 hover:underline disabled:opacity-50">
          {loading ? "checking…" : failing ? "re-check (auto every 15s)" : "re-check"}
        </button>
      </div>
      {bad.filter((c) => c.status !== "not_configured").map((c) => (
        <div key={c.id} className="mt-2 rounded-md border border-bad/40 bg-bad/5 px-3 py-2 text-sm">
          <b className="text-bad">{TITLE[c.status] ?? c.status}: {c.label}</b>
          {c.host && <span className="text-muted"> · {c.host}</span>}
          <div className="text-muted">{c.message}{c.used_by.length ? ` · affects ${c.used_by.join(", ")}` : ""}</div>
          {c.fix && <div className="mt-1 font-mono text-xs">{c.fix}</div>}
        </div>
      ))}
    </div>
  );
}

function CompactStatus({ checks, loading, onRecheck }: { checks: Check[]; loading: boolean; onRecheck: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  return (
    <div ref={box} className="relative mb-4 flex items-center gap-2 text-xs text-muted">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex items-center gap-2 hover:text-fg">
        <span className="h-2 w-2 rounded-full bg-ok" aria-hidden />All connections OK
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden><path d={open ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} /></svg>
      </button>
      <button onClick={onRecheck} disabled={loading} className="text-accent-strong hover:underline disabled:opacity-50">{loading ? "checking…" : "re-check"}</button>
      {open && (
        <ul className="absolute left-0 top-6 z-40 w-96 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-panel py-2 text-sm text-fg shadow-xl">
          {checks.map((c) => (
            <li key={c.id} className="flex items-center gap-2.5 px-3 py-1">
              <span className={`h-2 w-2 shrink-0 rounded-full ${c.status === "ok" ? "bg-ok" : c.status === "not_configured" ? "bg-warn" : "bg-bad"}`} aria-hidden />
              <span className="min-w-0 flex-1 truncate">{c.label}</span>
              <span className="text-xs text-muted">{c.status === "ok" ? "connected" : c.status === "not_configured" ? "not set up" : "down"}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
