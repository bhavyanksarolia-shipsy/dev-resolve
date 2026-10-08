import { sessionUser } from "@/lib/auth";
import { connectorMode, connectorStatus } from "@/lib/connector";
import { signinsFor, vpnGroups, vpnHosts } from "@/lib/connectorInfo";
import { settings } from "@/lib/settings";

export async function GET(req: Request) {
  const u = await sessionUser(req);
  if (!u) return Response.json({ error: "Sign in required" }, { status: 401 });
  return Response.json({ mode: connectorMode(), user: u.name, ...connectorStatus(u.name), vpnHosts: vpnHosts(), vpns: vpnGroups(), signins: signinsFor(u.name), storeUrl: settings.extensionStoreUrl() || null });
}
