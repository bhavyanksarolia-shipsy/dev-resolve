/**
 * Build the Chrome Web Store package for your deployment (upload it in the Chrome Web Store developer dashboard).
 *   npm run extension:package -- --app https://<frontend> --server https://<backend>
 * Writes dev-resolve-extension-<version>.zip in the repo root (gitignored). Uses this machine's private config
 * (VPN host suffix, Google-login Metabase hosts) — the zip is for the store upload only, never commit it.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { EXTENSION_VERSION, extensionFiles } from "../src/lib/extensionPackage";
import { zip } from "../src/lib/zip";

const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
const norm = (u?: string) => (u ? (/^https?:\/\//.test(u) ? u : `https://${u}`).replace(/\/+$/, "") : u);

(async () => {
  const app = norm(arg("--app") || process.env.APP_URL);
  const server = norm(arg("--server") || process.env.BACKEND_PUBLIC_URL) || app;
  if (!app) throw new Error("Usage: npm run extension:package -- --app https://<frontend> --server https://<backend>");
  const files = await extensionFiles({ app, server: server! });
  const out = path.join(process.cwd(), "..", "..", `dev-resolve-extension-${EXTENSION_VERSION}.zip`);
  writeFileSync(out, zip(files));
  const m = JSON.parse(files[0].data.toString());
  console.log(`Created ${path.basename(out)} for ${app} (backend ${server})`);
  console.log(`Hosts it may reach: ${m.host_permissions.join(", ")}`);
  console.log("Upload it in the Chrome Web Store developer dashboard (see apps/api/extension/STORE_LISTING.md). Don't commit it.");
})().catch((e) => { console.error(e.message || e); process.exit(1); });
