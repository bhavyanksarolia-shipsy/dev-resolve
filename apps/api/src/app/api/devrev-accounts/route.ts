import { sessionUser } from "@/lib/auth";
import { getAccounts } from "@/lib/config";
import { searchAccounts } from "@/lib/devrev";
import { apiError } from "@/lib/apiError";

/** Search DevRev accounts by name (any signed-in person — e.g. to move a ticket to the right account). */
export async function GET(req: Request) {
  if (!(await sessionUser(req))) return Response.json({ error: "Sign in required" }, { status: 401 });
  const query = new URL(req.url).searchParams.get("q")?.trim() || "";
  if (query.length < 2) return Response.json({ results: [] });
  try {
    const client = new Map(getAccounts().flatMap((a) => a.devrev.account_ids.map((id) => [id, a.name] as const)));
    const results = (await searchAccounts(query)).map((a) => ({ id: a.id, name: a.display_name, client: client.get(a.id) ?? null }));
    return Response.json({ results });
  } catch (e) {
    return apiError(e);
  }
}
