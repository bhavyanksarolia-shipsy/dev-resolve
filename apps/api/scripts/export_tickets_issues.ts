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
 *
 * The actual row/workbook building (and the in-app "Download Excel" button on the Tickets page) share the same
 * logic — see apps/api/src/lib/ticketExport.ts. This script is just a different way of assembling the ticket list
 * (DevRev query + scope rules, for when there's no browser session to read it from).
 */
import { listTickets } from "../src/lib/devrev";
import { ticketScope, inTicketScope, ALL_CLIENTS, accountRole, investigable } from "../src/lib/config";
import { buildExportRows, buildWorkbook, type ExportTicket } from "../src/lib/ticketExport";
import { writeFileSync } from "node:fs";

const DEFAULT_PODS = ["WMS", "WMS Inbound", "WMS Outbound"];

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
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
  const scoped = pods.length
    ? activeClientTickets.filter((w) => typeof w.custom_fields?.tnt__pod === "string" && pods.includes(w.custom_fields.tnt__pod as string))
    : activeClientTickets;

  console.error(`org-wide: ${works.length} -> active-client: ${activeClientTickets.length} -> pod-filtered (${pods.join("/") || "all"}): ${scoped.length}`);

  const tickets: ExportTicket[] = scoped.map((w) => {
    const t = w as typeof w & { stage?: { name?: string; display_name?: string }; owned_by?: { full_name?: string; display_name?: string }[] };
    const owners = (t.owned_by ?? []).map((o) => o.full_name || o.display_name).filter((n): n is string => !!n && !/^unassigned$/i.test(n));
    return {
      id: t.id, display_id: t.display_id, title: t.title, created_date: t.created_date,
      stage: t.stage?.display_name || t.stage?.name || "",
      account: t.account?.display_name || "",
      pod: typeof t.custom_fields?.tnt__pod === "string" ? (t.custom_fields.tnt__pod as string) : "",
      owner: owners.length ? owners.join(", ") : "Unassigned",
    };
  });

  console.error(`Fetching linked issues for ${tickets.length} tickets...`);
  const rows = await buildExportRows(tickets);
  const buffer = buildWorkbook(rows);
  writeFileSync(outPath, buffer);
  console.error(`Saved ${outPath} -- ${tickets.length} tickets, ${rows.length} rows`);
}

main().catch((e) => { console.error(e); process.exit(1); });
