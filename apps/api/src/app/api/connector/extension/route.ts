import { readFileSync } from "node:fs";
import path from "node:path";
import { sessionUser } from "@/lib/auth";
import { ROOT } from "@/lib/config";
import { relaySuffixes } from "@/lib/connector";
import { appLogInfo, signinsFor } from "@/lib/connectorInfo";
import { publicOrigin } from "@/lib/google";
import { settings } from "@/lib/settings";
import { zip } from "@/lib/zip";

const EXTENSION_VERSION = "1.0.0";

/**
 * The Chrome extension, pre-configured for THIS deployment: its manifest lists exactly the hosts it may talk to
 * (this server, the client-VPN suffix, the Google-login Metabase hosts, the app-logs sign-in), so the public repo
 * holds only a template and the person never types an address.
 */
export async function GET(req: Request) {
  const u = await sessionUser(req);
  if (!u) return Response.json({ error: "Sign in required" }, { status: 401 });
  const app = publicOrigin(req);
  const server = settings.backendPublicUrl() || app;
  const origin = (x: string) => `${new URL(x).origin}/*`;
  const hosts = new Set<string>([origin(server), origin(app)]);
  for (const s of relaySuffixes()) hosts.add(`https://*${s.startsWith(".") ? s : `.${s}`}/*`);
  for (const m of signinsFor(u.name).metabase) if (m.baseUrl) hosts.add(origin(m.baseUrl));
  const al = appLogInfo();
  if (al) {
    hosts.add(origin(al.gateway));
    try {
      const meta = await (await fetch(new URL("/.well-known/oauth-authorization-server", al.gateway), { signal: AbortSignal.timeout(10_000) })).json();
      for (const k of ["authorization_endpoint", "token_endpoint"]) if (meta[k]) hosts.add(origin(meta[k]));
    } catch { /* sign-in host added on next download if the gateway was briefly unreachable */ }
  }
  const manifest = {
    manifest_version: 3,
    name: "Dev Resolve connector",
    description: "Carries your Dev Resolve investigations' VPN-only requests from this laptop and keeps your Google sign-ins synced.",
    version: EXTENSION_VERSION,
    background: { service_worker: "background.js" },
    action: { default_title: "Dev Resolve", default_popup: "popup.html" },
    permissions: ["storage", "alarms", "cookies", "tabs"],
    host_permissions: [...hosts],
    content_scripts: [{ matches: [`${new URL(app).origin}/connector*`], js: ["content.js"], run_at: "document_idle" }],
  };
  const dir = path.join(ROOT, "extension");
  const files = [
    { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest, null, 2)) },
    { name: "config.json", data: Buffer.from(JSON.stringify({ server, app }, null, 2)) },
    ...["background.js", "content.js", "popup.html", "popup.js"].map((f) => ({ name: f, data: readFileSync(path.join(dir, f)) })),
  ];
  return new Response(new Uint8Array(zip(files)), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="dev-resolve-connector-extension.zip"', "Cache-Control": "no-store" },
  });
}
