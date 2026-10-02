import { saveConnection, type ConnectionInput } from "@/lib/adminConfig";
import { requireAdmin } from "@/lib/adminGuard";

/** Create (originalName null) or update an OpenSearch / Metabase connection. Empty secret fields keep what's stored. */
export async function POST(req: Request) {
  const g = await requireAdmin(req);
  if (g.error) return g.error;
  const b = (await req.json().catch(() => ({}))) as { originalName?: string | null; connection?: ConnectionInput };
  if (!b.connection) return Response.json({ error: "connection required" }, { status: 400 });
  try {
    const name = await saveConnection(b.connection, b.originalName ?? null, g.user.name);
    return Response.json({ ok: true, name, message: `Connection "${name}" saved` });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
