import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { ROOT, getAccounts } from "@/lib/config";
import { q } from "@/lib/db";
import { apiError } from "@/lib/apiError";
import { sessionUser } from "@/lib/auth";
import { requireAdmin } from "@/lib/adminGuard";

/** Knowledge page data: pending proposals + per-account learnings / saved queries / resolved cases. */
/** Admins only (members don't see knowledge or proposals). */
export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if (g.error) return g.error;
  try {
    const [pending, stats] = await Promise.all([
      q<{ id: number; account_slug: string; file: string; rationale: string; ticket_display: string; source: string }>(
        `SELECT p.id, p.account_slug, p.file, p.rationale, p.source, i.ticket_display
           FROM knowledge_proposals p LEFT JOIN investigations i ON i.id = p.investigation_id
          WHERE p.status = 'pending' ORDER BY p.id DESC LIMIT 100`),
      q<{ account_slug: string; cases: string }>(
        `SELECT i.account_slug, count(DISTINCT c.id) AS cases
           FROM investigations i LEFT JOIN cases c ON c.investigation_id = i.id GROUP BY 1`),
    ]);
    const byAcc = Object.fromEntries(stats.map((s) => [s.account_slug, s]));
    const accounts = getAccounts().map((a) => {
      const dir = path.join(ROOT, a.knowledge_dir);
      // Learnings = knowledge proposals a person accepted into this account's files (each is stamped "proposal #…").
      const learnings = existsSync(dir)
        ? readdirSync(dir, { recursive: true }).map(String).filter((f) => /\.(md|sql)$/.test(f))
            .reduce((n, f) => n + (readFileSync(path.join(dir, f), "utf8").match(/proposal #\d+/g)?.length ?? 0), 0)
        : 0;
      const queries = existsSync(path.join(dir, "queries")) ? readdirSync(path.join(dir, "queries")).filter((f) => f.endsWith(".sql")).length : 0;
      return {
        slug: a.slug, name: a.name, status: a.status, last_ticket: a.last_ticket ?? null, client_active_changed: a.client_active_changed ?? null,
        learnings, queries, cases: Number(byAcc[a.slug]?.cases ?? 0), clientActive: a.client_active !== false,
      };
    });
    const isAdmin = !!(await sessionUser(req))?.isAdmin; // members never see proposals
    return Response.json({ pending: isAdmin ? pending : [], isAdmin, accounts });
  } catch (e) {
    return apiError(e);
  }
}
