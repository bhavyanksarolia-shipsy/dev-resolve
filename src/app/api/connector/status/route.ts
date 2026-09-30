import { sessionUser } from "@/lib/auth";
import { connectorMode, connectorStatus } from "@/lib/connector";
import { signinsFor, vpnHosts } from "@/lib/connectorInfo";

export async function GET(req: Request) {
  const u = await sessionUser(req);
  if (!u) return Response.json({ error: "Sign in required" }, { status: 401 });
  return Response.json({ mode: connectorMode(), user: u.name, ...connectorStatus(u.name), vpnHosts: vpnHosts(), signins: signinsFor(u.name) });
}
