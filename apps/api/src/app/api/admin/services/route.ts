import { requireAdmin } from "@/lib/adminGuard";
import { checkClaude, checkDevrev } from "@/lib/health";
import { whoAmI } from "@/lib/devrev";
import { q } from "@/lib/db";
import { writeEnv } from "@/lib/adminConfig";
import { adminSetting, readConfigEnv } from "@/lib/config";
import { gatewayViaConnector } from "@/lib/connector";
import { fallbackPersonalOn, fallbackServerOn, fallbackSummary, mainState } from "@/lib/claudeRoute";
import { agentModel, DEFAULT_MODEL } from "@/lib/agent/run";
import { AGENT_LIMITS, AGENT_TOOLS, SENT_TO_ANTHROPIC, storageSummary } from "@/lib/agent/transparency";
import { checkMail, cleanTemplate, connectorStep, EMAIL_THEMES, defaultWelcomeTemplate, mailSettings, revokeGmail, saveWelcomeTemplate, sendMail, WELCOME_PLACEHOLDERS, welcomeEmail, welcomeTemplate, type WelcomeTemplate } from "@/lib/mail";
import { q as dbq } from "@/lib/db";

const source = (k: string) => (readConfigEnv()[k] ? "saved in Admin" : process.env[k] ? "server variable" : null);
/** First 7 and last 4 characters only — the full value is sent just when an admin clicks the eye. */
const mask = (v?: string) => (v ? (v.length > 16 ? `${v.slice(0, 7)}${"•".repeat(10)}${v.slice(-4)}` : "•".repeat(10)) : null);
const claudeToken = () => adminSetting("ANTHROPIC_API_KEY") || adminSetting("CLAUDE_CODE_OAUTH_TOKEN") || "";

/** Whose Claude login token this is (Anthropic's account profile), best effort; cached 1 h. API keys don't say. */
let ownerCache: { token: string; at: number; value: string | null } | null = null;
async function claudeTokenOwner(): Promise<string | null> {
  const tok = adminSetting("ANTHROPIC_API_KEY") ? "" : adminSetting("CLAUDE_CODE_OAUTH_TOKEN") || "";
  if (!tok) return null;
  if (ownerCache?.token === tok && Date.now() - ownerCache.at < 3600_000) return ownerCache.value;
  const value = await fetch("https://api.anthropic.com/api/oauth/profile", {
    headers: { Authorization: `Bearer ${tok}`, "anthropic-beta": "oauth-2025-04-20" }, signal: AbortSignal.timeout(8000),
  }).then(async (r) => {
    if (!r.ok) return null;
    const j = (await r.json()) as { account?: { email_address?: string; email?: string; full_name?: string; display_name?: string }; organization?: { name?: string } };
    const name = j.account?.full_name || j.account?.display_name, email = j.account?.email_address || j.account?.email;
    const who = [name, email && `<${email}>`].filter(Boolean).join(" ");
    return who ? `${who}${j.organization?.name ? ` · ${j.organization.name}` : ""}` : null;
  }).catch(() => null);
  ownerCache = { token: tok, at: Date.now(), value };
  return value;
}

