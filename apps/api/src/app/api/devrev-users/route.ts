import { devUsers } from "@/lib/devrev";
import { sessionUser } from "@/lib/auth";
import { apiError } from "@/lib/apiError";
import { q } from "@/lib/db";

/** Active DevRev users (for assigning tickets) and which one is the signed-in person (matched by email). */
export async function GET(req: Request) {
  try {
    const [users, viewer] = await Promise.all([devUsers(), sessionUser(req)]);
    const [acct] = viewer ? await q<{ email: string | null }>(`SELECT email FROM app_users WHERE name=$1`, [viewer.name]) : [];
    const me = users.find((u) => acct?.email && u.email?.toLowerCase() === acct.email.toLowerCase())?.id ?? null;
    return Response.json({ users, me }, { headers: { "Cache-Control": "private, max-age=600" } });
  } catch (e) {
    return apiError(e);
  }
}
