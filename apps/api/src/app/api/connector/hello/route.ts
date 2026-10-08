import { connectorUser, gatewayHost, gatewayViaConnector, relaySuffixes } from "@/lib/connector";
import { signinsFor, vpnGroups, vpnHosts } from "@/lib/connectorInfo";

/** What the connector needs to know: who it is, which hosts it may relay to, which sign-ins are missing. */
export async function GET(req: Request) {
  const user = await connectorUser(req);
  if (!user) return Response.json({ error: "Connector token not valid — make a new one on the Connector page" }, { status: 401 });
  return Response.json({ user, allowSuffixes: relaySuffixes(), gatewayHosts: gatewayViaConnector() ? [gatewayHost()].filter(Boolean) : [], vpnHosts: vpnHosts(), vpns: vpnGroups(), signins: signinsFor(user) });
}
