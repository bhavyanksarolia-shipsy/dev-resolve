import { buildExportRows, buildWorkbook, type ExportTicket } from "@/lib/ticketExport";

const MAX_ROWS = 300;

/** Export exactly the tickets the caller gives us (the Tickets page's own, already-filtered `view`) plus each
 * ticket's linked issues, one row per issue. No re-scoping here on purpose: the browser already computed the right
 * set under whatever account/Pod/column filters are active, so the download always matches what's on screen. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { tickets?: ExportTicket[] } | null;
  const tickets = body?.tickets;
  if (!Array.isArray(tickets) || !tickets.length) return Response.json({ error: "No tickets to export — clear or narrow the filters first." }, { status: 400 });
  if (tickets.length > MAX_ROWS) return Response.json({ error: `That's ${tickets.length} tickets — narrow the filters to ${MAX_ROWS} or fewer and try again.` }, { status: 400 });
  if (tickets.some((t) => !t || typeof t.id !== "string" || typeof t.display_id !== "string")) {
    return Response.json({ error: "Malformed ticket list" }, { status: 400 });
  }

  const rows = await buildExportRows(tickets);
  const buffer = buildWorkbook(rows);
  const date = new Date().toISOString().slice(0, 10);
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="dev-resolve-tickets-${date}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
