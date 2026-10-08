import { getTicket, linkedIssues } from "@/lib/devrev";
import { apiError } from "@/lib/apiError";

/** The issues linked to a ticket (ticket row dropdown — asked only when it's opened). [id] = TKT-123 or the full id. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const don = id.startsWith("don:") ? id : (await getTicket(id)).id;
    return Response.json({ issues: await linkedIssues(don) });
  } catch (e) {
    return apiError(e);
  }
}
