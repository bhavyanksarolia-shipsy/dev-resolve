import { requireAdmin } from "@/lib/adminGuard";
import { checkClaude, checkDevrev } from "@/lib/health";
import { whoAmI } from "@/lib/devrev";
import { q } from "@/lib/db";
import { writeEnv } from "@/lib/adminConfig";
import { adminSetting, readConfigEnv } from "@/lib/config";
import { agentModel, DEFAULT_MODEL } from "@/lib/agent/run";
import { checkMail, mailSettings, revokeGmail, sendMail, welcomeEmail } from "@/lib/mail";
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
  const [claude, devrev, me, [usage], detectedOwner] = await Promise.all([
    checkClaude(), checkDevrev(), whoAmI().catch(() => null),
    q<{ runs: number; cost: number; tokens: number }>(`SELECT count(*)::int runs, COALESCE(sum(cost_usd),0)::float cost,
       COALESCE(sum(input_tokens + output_tokens),0)::float tokens FROM agent_runs WHERE started_at > now() - interval '30 days'`),
    claudeTokenOwner(),
  ]);
  return Response.json({
    claude: {
      ...claude,
      method: adminSetting("ANTHROPIC_API_KEY") ? `API key (${source("ANTHROPIC_API_KEY")})` : adminSetting("CLAUDE_CODE_OAUTH_TOKEN") ? `Claude login token (${source("CLAUDE_CODE_OAUTH_TOKEN")})` : "Local Claude Code login",
      model: agentModel(), defaultModel: DEFAULT_MODEL,
      usage30: usage,
      tokenPreview: mask(claudeToken()),
      // Who the key / token belongs to: from Anthropic for a login token, else the name an admin entered.
      owner: detectedOwner ?? adminSetting("CLAUDE_TOKEN_OWNER") ?? null, ownerDetected: !!detectedOwner, ownerNote: adminSetting("CLAUDE_TOKEN_OWNER") ?? "",
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
  const b = (await req.json().catch(() => ({}))) as { service?: string; apiKey?: string; oauthToken?: string; model?: string; token?: string; owner?: string; clear?: string[]; reveal?: boolean;
    user?: string; pass?: string; fromName?: string; host?: string; port?: number; check?: boolean; test?: boolean; appUrl?: string; disconnect?: "gmail" | "smtp" };
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
    if (v(b.apiKey)) {
      if (!/^sk-ant-/.test(v(b.apiKey))) return Response.json({ error: "That doesn't look like an Anthropic API key (sk-ant-…)" }, { status: 400 });
      updates.ANTHROPIC_API_KEY = v(b.apiKey); updates.CLAUDE_CODE_OAUTH_TOKEN = null;
    } else if (v(b.oauthToken)) {
      updates.CLAUDE_CODE_OAUTH_TOKEN = v(b.oauthToken); updates.ANTHROPIC_API_KEY = null;
    }
    if (b.model !== undefined) {
      const m = String(b.model).trim();
      if (m && !/^claude-[a-z0-9.-]+$/i.test(m)) return Response.json({ error: "Model ids look like claude-opus-5-5" }, { status: 400 });
      updates.DEV_RESOLVE_MODEL = m && m !== DEFAULT_MODEL ? m : null;
    }
    for (const k of b.clear ?? []) if (["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN"].includes(k)) updates[k] = null;
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
