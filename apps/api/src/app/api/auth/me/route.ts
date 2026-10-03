import { sessionUser } from "@/lib/auth";
import { connectorMode } from "@/lib/connector";
import { q } from "@/lib/db";

/** Who is signed in (for the UI's top bar). 401 when nobody is. */
export async function GET(req: Request) {
  const u = await sessionUser(req).catch(() => null);
  if (!u) return Response.json({ error: "Sign in required" }, { status: 401 });
  const [row] = await q<{ pods: string[] }>(`SELECT pods FROM app_users WHERE name=$1`, [u.name]).catch(() => []);
  return Response.json({ user: u.name, isAdmin: u.isAdmin, connectorMode: connectorMode(), pods: row?.pods ?? [] });
}
