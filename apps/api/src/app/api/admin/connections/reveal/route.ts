import { revealSecret } from "@/lib/adminConfig";
import { requireAdmin } from "@/lib/adminGuard";

/** Show a connection's saved username / password / API key to an admin (the eye button); every reveal is logged. */
export async function POST(req: Request) {
  const g = await requireAdmin(req);
  if (g.error) return g.error;
  const b = (await req.json().catch(() => ({}))) as { name?: string; kind?: "opensearch" | "metabase"; field?: "username" | "password" | "apiKey" };
  if (!b.name || !b.kind || !b.field || !["username", "password", "apiKey"].includes(b.field)) return Response.json({ error: "name, kind and field required" }, { status: 400 });
  const value = revealSecret(b.name, b.kind, b.field);
  if (b.field !== "username") console.log(`[admin] ${g.user.name} revealed the ${b.field} of ${b.kind} connection ${b.name}`);
  return Response.json({ value });
}
