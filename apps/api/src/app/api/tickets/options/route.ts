import { getTicket, podValues, stageMoves } from "@/lib/devrev";
import { apiError } from "@/lib/apiError";

/** What a ticket can be changed to: the stages it may move to from its current one, and the allowed Pod values. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("ticket");
  if (!id) return Response.json({ error: "ticket is required" }, { status: 400 });
  try {
    const t = await getTicket(id);
    const [stages, pods] = await Promise.all([stageMoves(t.subtype, t.stage?.stage?.id), podValues(t)]);
    return Response.json({ stage: { id: t.stage?.stage?.id ?? null, name: t.stage?.name ?? null }, pod: typeof t.custom_fields?.tnt__pod === "string" ? t.custom_fields.tnt__pod : null, stages, pods });
  } catch (e) {
    return apiError(e);
  }
}
