import { connectorUser, relaySuffixes } from "@/lib/connector";
import { signinsFor, vpnHosts } from "@/lib/connectorInfo";

/** What the connector needs to know: who it is, which hosts it may relay to, which sign-ins are missing. */
export async function GET(req: Request) {
  const user = await connectorUser(req);
  if (!user) return Response.json({ error: "Connector token not valid — make a new one on the Connector page" }, { status: 401 });
  return Response.json({ user, allowSuffixes: relaySuffixes(), vpnHosts: vpnHosts(), signins: signinsFor(user) });
}
