import { getTicket, partChoices, podValues, stageMoves, warmAccounts } from "@/lib/devrev";
import { apiError } from "@/lib/apiError";

/** What a ticket can be changed to: the stages it may move to from its current one, and the allowed Pod values. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("ticket");
  if (!id) return Response.json({ error: "ticket is required" }, { status: 400 });
  try {
    warmAccounts(); // for the Account pill's search
    const t = await getTicket(id);
    const [stages, pods, parts] = await Promise.all([stageMoves(t.subtype, t.stage?.stage?.id), podValues(t), partChoices()]);
    const part = (t as { applies_to_part?: { id: string; name?: string } }).applies_to_part;
    return Response.json({ stage: { id: t.stage?.stage?.id ?? null, name: t.stage?.name ?? null }, pod: typeof t.custom_fields?.tnt__pod === "string" ? t.custom_fields.tnt__pod : null,
      part: part ? { id: part.id, name: part.name ?? "" } : null, stages, pods, parts,
      account: t.account?.id ? { id: t.account.id, name: t.account.display_name ?? "" } : null });
  } catch (e) {
    return apiError(e);
  }
}
