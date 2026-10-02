import { testConnection, type ConnectionInput } from "@/lib/adminConfig";
import { requireAdmin } from "@/lib/adminGuard";

/** Try a connection before saving it (VPN-only hosts are tried through the admin's own Chrome extension). */
export async function POST(req: Request) {
  const g = await requireAdmin(req);
  if (g.error) return g.error;
  const b = (await req.json().catch(() => ({}))) as ConnectionInput & { existing?: string };
  return Response.json(await testConnection(b, g.user.name));
}
