import Link from "next/link";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { ROOT, getAccounts } from "@/lib/config";
import { q } from "@/lib/db";
import { fileLabel, hidePaths, scopeLabel } from "@/components/labels";

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
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".md")).length : 0;
    const queries = existsSync(path.join(dir, "queries")) ? readdirSync(path.join(dir, "queries")).filter((f) => f.endsWith(".sql")).length : 0;
    return { ...a, files, queries, cases: Number(byAcc[a.slug]?.cases ?? 0) };
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
        <h2 className="mb-2 font-semibold">Knowledge per account</h2>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-head text-left text-xs font-semibold uppercase tracking-wide text-head-fg">
              <tr><th className="px-4 py-3">Account</th><th className="px-4 py-3">Connections</th><th className="px-4 py-3 text-right">Playbook files</th><th className="px-4 py-3 text-right">Saved queries</th><th className="px-4 py-3 text-right">Resolved cases</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.slug} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">{r.name}</td>
                  <td className={`px-4 py-2.5 ${r.status === "active" ? "text-ok" : "text-muted"}`}>{r.status.replace("_", " ")}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{r.files}</td>
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
