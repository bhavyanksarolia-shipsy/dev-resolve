import { adminConfig } from "@/lib/adminConfig";
import { requireAdmin } from "@/lib/adminGuard";

/** Clients + connections for the admin screens (secrets reported as set / not set only). */
export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if (g.error) return g.error;
  return Response.json(adminConfig());
}
