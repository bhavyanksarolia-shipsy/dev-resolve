import Link from "next/link";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { ROOT, getAccounts } from "@/lib/config";
import { q } from "@/lib/db";
import { fileLabel, hidePaths, scopeLabel } from "@/components/labels";
import { ClientActiveToggle } from "@/components/ClientActiveToggle";
import { readFileSync } from "node:fs";

export const dynamic = "force-dynamic";

export default async function KnowledgePage() {
  const [pending, stats] = await Promise.all([
    q<{ id: number; account_slug: string; file: string; rationale: string; ticket_display: string; source: string }>(
      `SELECT p.id, p.account_slug, p.file, p.rationale, p.source, i.ticket_display
         FROM knowledge_proposals p LEFT JOIN investigations i ON i.id = p.investigation_id
        WHERE p.status = 'pending' ORDER BY p.id DESC LIMIT 100`),
    q<{ account_slug: string; cases: string; posted: string }>(
      `SELECT i.account_slug, count(DISTINCT c.id) AS cases, count(DISTINCT i.id) FILTER (WHERE i.status='posted') AS posted
         FROM investigations i LEFT JOIN cases c ON c.investigation_id = i.id GROUP BY 1`),
  ]);
  const byAcc = Object.fromEntries(stats.map((s) => [s.account_slug, s]));
  const rows = getAccounts().map((a) => {
    const dir = path.join(ROOT, a.knowledge_dir);
    // Learnings = knowledge proposals a person accepted into this account's files (each is stamped "proposal #…").
    const learnings = existsSync(dir)
      ? readdirSync(dir, { recursive: true }).map(String).filter((f) => /\.(md|sql)$/.test(f))
          .reduce((n, f) => n + (readFileSync(path.join(dir, f), "utf8").match(/proposal #\d+/g)?.length ?? 0), 0)
      : 0;
    const queries = existsSync(path.join(dir, "queries")) ? readdirSync(path.join(dir, "queries")).filter((f) => f.endsWith(".sql")).length : 0;
    return { ...a, learnings, queries, cases: Number(byAcc[a.slug]?.cases ?? 0), clientActive: a.client_active !== false };
  });

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
          {rows.filter((r) => r.clientActive).length} active clients · {rows.filter((r) => !r.clientActive).length} inactive ·
          switch a client off when they&apos;re no longer with us — it moves to &ldquo;Inactive clients&rdquo; in the account picker; nothing is deleted.
        </p>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-head text-left text-xs font-semibold uppercase tracking-wide text-head-fg">
              <tr><th className="px-4 py-3">Account</th><th className="px-4 py-3">Client</th><th className="px-4 py-3">Connections</th><th className="px-4 py-3">Last WMS ticket</th><th className="px-4 py-3 text-right">Learnings</th><th className="px-4 py-3 text-right">Saved queries</th><th className="px-4 py-3 text-right">Resolved cases</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.slug} className={`border-b border-line last:border-0 ${r.clientActive ? "" : "bg-bg text-muted"}`}>
                  <td className="px-4 py-2.5 font-medium">{r.name}</td>
                  <td className="px-4 py-2.5"><ClientActiveToggle slug={r.slug} name={r.name} initial={r.clientActive} changed={r.client_active_changed} /></td>
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
