"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { fileLabel, hidePaths, scopeLabel } from "@/components/labels";

interface Data {
  pending: { id: number; account_slug: string; file: string; rationale: string; ticket_display: string; source: string }[];
  accounts: { slug: string; name: string; status: string; last_ticket: string | null; client_active_changed: { by: string; at: string } | null;
    learnings: number; queries: number; cases: number; clientActive: boolean }[];
}

export default function KnowledgePage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    fetch("/api/knowledge", { cache: "no-store" }).then(async (r) => {
      const d = await r.json();
      if (r.ok) setData(d); else setError(d.error || `HTTP ${r.status}`);
    }).catch((e) => setError(String(e)));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error) return <p className="text-sm text-bad">{error}</p>;
  if (!data) return <div className="space-y-3"><div className="skeleton h-8 w-64" /><div className="skeleton h-64 w-full rounded-xl" /></div>;
  const { pending } = data;
  const rows = data.accounts;

  return (
    <div className="space-y-8">
      <section>
        <h1 className="mb-2 text-xl font-semibold">Pending proposals ({pending.length})</h1>
        {!pending.length && <p className="text-sm text-muted">Nothing to review.</p>}
        <ul className="space-y-1 text-sm">
          {pending.map((p) => (
            <li key={p.id}>
              <Link className="font-mono text-accent" href={`/tickets/${p.ticket_display}`}>{p.ticket_display}</Link>{" "}
              <span className="rounded-md bg-accent-soft px-2 py-0.5 text-xs font-semibold text-accent-strong">{fileLabel(p.file)}</span>{" "}
              <span className="text-xs text-muted">{scopeLabel(p.account_slug)}</span> <span className="text-muted">— {hidePaths(p.rationale)}</span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="mb-1 font-semibold">Knowledge per account</h2>
        <p className="mb-3 text-xs text-muted">
          {rows.filter((r) => r.clientActive).length} active clients · {rows.filter((r) => !r.clientActive).length} inactive (greyed out) — switch clients on/off in Admin → Clients.
        </p>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-head text-left text-xs font-semibold uppercase tracking-wide text-head-fg">
              <tr><th className="px-4 py-3">Account</th><th className="px-4 py-3">Connections</th><th className="px-4 py-3">Last WMS ticket</th><th className="px-4 py-3 text-right">Learnings</th><th className="px-4 py-3 text-right">Saved queries</th><th className="px-4 py-3 text-right">Resolved cases</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.slug} className={`border-b border-line last:border-0 ${r.clientActive ? "" : "bg-bg text-muted"}`}>
                  <td className="px-4 py-2.5 font-medium">{r.name}</td>
                  <td className={`px-4 py-2.5 ${r.status === "active" ? "text-ok" : "text-muted"}`}>{r.status === "active" ? "connected" : r.status.replace("_", " ")}</td>
                  <td className="px-4 py-2.5 tabular-nums text-muted">{r.last_ticket ? new Date(r.last_ticket).toLocaleDateString("en-IN", { dateStyle: "medium" }) : "—"}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.learnings}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.queries}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.cases}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
