/**
 * Export every open WMS support ticket (+ its linked issues, one row per issue) to an .xlsx file.
 *
 * Scope matches the Tickets page exactly: every ticket whose DevRev account maps to an ACTIVE Dev Resolve client
 * (same rule as "can this ticket be investigated"), filtered to the given Pods (default: the WMS pods). Run with
 * `--pods=` (empty) to include every Pod instead.
 *
 * Usage (from apps/api):
 *   railway run npx tsx --conditions=react-server scripts/export_tickets_issues.ts [--pods=WMS,WMS Inbound,WMS Outbound] [--out=path.xlsx]
 *
 * `railway run` injects the real DEVREV_TOKEN so this matches production data; it's never read from a local file
 * or printed. Needs a `railway run`-capable shell (linked to the dev-resolve service).
 */
import { listTickets, linkedIssues, getTicket } from "../src/lib/devrev";
import { ticketScope, inTicketScope, ALL_CLIENTS, accountRole, investigable } from "../src/lib/config";
import * as XLSX from "xlsx";

const DEFAULT_PODS = ["WMS", "WMS Inbound", "WMS Outbound"];

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

function ownerNames(ownedBy?: { full_name?: string; display_name?: string }[]) {
  const names = (ownedBy ?? []).map((o) => o.full_name || o.display_name).filter((n): n is string => !!n && !/^unassigned$/i.test(n));
  return names.length ? names.join(", ") : "Unassigned";
}
function ageDays(created?: string | null) {
  if (!created) return null;
  return Math.round(((Date.now() - new Date(created).getTime()) / 86400000) * 10) / 10;
}

async function main() {
  const podsArg = arg("pods");
  const pods = podsArg === undefined ? DEFAULT_PODS : podsArg.split(",").map((s) => s.trim()).filter(Boolean);
  const outPath = arg("out") || "/tmp/dev_resolve_open_tickets_export.xlsx";

  const scope = ticketScope(ALL_CLIENTS);
  if (!scope) throw new Error("no scope");

  const works: Awaited<ReturnType<typeof listTickets>>["works"] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const r = await listTickets(scope.ids, { limit: 100, cursor });
    works.push(...r.works);
    cursor = r.next_cursor;
    if (!cursor) break;
  }
  const inScope = inTicketScope(works, scope);
  const activeClientTickets = inScope
    .filter((w) => accountRole(w.account?.id).kind === "client")
    .filter((w) => investigable(w.account?.id).ok);
  const tickets = pods.length
    ? activeClientTickets.filter((w) => typeof w.custom_fields?.tnt__pod === "string" && pods.includes(w.custom_fields.tnt__pod as string))
    : activeClientTickets;

  console.error(`org-wide: ${works.length} -> active-client: ${activeClientTickets.length} -> pod-filtered (${pods.join("/") || "all"}): ${tickets.length}`);

  const headers = [
    "Client", "Pod", "Ticket ID", "Ticket Title", "Ticket Creation Date", "Ticket Status", "Ticket Assigned To", "Age of Ticket (days)",
    "Issue ID", "Issue Title", "Issue Creation Date", "Issue Status", "Issue Assigned To", "Age of Issue (days)",
  ];
  const rows: (string | number | null)[][] = [headers];

  for (let i = 0; i < tickets.length; i++) {
    const t = tickets[i] as typeof tickets[number] & { stage?: { name?: string; display_name?: string }; owned_by?: { full_name?: string; display_name?: string }[] };
    console.error(`[${i + 1}/${tickets.length}] ${t.display_id} - fetching issues...`);
    const client = t.account?.display_name || "";
    const stage = t.stage?.display_name || t.stage?.name || "";
    const owner = ownerNames(t.owned_by);
    const tAge = ageDays(t.created_date);
    const pod = typeof t.custom_fields?.tnt__pod === "string" ? (t.custom_fields.tnt__pod as string) : "";
    let issues: Awaited<ReturnType<typeof linkedIssues>> = [];
    try { issues = await linkedIssues(t.id); } catch { /* no linked issues, or the lookup failed -- ticket still gets its own row */ }
    if (!issues.length) {
      rows.push([client, pod, t.display_id, t.title, t.created_date, stage, owner, tAge, "", "", "", "", "", ""]);
    } else {
      for (const iss of issues) {
        let issCreated: string | null = null;
        try { issCreated = (await getTicket(iss.id)).created_date; } catch { /* leave blank */ }
        rows.push([client, pod, t.display_id, t.title, t.created_date, stage, owner, tAge, iss.display_id, iss.title, issCreated, iss.stage ?? "", iss.owner ?? "Unassigned", ageDays(issCreated)]);
      }
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [22, 16, 12, 45, 20, 22, 20, 12, 12, 45, 20, 22, 20, 12].map((wch) => ({ wch }));
  ws["!freeze"] = { xSplit: 0, ySplit: 1 };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Tickets + Issues");
  XLSX.writeFile(wb, outPath);
  console.error(`Saved ${outPath} -- ${tickets.length} tickets, ${rows.length - 1} rows`);
}

main().catch((e) => { console.error(e); process.exit(1); });
