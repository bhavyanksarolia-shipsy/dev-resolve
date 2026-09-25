"use client";
import { useCallback, useEffect, useState } from "react";

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
export function HealthBanner({ account }: { account?: string }) {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [loading, setLoading] = useState(false);
  const fetchChecks = useCallback(
    () => fetch(`/api/health${account ? `?account=${account}` : ""}`, { cache: "no-store" }).then((r) => r.json()).then((d) => d.checks as Check[]),
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
      setChecks(await fetchChecks());
    } finally {
      setLoading(false);
    }
  };

  if (!checks) return <div className="mb-4 text-sm text-muted">Checking connections…</div>;
  const bad = checks.filter((c) => c.status !== "ok");
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
