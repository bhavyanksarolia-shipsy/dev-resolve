import { sessionUser } from "@/lib/auth";
import { createConnectorToken } from "@/lib/connector";
import { publicOrigin } from "@/lib/google";

/** Make (or replace) the signed-in person's connector token. Shown once — only its hash is stored. */
export async function POST(req: Request) {
  const u = await sessionUser(req);
  if (!u) return Response.json({ error: "Sign in required" }, { status: 401 });
  const token = await createConnectorToken(u.name, req.headers.get("user-agent")?.slice(0, 80) || "connector");
  const origin = publicOrigin(req);
  return Response.json({ token, server: origin });
}
