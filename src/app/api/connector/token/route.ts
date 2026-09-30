import { sessionUser } from "@/lib/auth";
import { createConnectorToken } from "@/lib/connector";

/** Make (or replace) the signed-in person's connector token. Shown once — only its hash is stored. */
export async function POST(req: Request) {
  const u = await sessionUser(req);
  if (!u) return Response.json({ error: "Sign in required" }, { status: 401 });
  const token = await createConnectorToken(u.name, req.headers.get("user-agent")?.slice(0, 80) || "connector");
  const origin = process.env.APP_URL || new URL(req.url).origin;
  return Response.json({ token, server: origin });
}
