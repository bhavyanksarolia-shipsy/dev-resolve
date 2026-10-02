import { q } from "@/lib/db";

/** Liveness/readiness for the load balancer / container runtime — no login, no details, no external calls. */
export async function GET() {
  try {
    await q("SELECT 1");
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
