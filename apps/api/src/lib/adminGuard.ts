import "server-only";
import { sessionUser } from "./auth";

/** The signed-in admin, or a 403 response to return. */
export async function requireAdmin(req: Request) {
  const u = await sessionUser(req);
  if (!u?.isAdmin) return { error: Response.json({ error: "Admins only" }, { status: 403 }) } as const;
  return { user: u } as const;
}
