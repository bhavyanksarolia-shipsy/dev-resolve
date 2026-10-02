import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { ROOT } from "./config";
import { relaySuffixes, ssoMetabaseProjects } from "./connector";
import { appLogInfo } from "./connectorInfo";
import { iconPng } from "./icon";

export const EXTENSION_VERSION = "1.1.1";

/**
 * The Chrome extension's files for one deployment: the manifest lists exactly the hosts it may talk to (this server,
 * the client-VPN suffix, the Google-login Metabase hosts, the app-logs sign-in) and config.json holds the addresses.
 * Used by the download on the Connector page and by `npm run extension:package` (Chrome Web Store upload).
 */
export async function extensionFiles(opts: { app: string; server: string }) {
  const origin = (x: string) => `${new URL(x).origin}/*`;
  const hosts = new Set<string>([origin(opts.server), origin(opts.app)]);
  for (const s of relaySuffixes()) hosts.add(`https://*${s.startsWith(".") ? s : `.${s}`}/*`);
  for (const m of ssoMetabaseProjects()) if (m.baseUrl) hosts.add(origin(m.baseUrl));
  const al = appLogInfo();
  if (al) {
    hosts.add(origin(al.gateway));
    try {
      const meta = await (await fetch(new URL("/.well-known/oauth-authorization-server", al.gateway), { signal: AbortSignal.timeout(10_000) })).json();
      for (const k of ["authorization_endpoint", "token_endpoint"]) if (meta[k]) hosts.add(origin(meta[k]));
    } catch { /* added on the next build if the gateway was briefly unreachable */ }
  }
  const icons = { 16: "icons/16.png", 32: "icons/32.png", 48: "icons/48.png", 128: "icons/128.png" };
  const manifest = {
    manifest_version: 3,
    name: "Dev Resolve connector",
    short_name: "Dev Resolve",
    description: "Connects Dev Resolve to the systems your laptop can reach (company VPN) and to your own sign-ins, for your investigations.",
    version: EXTENSION_VERSION,
    icons,
    background: { service_worker: "background.js" },
    action: { default_title: "Dev Resolve", default_popup: "popup.html", default_icon: icons },
    permissions: ["storage", "alarms", "cookies", "tabs"],
    host_permissions: [...hosts],
    content_scripts: [{ matches: [`${new URL(opts.app).origin}/connector*`], js: ["content.js"], run_at: "document_idle" }],
  };
  const dir = path.join(ROOT, "extension");
  return [
    { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2)) },
    { name: "config.json", data: Buffer.from(JSON.stringify({ server: opts.server, app: opts.app }, null, 2)) },
    ...["background.js", "content.js", "popup.html", "popup.js"].map((f) => ({ name: f, data: readFileSync(path.join(dir, f)) })),
    ...Object.entries(icons).map(([s, name]) => ({ name, data: iconPng(Number(s)) })),
  ];
}
