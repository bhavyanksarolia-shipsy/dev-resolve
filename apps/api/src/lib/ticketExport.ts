import "server-only";
import { linkedIssues, getTicket } from "./devrev";
import * as XLSX from "xlsx";

/** The ticket fields the export needs, already present wherever a ticket list is shown (the Tickets page's own
 * `view`, or a scope freshly fetched from DevRev) — nothing here requires a second lookup. */
export interface ExportTicket {
  id: string; display_id: string; title: string; created_date: string;
  stage?: string | null; account?: string | null; pod?: string | null; owner?: string | null;
}

export const EXPORT_HEADERS = [
  "Client", "Pod", "Ticket ID", "Ticket Title", "Ticket Creation Date", "Ticket Status", "Ticket Assigned To", "Age of Ticket (days)",
  "Issue ID", "Issue Title", "Issue Creation Date", "Issue Status", "Issue Assigned To", "Age of Issue (days)",
];
const COLUMN_WIDTHS = [22, 16, 12, 45, 20, 22, 20, 12, 12, 45, 20, 22, 20, 12];

function ageDays(created?: string | null) {
  if (!created) return null;
  return Math.round(((Date.now() - new Date(created).getTime()) / 86400000) * 10) / 10;
}

/** One row per (ticket, issue) pair — a ticket with no linked issues still gets one row, issue columns blank. Issues
 * are fetched a handful of tickets at a time (not all at once, not one at a time) to keep this reasonably fast
 * without hammering DevRev. */
export async function buildExportRows(tickets: ExportTicket[], concurrency = 6): Promise<(string | number | null)[][]> {
  const rows: (string | number | null)[][] = [];
  for (let i = 0; i < tickets.length; i += concurrency) {
    const batch = tickets.slice(i, i + concurrency);
    const batchRows = await Promise.all(batch.map(async (t) => {
      const client = t.account || "";
      const pod = t.pod || "";
      const stage = t.stage || "";
      const owner = t.owner || "Unassigned";
      const tAge = ageDays(t.created_date);
      let issues: Awaited<ReturnType<typeof linkedIssues>> = [];
      try { issues = await linkedIssues(t.id); } catch { /* no linked issues, or the lookup failed -- ticket still gets its own row */ }
      if (!issues.length) {
        return [[client, pod, t.display_id, t.title, t.created_date, stage, owner, tAge, "", "", "", "", "", ""]];
      }
      return Promise.all(issues.map(async (iss) => {
        let issCreated: string | null = null;
        try { issCreated = (await getTicket(iss.id)).created_date; } catch { /* leave blank */ }
        return [client, pod, t.display_id, t.title, t.created_date, stage, owner, tAge, iss.display_id, iss.title, issCreated, iss.stage ?? "", iss.owner ?? "Unassigned", ageDays(issCreated)] as (string | number | null)[];
      }));
    }));
    for (const r of batchRows) rows.push(...r);
  }
  return rows;
}

export function buildWorkbook(rows: (string | number | null)[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([EXPORT_HEADERS, ...rows]);
  ws["!cols"] = COLUMN_WIDTHS.map((wch) => ({ wch }));
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Tickets + Issues");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