/** Admin → Connections → Claude / DevRev: how each is signed in, whether it works, and recent usage. */
export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if (g.error) return g.error;
  const [claude, devrev, me, [usage], detectedOwner, stored] = await Promise.all([
    checkClaude(), checkDevrev(), whoAmI().catch(() => null),
    q<{ runs: number; cost: number; tokens: number }>(`SELECT count(*)::int runs, COALESCE(sum(cost_usd),0)::float cost,
       COALESCE(sum(input_tokens + output_tokens),0)::float tokens FROM agent_runs WHERE started_at > now() - interval '30 days'`),
    claudeTokenOwner(),
    storageSummary(),
  ]);
  return Response.json({
    claude: {
      ...claude,
      method: adminSetting("ANTHROPIC_API_KEY") && adminSetting("ANTHROPIC_BASE_URL") ? `API gateway ${new URL(adminSetting("ANTHROPIC_BASE_URL")!).host}${gatewayViaConnector() ? " through the Dev Resolve extension" : ""} (${source("ANTHROPIC_API_KEY")})`
        : adminSetting("ANTHROPIC_API_KEY") ? `API key (${source("ANTHROPIC_API_KEY")})` : adminSetting("CLAUDE_CODE_OAUTH_TOKEN") ? `Claude login token (${source("CLAUDE_CODE_OAUTH_TOKEN")})` : "Local Claude Code login",
      model: agentModel(), defaultModel: DEFAULT_MODEL, gatewayUrl: adminSetting("ANTHROPIC_BASE_URL") ?? null, gatewayViaConnector: gatewayViaConnector(),
      fallback: { personal: fallbackPersonalOn(), server: fallbackServerOn(), now: fallbackSummary(), mainDown: mainState().down },
      usage30: usage,
      tokenPreview: mask(claudeToken()),
      // Who the key / token belongs to: from Anthropic for a login token, else the name an admin entered.
      owner: detectedOwner ?? adminSetting("CLAUDE_TOKEN_OWNER") ?? null, ownerDetected: !!detectedOwner, ownerNote: adminSetting("CLAUDE_TOKEN_OWNER") ?? "",
      // Transparency: what the agent can do, its limits, what's sent to Anthropic and what Dev Resolve keeps.
      tools: AGENT_TOOLS, limits: AGENT_LIMITS, sent: SENT_TO_ANTHROPIC, stored,
    },
    devrev: { ...devrev, as: me ? `${me.dev_user.display_name} <${me.dev_user.email}>` : null, tokenSource: source("DEVREV_TOKEN"), tokenPreview: mask(adminSetting("DEVREV_TOKEN")) },
    email: (() => { const m = mailSettings(); return { configured: m.configured, method: m.method, gmailSender: m.gmailSender, smtp: m.smtp, user: m.user, host: m.host, port: m.port, fromName: m.fromName, tokenPreview: mask(m.pass) }; })(),
  });
}

/**
 * Change Claude / DevRev settings from Admin. Secrets: empty = keep; "clear" removes the saved value (falls back to
 * the server variable). { service: "claude", apiKey?, oauthToken?, model? } | { service: "devrev", token? }
 */
