import "server-only";
import { cfgValue, getConnectionProjects } from "./config";
import { appLogProjects } from "./applog";
import { needsRelay, ssoMetabaseProjects, metabaseSession, appLogUserConfigDir } from "./connector";
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

/** VPN-only hosts the connector should be able to reach — used for its "is the VPN up?" check. */
export function vpnHosts(): string[] {
  const urls = Object.values(getConnectionProjects()).flatMap((p) => [
    p.opensearch ? cfgValue(p.opensearch.url_env) : undefined,
    p.metabase ? cfgValue(p.metabase.base_url_env) : undefined,
  ]).filter((u): u is string => !!u && needsRelay(u));
  return [...new Set(urls.map((u) => new URL(u).host))];
}

export function appLogInfo() {
  const p = appLogProjects()[0];
  if (!p) return null;
  const gateway = p.args.find((a) => /^https:\/\//.test(a))!;
  const clientId = JSON.parse(p.args[p.args.indexOf("--static-oauth-client-info") + 1]).client_id as string;
  const port = Number(p.args.find((a) => /^\d{4,5}$/.test(a)) || 3334);
  return { project: p.name, gateway, clientId, callbackPort: port };
}

/** Which of this person's sign-ins are missing (the connector offers to do them). */
export function signinsFor(user: string) {
  const metabase = ssoMetabaseProjects().map((p) => ({ project: p.name, baseUrl: p.baseUrl, signedIn: !!metabaseSession(user, p.name) }));
  const dir = path.join(appLogUserConfigDir(user), "mcp-remote-v1");
  const appLog = appLogInfo() && { ...appLogInfo()!, signedIn: existsSync(dir) && readdirSync(dir).some((f) => f.endsWith("_tokens.json")) };
  return { metabase, appLog };
}
