import { saveAccount, type AccountInput } from "@/lib/adminConfig";
import { requireAdmin } from "@/lib/adminGuard";

/** Create (originalSlug null) or update a client. */
export async function POST(req: Request) {
  const g = await requireAdmin(req);
  if (g.error) return g.error;
  const b = (await req.json().catch(() => ({}))) as { originalSlug?: string | null; account?: AccountInput };
  if (!b.account) return Response.json({ error: "account required" }, { status: 400 });
  try {
    const a = await saveAccount(b.account, b.originalSlug ?? null, g.user.name);
    return Response.json({ ok: true, slug: a.slug, status: a.status, message: `${a.name} saved${a.status === "active" ? "" : " — add a logs or database connection to make it active"}` });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
