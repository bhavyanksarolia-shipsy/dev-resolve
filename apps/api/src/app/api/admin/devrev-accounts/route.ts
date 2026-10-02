import { requireAdmin } from "@/lib/adminGuard";
import { getAccounts } from "@/lib/config";
import { searchAccounts } from "@/lib/devrev";
import { apiError } from "@/lib/apiError";

/** Search DevRev accounts by name; marks the ones already used by a client. */
export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if (g.error) return g.error;
  const query = new URL(req.url).searchParams.get("q")?.trim() || "";
  if (query.length < 2) return Response.json({ results: [] });
  try {
    const owner = new Map(getAccounts().flatMap((a) => a.devrev.account_ids.map((id) => [id, a.name] as const)));
    const results = (await searchAccounts(query)).map((a) => ({ id: a.id, name: a.display_name, usedBy: owner.get(a.id) ?? null }));
    return Response.json({ results });
  } catch (e) {
    return apiError(e);
  }
}
