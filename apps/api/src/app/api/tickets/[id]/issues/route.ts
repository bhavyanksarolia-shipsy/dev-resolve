import { getTicket, linkedIssues } from "@/lib/devrev";
import { apiError } from "@/lib/apiError";

/** The issues linked to a ticket (ticket row dropdown — asked, live, every time it's opened). [id] = TKT-123 or the full id. */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const don = id.startsWith("don:") ? id : (await getTicket(id)).id;
    const force = new URL(req.url).searchParams.get("refresh") === "1";
    return Response.json({ issues: await linkedIssues(don, { force }) });
  } catch (e) {
    return apiError(e);
  }
}
