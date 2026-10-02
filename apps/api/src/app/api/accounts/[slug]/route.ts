import { setClientActive } from "@/lib/config";
import { sessionUser } from "@/lib/auth";

/** Toggle whether a client is still active with us (Knowledge page switch). */
export async function POST(req: Request, ctx: RouteContext<"/api/accounts/[slug]">) {
  const { slug } = await ctx.params;
  const { client_active } = (await req.json().catch(() => ({}))) as { client_active?: boolean };
  if (typeof client_active !== "boolean") return Response.json({ error: "client_active (true/false) is required" }, { status: 400 });
  const user = await sessionUser(req);
  if (!user?.isAdmin) return Response.json({ error: "Only an admin can switch clients on/off" }, { status: 403 });
  try {
    const a = setClientActive(slug, client_active, user.name);
    return Response.json({ ok: true, slug, client_active: a.client_active, changed: a.client_active_changed });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 404 });
  }
}
