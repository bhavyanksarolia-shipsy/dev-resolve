import { writeEnv } from "@/lib/adminConfig";
import { requireAdmin } from "@/lib/adminGuard";
import { cfgValue } from "@/lib/config";
import { allowedDomains, googleAutoCreate } from "@/lib/google";

/** A few app settings an admin can change from the UI (stored in config.env → Postgres). */
const EDITABLE: Record<string, { label: string; check?: (v: string) => string | null }> = {
  EXTENSION_STORE_URL: { label: "Chrome Web Store link", check: (v) => (!v || /^https:\/\/chrome(webstore)?\.google\.com\//.test(v) ? null : "Paste the extension's Chrome Web Store link (https://chromewebstore.google.com/…)") },
  VPN_HINT: { label: "How people connect the company VPN (shown in 'Connect VPN' messages)" },
  GOOGLE_AUTO_CREATE: { label: "Anyone with an allowed Google account can sign in", check: (v) => (["on", "off", ""].includes(v) ? null : "on or off") },
};

export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if (g.error) return g.error;
  const out = Object.fromEntries(Object.entries(EDITABLE).map(([k, d]) => [k, { label: d.label, value: cfgValue(k) || "" }]));
  out.GOOGLE_AUTO_CREATE.value = googleAutoCreate() ? "on" : "off";
  return Response.json({ ...out, allowedDomains: { label: "Allowed Google domains", value: allowedDomains().join(", ") } });
}

export async function POST(req: Request) {
  const g = await requireAdmin(req);
  if (g.error) return g.error;
  const b = (await req.json().catch(() => ({}))) as Record<string, string>;
  const updates: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(b)) {
    if (!EDITABLE[k]) return Response.json({ error: `${k} can't be changed here` }, { status: 400 });
    const val = String(v ?? "").replace(/[\r\n]/g, "").trim();
    const problem = EDITABLE[k].check?.(val);
    if (problem) return Response.json({ error: problem }, { status: 400 });
    updates[k] = val || null;
  }
  await writeEnv(updates, g.user.name);
  return Response.json({ ok: true, message: "Saved" });
}
