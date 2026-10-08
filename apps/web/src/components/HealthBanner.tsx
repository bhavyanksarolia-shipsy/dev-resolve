"use client";
import { useCallback, useEffect, useRef, useState } from "react";

interface Check {
  id: string; label: string; host?: string; status: string; message: string; fix?: string; used_by: string[]; restored_at?: string;
}

const TITLE: Record<string, string> = {
  vpn_required: "Connect VPN",
  auth_failed: "Fix credentials",
  not_configured: "Not configured",
  error: "Connection error",
  fallback: "Using the fallback",
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
  const failing = !!checks?.some((c) => c.status === "vpn_required" || c.status === "error" || c.status === "auth_failed" || c.status === "fallback");
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
  const restored = checks.filter((c) => c.status === "ok" && c.restored_at);
  // Compact: one quiet line while everything works; click it for a tidy list (no hosts or session details).
  if (compact) return <><Restored items={restored} /><CompactStatus checks={checks} loading={loading} onRecheck={load} auto={failing} /></>;
  return (
    <div className="mb-5">
      <Restored items={restored} />
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {checks.map((c) => (
          <span key={c.id} title={`${c.host ?? ""} — ${c.message}`}
            className={`rounded-full border px-2 py-0.5 ${c.status === "ok" ? "border-ok/40 text-ok" : c.status === "not_configured" || c.status === "fallback" ? "border-warn/50 bg-warn/5 text-warn" : "border-bad/50 text-bad"}`}>
            {c.status === "ok" ? "●" : c.status === "not_configured" ? "◐" : "○"} {c.label}{c.status === "not_configured" ? " · not configured" : ""}
          </span>
        ))}
        <button onClick={load} disabled={loading} className="ml-1 text-accent underline-offset-2 hover:underline disabled:opacity-50">
          {loading ? "checking…" : failing ? "re-check (auto every 15s)" : "re-check"}
        </button>
      </div>
      {bad.filter((c) => c.status !== "not_configured").map((c) => (
        <div key={c.id} className={`mt-2 rounded-md border px-3 py-2 text-sm ${c.status === "fallback" ? "border-warn/40 bg-warn/5" : "border-bad/40 bg-bad/5"}`}>
          <b className={c.status === "fallback" ? "text-warn" : "text-bad"}>{TITLE[c.status] ?? c.status}: {c.label}</b>
          {c.host && <span className="text-muted"> · {c.host}</span>}
          <div className="text-muted">{c.message}{c.used_by.length ? ` · affects ${c.used_by.join(", ")}` : ""}</div>
          {c.fix && <div className="mt-1 font-mono text-xs">{c.fix}</div>}
        </div>
      ))}
    </div>
  );
}

/** "Claude connection is working fine again" — shown for a while after the main Claude sign-in comes back. */
function Restored({ items }: { items: Check[] }) {
  if (!items.length) return null;
  return (
    <div className="mb-3 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-ok ring-1 ring-emerald-200">
      <span className="h-2 w-2 rounded-full bg-ok" aria-hidden />{items.map((c) => c.message).join(" · ")}
    </div>
  );
}

const GROUP: Record<string, { title: string; tone: string }> = {
  fallback: { title: "Working on the fallback", tone: "text-warn" },
  vpn_required: { title: "Need the Reliance client VPN (AnyConnect)", tone: "text-warn" },
  auth_failed: { title: "Sign-in failed", tone: "text-bad" },
  error: { title: "Not reachable", tone: "text-bad" },
  not_configured: { title: "Not set up", tone: "text-muted" },
};

/** One quiet line ("● 7 OK · 4 need the VPN ▾"); click for a tidy panel grouped by what to do. */
function CompactStatus({ checks, loading, onRecheck, auto }: { checks: Check[]; loading: boolean; onRecheck: () => void; auto?: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const ok = checks.filter((c) => c.status === "ok");
  const groups = (["fallback", "vpn_required", "auth_failed", "error", "not_configured"] as const)
    .map((st) => ({ st, items: checks.filter((c) => c.status === st) })).filter((g) => g.items.length);
  const problems = groups.filter((g) => g.st !== "not_configured").reduce((n, g) => n + g.items.length, 0);
  const summary = groups.filter((g) => g.st !== "not_configured").map((g) =>
    g.st === "fallback" ? `${g.items.map((c) => c.label.split(" (")[0]).join(", ")} on fallback` : g.st === "vpn_required" ? `${g.items.length} need the VPN` : g.st === "auth_failed" ? `${g.items.length} sign-in failed` : `${g.items.length} not reachable`).join(" · ");
  return (
    <div ref={box} className="relative mb-4 flex flex-wrap items-center gap-2 text-xs text-muted">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className={`inline-flex items-center gap-2 rounded-full px-2.5 py-1 transition ${problems ? "bg-amber-50 text-warn ring-1 ring-amber-200 hover:ring-amber-300" : "hover:text-fg"}`}>
        <span className={`h-2 w-2 rounded-full ${problems ? "bg-warn" : "bg-ok"}`} aria-hidden />
        {problems ? <><span className="text-muted">{ok.length} OK ·</span><b className="font-semibold">{summary}</b></> : "All connections OK"}
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden><path d={open ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} /></svg>
      </button>
      <button onClick={onRecheck} disabled={loading} className="text-accent-strong hover:underline disabled:opacity-50">{loading ? "checking…" : auto ? "re-check (auto)" : "re-check"}</button>
      {open && (
        <div className="absolute left-0 top-8 z-40 w-[28rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-line bg-panel text-sm text-fg shadow-xl">
          {groups.map((g) => {
            const fix = g.items.find((c) => c.fix)?.fix;
            return (
              <div key={g.st} className="border-b border-line px-4 py-3 last:border-0">
                <div className={`mb-1.5 text-xs font-semibold uppercase tracking-wide ${GROUP[g.st].tone}`}>{GROUP[g.st].title} · {g.items.length}</div>
                <ul className="space-y-1">
                  {g.items.map((c) => (
                    <li key={c.id} className="flex items-center gap-2" title={c.message}>
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${g.st === "not_configured" ? "bg-line" : g.st === "vpn_required" || g.st === "fallback" ? "bg-warn" : "bg-bad"}`} aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{c.label}</span>
                      {c.used_by.length > 0 && <span className="shrink-0 truncate text-xs text-muted">{c.used_by.slice(0, 2).join(", ")}{c.used_by.length > 2 ? ` +${c.used_by.length - 2}` : ""}</span>}
                    </li>
                  ))}
                </ul>
                {fix && g.st !== "not_configured" && (
                  <p className="mt-2 rounded-lg bg-bg px-3 py-2 text-xs text-muted">
                    {g.st === "fallback" ? g.items.map((c) => c.message).join(" · ") : g.st === "vpn_required" ? <>Connect the Reliance client VPN (Cisco AnyConnect) on your laptop and keep the Dev Resolve extension on (<a href="/connector" className="text-accent-strong underline">Connector</a>). Re-checks run automatically.</> : fix}
                  </p>
                )}
              </div>
            );
          })}
          {ok.length > 0 && (
            <div className="px-4 py-3">
              <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ok">Connected · {ok.length}</div>
              <p className="text-xs text-muted">{ok.map((c) => c.label).join(" · ")}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
