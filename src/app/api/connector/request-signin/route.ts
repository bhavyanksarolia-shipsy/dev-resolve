import { sessionUser } from "@/lib/auth";
import { requestSignin } from "@/lib/connector";

/** Ask the signed-in person's own connector to open their Chrome for these sign-ins (e.g. ["bi_neo","app_log"]). */
export async function POST(req: Request) {
  const u = await sessionUser(req);
  if (!u) return Response.json({ error: "Sign in required" }, { status: 401 });
  const { what } = (await req.json().catch(() => ({}))) as { what?: string[] };
  if (!Array.isArray(what) || !what.length) return Response.json({ error: "what: [...] required" }, { status: 400 });
  return requestSignin(u.name, what.map(String).slice(0, 10))
    ? Response.json({ ok: true })
    : Response.json({ error: "Your local connector isn't running — start it first" }, { status: 409 });
}
