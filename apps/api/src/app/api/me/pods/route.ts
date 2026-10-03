import { sessionUser } from "@/lib/auth";
import { allPodValues } from "@/lib/devrev";
import { apiError } from "@/lib/apiError";
import { q } from "@/lib/db";

/** The signed-in person's Pod scope (GET: current + all Pod values; POST { pods: [] } = all Pods). */
export async function GET(req: Request) {
  const u = await sessionUser(req);
  if (!u) return Response.json({ error: "Sign in required" }, { status: 401 });
  try {
    const [[row], values] = await Promise.all([q<{ pods: string[] }>(`SELECT pods FROM app_users WHERE name=$1`, [u.name]), allPodValues()]);
    return Response.json({ pods: row?.pods ?? [], values });
  } catch (e) {
    return apiError(e);
  }
}

export async function POST(req: Request) {
  const u = await sessionUser(req);
  if (!u) return Response.json({ error: "Sign in required" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as { pods?: unknown };
  const pods = Array.isArray(b.pods) ? [...new Set(b.pods.map(String).map((p) => p.trim()).filter(Boolean))].slice(0, 30) : [];
  await q(`UPDATE app_users SET pods=$2 WHERE name=$1`, [u.name, pods]);
  return Response.json({ ok: true, pods });
}