export async function POST(req: Request) {
  const g = await requireAdmin(req);
  if (g.error) return g.error;
  const b = (await req.json().catch(() => ({}))) as { service?: string; apiKey?: string; gatewayUrl?: string; gatewayViaConnector?: boolean; fallbackPersonal?: boolean; fallbackServer?: boolean; useServerDefault?: boolean; oauthToken?: string; model?: string; token?: string; owner?: string; clear?: string[]; reveal?: boolean;
    user?: string; pass?: string; fromName?: string; host?: string; port?: number; check?: boolean; test?: boolean; appUrl?: string; disconnect?: "gmail" | "smtp";
    template?: Partial<WelcomeTemplate>; saveTemplate?: boolean; previewTemplate?: boolean; resetTemplate?: boolean; getTemplate?: boolean };
  // Admin → Email → Edit email: the welcome mail's text and steps.
  if (b.service === "email" && b.getTemplate) {
    const t = welcomeTemplate();
    // connector: what the automatic Connector step says right now (it follows Admin → Files & extension).
    return Response.json({ template: t.template, custom: t.custom, defaults: defaultWelcomeTemplate(), placeholders: WELCOME_PLACEHOLDERS, connector: connectorStep(),
      themes: Object.entries(EMAIL_THEMES).map(([id, x]) => ({ id, label: x.label, hero: x.heroBg, heroImage: x.heroImage, bar: x.heroBar, accent: x.accent, page: x.page })) });
  }
  if (b.service === "email" && (b.previewTemplate || b.saveTemplate)) {
    let t: WelcomeTemplate;
    try { t = cleanTemplate(b.template ?? {}); } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
    if (b.saveTemplate) {
      await saveWelcomeTemplate(t, g.user.name);
      return Response.json({ ok: true, message: "Welcome email saved — used for the next person you add" });
    }
    // Preview as if sent to a sample new member, added by this admin.
    const [me] = await dbq<{ display_name: string | null }>(`SELECT display_name FROM app_users WHERE name=$1`, [g.user.name]);
    const m = welcomeEmail({ name: "Asha Rao", username: "asha.rao", email: "asha.rao@shipsy.io", admin: false, addedBy: me?.display_name || g.user.name, appUrl: adminSetting("APP_URL") || b.appUrl || "", hasPassword: false }, t);
    return Response.json({ subject: m.subject, html: m.html });
  }
  if (b.service === "email" && b.resetTemplate) {
    await saveWelcomeTemplate(null, g.user.name);
    return Response.json({ ok: true, message: "Back to the default welcome email" });
  }
  if (b.service === "email" && b.disconnect) {
    if (b.disconnect === "gmail") await revokeGmail();
    await writeEnv(b.disconnect === "gmail" ? { GMAIL_REFRESH_TOKEN: null, GMAIL_SENDER: null } : { SMTP_USER: null, SMTP_PASS: null }, g.user.name);
    return Response.json({ ok: true, message: b.disconnect === "gmail" ? "Gmail disconnected" : "SMTP mailbox removed" });
  }
  if (b.service === "email" && b.check) return Response.json(await checkMail());
  if (b.service === "email" && b.test) {
    // A sample welcome mail to the admin themself — shows exactly what new people receive.
    const [me] = await dbq<{ email: string | null; display_name: string | null }>(`SELECT email, display_name FROM app_users WHERE name=$1`, [g.user.name]);
    if (!me?.email) return Response.json({ error: "Your login has no email to send the test to" }, { status: 400 });
    const m = welcomeEmail({ name: me.display_name || g.user.name, username: g.user.name, email: me.email, admin: true, addedBy: me.display_name || g.user.name, appUrl: adminSetting("APP_URL") || b.appUrl || "", hasPassword: false });
    try { await sendMail({ to: me.email, subject: `[Test] ${m.subject}`, text: m.text, html: m.html }); return Response.json({ ok: true, message: `Test email sent to ${me.email}` }); }
    catch (e) { return Response.json({ error: `Couldn't send: ${(e as Error).message.slice(0, 200)}` }, { status: 400 }); }
  }
  // The eye button: the full current token, for admins only; every reveal is logged.
  if (b.reveal) {
    const value = b.service === "claude" ? claudeToken() : b.service === "devrev" ? adminSetting("DEVREV_TOKEN") ?? "" : b.service === "email" ? mailSettings().pass : "";
    console.log(`[admin] ${g.user.name} revealed the ${b.service} token`);
    return Response.json({ value: value || null });
  }
  const v = (x?: string) => String(x ?? "").replace(/[\r\n\s]/g, "");
  const updates: Record<string, string | null> = {};
  if (b.service === "claude") {
    if (b.useServerDefault) {
      // Back to the server's own Claude login (its variables): forget the key / gateway / token saved in Admin.
      updates.ANTHROPIC_API_KEY = null; updates.ANTHROPIC_BASE_URL = null; updates.CLAUDE_CODE_OAUTH_TOKEN = null; updates.GATEWAY_VIA_CONNECTOR = null;
    } else if (b.gatewayUrl !== undefined) {
      // An API gateway in front of Anthropic (e.g. Bifrost): its address + the key it issued (sk-bf-… for Bifrost).
      const url = String(b.gatewayUrl).trim().replace(/\/+$/, "");
      if (!/^https?:\/\/[^\s/]+/.test(url)) return Response.json({ error: "Gateway address must start with https:// (e.g. https://bifrost.example.com/anthropic)" }, { status: 400 });
      const key = v(b.apiKey) || (adminSetting("ANTHROPIC_BASE_URL") ? adminSetting("ANTHROPIC_API_KEY") : "") || "";
      if (!key) return Response.json({ error: "Paste the key the gateway gave you" }, { status: 400 });
      updates.ANTHROPIC_BASE_URL = url; updates.ANTHROPIC_API_KEY = key; updates.CLAUDE_CODE_OAUTH_TOKEN = null;
      // Only on the VPN (e.g. Bifrost behind Pritunl): the team's Dev Resolve extensions carry the agent's requests to it.
      updates.GATEWAY_VIA_CONNECTOR = b.gatewayViaConnector ? "on" : null;
    } else if (v(b.apiKey)) {
      if (!/^sk-ant-/.test(v(b.apiKey))) return Response.json({ error: v(b.apiKey).startsWith("sk-bf-")
        ? "That's a Bifrost key — choose \"API gateway (e.g. Bifrost)\" under Sign-in and add the gateway address"
        : "That doesn't look like an Anthropic API key (sk-ant-…)" }, { status: 400 });
      updates.ANTHROPIC_API_KEY = v(b.apiKey); updates.CLAUDE_CODE_OAUTH_TOKEN = null; updates.ANTHROPIC_BASE_URL = null; updates.GATEWAY_VIA_CONNECTOR = null;
    } else if (v(b.oauthToken)) {
      updates.CLAUDE_CODE_OAUTH_TOKEN = v(b.oauthToken); updates.ANTHROPIC_API_KEY = null; updates.ANTHROPIC_BASE_URL = null; updates.GATEWAY_VIA_CONNECTOR = null;
    }
    if (b.model !== undefined) {
      const m = String(b.model).trim();
      if (m && !/^claude-[a-z0-9.-]+$/i.test(m)) return Response.json({ error: "Model ids look like claude-opus-5-5" }, { status: 400 });
      updates.DEV_RESOLVE_MODEL = m && m !== DEFAULT_MODEL ? m : null;
    }
    for (const k of b.clear ?? []) if (["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"].includes(k)) updates[k] = null;
    // When the main sign-in isn't working: the person's own Claude token, then the server's Claude login (both on by default).
    if (b.fallbackPersonal !== undefined) updates.CLAUDE_FALLBACK_PERSONAL = b.fallbackPersonal ? null : "off";
    if (b.fallbackServer !== undefined) updates.CLAUDE_FALLBACK_SERVER = b.fallbackServer ? null : "off";
    if (b.owner !== undefined) updates.CLAUDE_TOKEN_OWNER = String(b.owner).replace(/[\r\n]/g, " ").trim().slice(0, 120) || null;
  } else if (b.service === "devrev") {
    if (v(b.token)) updates.DEVREV_TOKEN = v(b.token);
  } else if (b.service === "email") {
    const user = String(b.user ?? "").trim();
    if (user && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(user)) return Response.json({ error: "The sending address doesn't look like an email" }, { status: 400 });
    if (user) updates.SMTP_USER = user;
    if (v(b.pass)) updates.SMTP_PASS = v(b.pass); // Google shows App Passwords with spaces; they're not part of it
    if (b.fromName !== undefined) updates.SMTP_FROM_NAME = String(b.fromName).replace(/["\r\n<>]/g, "").trim().slice(0, 60) || null;
    if (b.host !== undefined) updates.SMTP_HOST = String(b.host).trim() || null;
    if (b.port !== undefined) updates.SMTP_PORT = Number(b.port) > 0 ? String(Number(b.port)) : null;
  } else return Response.json({ error: "unknown service" }, { status: 400 });
  if (!Object.keys(updates).length) return Response.json({ error: "Nothing to change" }, { status: 400 });
  await writeEnv(updates, g.user.name);
  return Response.json({ ok: true, message: "Saved" });
}
