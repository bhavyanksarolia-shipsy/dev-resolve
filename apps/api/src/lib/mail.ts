import "server-only";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";
import { adminSetting, CONFIG_DIR } from "./config";
import { savePrivate } from "./privateStore";
import { googleClientId, googleClientSecret } from "./google";
import { settings } from "./settings";

/**
 * Outgoing email (welcome mails). Two ways, set in Admin → Connections → Email:
 *  - Gmail (preferred): an admin clicks "Connect Gmail" and allows "send email as you"; mails go out through the Gmail
 *    API over HTTPS. Works on hosts that block SMTP ports (Railway Trial / Hobby).
 *  - SMTP: a mailbox + App Password (smtp.gmail.com:465 by default) — for hosts where SMTP is open.
 */
export function mailSettings() {
  const user = adminSetting("SMTP_USER") || "";
  const gmailSender = adminSetting("GMAIL_SENDER") || "";
  const gmail = !!(gmailSender && adminSetting("GMAIL_REFRESH_TOKEN"));
  const smtp = !!(user && adminSetting("SMTP_PASS"));
  return {
    method: gmail ? "gmail" as const : smtp ? "smtp" as const : null,
    gmailSender,
    host: adminSetting("SMTP_HOST") || "smtp.gmail.com",
    port: Number(adminSetting("SMTP_PORT") || 465),
    user,
    pass: adminSetting("SMTP_PASS") || "",
    fromName: adminSetting("SMTP_FROM_NAME") || "Dev Resolve",
    smtp,
    configured: gmail || smtp,
  };
}

function transport() {
  const s = mailSettings();
  if (!s.smtp) throw new Error("Email isn't set up — Admin → Connections → Email");
  return nodemailer.createTransport({ host: s.host, port: s.port, secure: s.port === 465, auth: { user: s.user, pass: s.pass }, connectionTimeout: 15000 });
}

/** A short-lived Gmail access token from the saved refresh token. */
async function gmailToken() {
  const r = await fetch(settings.googleTokenUrl(), {
    method: "POST", signal: AbortSignal.timeout(15_000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: adminSetting("GMAIL_REFRESH_TOKEN") || "", client_id: googleClientId(), client_secret: googleClientSecret() }),
  });
  const t = (await r.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
  if (!t.access_token) throw new Error(t.error === "invalid_grant"
    ? "Gmail access was removed or expired — click \"Connect Gmail\" again"
    : `Google didn't give a Gmail token (${t.error_description || t.error || r.status})`);
  return t.access_token;
}

async function gmailApi(path: string, init: RequestInit = {}) {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    ...init, signal: AbortSignal.timeout(20_000),
    headers: { Authorization: `Bearer ${await gmailToken()}`, "Content-Type": "application/json", ...init.headers },
  });
  const j = (await r.json().catch(() => ({}))) as { error?: { message?: string } } & Record<string, unknown>;
  if (!r.ok) {
    const m = j.error?.message || `HTTP ${r.status}`;
    throw new Error(/has not been used|is disabled|SERVICE_DISABLED/i.test(m)
      ? "The Gmail API is off in the Google Cloud project — Google Cloud → APIs & Services → Library → Gmail API → Enable, then try again"
      : m.slice(0, 200));
  }
  return j;
}

/** Signs in to the mailbox without sending anything. */
export async function checkMail(): Promise<{ ok: boolean; message: string }> {
  const s = mailSettings();
  if (!s.configured) return { ok: false, message: "Not set up — connect Gmail (or add an SMTP mailbox)" };
  try {
    if (s.method === "gmail") {
      // Send-only permission can't read the mailbox (not even its profile), so check the token and what it allows.
      const info = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(await gmailToken())}`, { signal: AbortSignal.timeout(10_000) })
        .then((r) => r.json() as Promise<{ scope?: string; error_description?: string }>);
      if (!String(info.scope ?? "").split(" ").includes("https://www.googleapis.com/auth/gmail.send"))
        return { ok: false, message: "Connected, but without permission to send — click Reconnect Gmail and allow \"Send email on your behalf\"" };
      return { ok: true, message: `Connected to Gmail as ${s.gmailSender} · allowed to send` };
    }
    await transport().verify();
    return { ok: true, message: `Signed in to ${s.host} as ${s.user}` };
  } catch (e) {
    const m = (e as Error).message;
    return { ok: false, message: /535|Username and Password not accepted|Invalid login/i.test(m)
      ? "Google refused the sign-in — use an App Password (Google account → Security → 2-Step Verification → App passwords), not the normal password"
      : /timeout|ETIMEDOUT|ECONNREFUSED/i.test(m) && s.method === "smtp"
        ? "Couldn't reach the mail server — this host blocks SMTP (Railway does on Trial / Hobby). Use \"Connect Gmail\" instead."
        : m.slice(0, 200) };
  }
}

export async function sendMail(m: { to: string; subject: string; text: string; html: string; replyTo?: string }) {
  const s = mailSettings();
  const from = s.method === "gmail" ? s.gmailSender : s.user;
  const msg = { from: `"${s.fromName}" <${from}>`, to: m.to, subject: m.subject, text: m.text, html: m.html, ...(m.replyTo && { replyTo: m.replyTo }) };
  if (s.method === "gmail") {
    // Build the MIME message locally, then hand it to Gmail over HTTPS.
    const built = await nodemailer.createTransport({ streamTransport: true, buffer: true }).sendMail(msg);
    await gmailApi("messages/send", { method: "POST", body: JSON.stringify({ raw: Buffer.from(built.message as Buffer).toString("base64url") }) });
    return;
  }
  try {
    await transport().sendMail(msg);
  } catch (e) {
    const t = (e as Error).message;
    throw new Error(/timeout|ETIMEDOUT|ECONNREFUSED/i.test(t)
      ? "Couldn't reach the mail server — this host blocks SMTP (Railway does on Trial / Hobby). Use \"Connect Gmail\" instead."
      : t);
  }
}

/** Forget the Gmail connection (and tell Google, best effort). */
export async function revokeGmail() {
  const tok = adminSetting("GMAIL_REFRESH_TOKEN");
  if (tok) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tok)}`, { method: "POST", signal: AbortSignal.timeout(8000) }).catch(() => null);
}

const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * One onboarding step. Text fields take {placeholders} and **bold**; button = [label, link].
 * auto: "connector" — filled in when the email is sent, from Admin → Files & extension (Web Store link or not).
 */
export interface Step { title: string; time: string; tag?: string; text: string; sub?: string[]; button?: [string, string]; auto?: "connector" }

/** How to install the Connector right now: one "Add to Chrome" click once the Web Store link is set, else load it by hand. */
export function connectorStep(): Step {
  const store = settings.extensionStoreUrl();
  return store
    ? { title: "Add the Connector to Chrome", time: "1 min", tag: "once per laptop",
        text: "It lets investigations reach systems that are only on the client VPN, through your own laptop. Click **Add to Chrome**, then open the Connector page — it shows \"Installed · linked to you\".",
        button: ["Add to Chrome", store] }
    : { title: "Install the Connector extension", time: "3 min", tag: "once per laptop",
        text: "It lets investigations reach systems that are only on the client VPN, through your own laptop.",
        sub: [
          `Open the Connector page and click **Download the extension**.`,
          "Unzip the downloaded file.",
          `In Chrome, go to chrome://extensions and switch on **Developer mode** (top right).`,
          `Click **Load unpacked** and choose the unzipped folder.`,
          `Go back to the Connector page — it shows "Installed · linked to you".`,
        ],
        button: ["Open the Connector page", "{app}/connector"] };
}

/** Colour themes for the welcome email (picked in the editor). "clean" keeps colour to buttons and step numbers. */
export const EMAIL_THEMES = {
  clean:    { label: "Clean",    page: "#f4f6f5", heroBg: "#ffffff", heroImage: "none", heroBar: "#15803d", heroText: "#0f1f16", heroSub: "#5b6b62", logoBg: "#15803d", logoText: "#ffffff", brand: "#15803d",
              accent: "#15803d", accentDark: "#166534", chip: "#e7f5ec", soft: "#f6f8f7", code: "#eceff0", line: "#e3e8e5", ink: "#0f1f16", text: "#14251c", body: "#3a4a40", muted: "#5b6b62", faint: "#8a9a90" },
  midnight: { label: "Midnight", page: "#f3f4f6", heroBg: "#0f172a", heroImage: "linear-gradient(135deg,#0f172a,#1e293b)", heroBar: "", heroText: "#ffffff", heroSub: "#cbd5e1", logoBg: "#ffffff", logoText: "#0f172a", brand: "#94a3b8",
              accent: "#4f46e5", accentDark: "#4338ca", chip: "#eef2ff", soft: "#f6f7fb", code: "#eceef5", line: "#e5e7eb", ink: "#111827", text: "#111827", body: "#374151", muted: "#6b7280", faint: "#9ca3af" },
  ocean:    { label: "Ocean",    page: "#eff4fa", heroBg: "#1d4ed8", heroImage: "linear-gradient(135deg,#1d4ed8,#0ea5e9)", heroBar: "", heroText: "#ffffff", heroSub: "#dbeafe", logoBg: "#ffffff", logoText: "#1d4ed8", brand: "#dbeafe",
              accent: "#2563eb", accentDark: "#1d4ed8", chip: "#e0ecff", soft: "#f3f7fd", code: "#e6eefb", line: "#dde6f2", ink: "#0f172a", text: "#0f172a", body: "#334155", muted: "#64748b", faint: "#94a3b8" },
  green:    { label: "Green",    page: "#f1f6f2", heroBg: "#15803d", heroImage: "linear-gradient(135deg,#166534,#16a34a)", heroBar: "", heroText: "#ffffff", heroSub: "#d9f2e1", logoBg: "#ffffff", logoText: "#15803d", brand: "#d9f2e1",
              accent: "#15803d", accentDark: "#166534", chip: "#e7f5ec", soft: "#f6faf7", code: "#e7f0ea", line: "#dfe9e2", ink: "#0f1f16", text: "#14251c", body: "#35463c", muted: "#5b6b62", faint: "#8a9a90" },
} as const;
export type EmailTheme = keyof typeof EMAIL_THEMES;

/** Everything an admin can edit in Admin → Connections → Email → Edit email (saved in config/welcome-email.json). */
export interface WelcomeTemplate {
  theme?: EmailTheme;
  subject: string; heading: string; subheading: string; intro: string; buttonLabel: string;
  stepsTitle: string; steps: Step[]; readyTitle: string; ready: string[]; needs: string; questions: string;
}

/** What {placeholders} the template can use, for the editor's hint. */
export const WELCOME_PLACEHOLDERS: Record<string, string> = {
  "{first}": "their first name", "{name}": "their full name", "{email}": "their email", "{username}": "their username",
  "{addedBy}": "who added them", "{role}": "an admin / a member", "{app}": "Dev Resolve's address", "{signIn}": "how they sign in (Google, or Google + password)", "{steps}": "how many steps there are",
};

const TEMPLATE_FILE = path.join(CONFIG_DIR, "welcome-email.json");

export function defaultWelcomeTemplate(): WelcomeTemplate {
  return {
    theme: "clean",
    subject: "Welcome to Dev Resolve",
    heading: "Welcome aboard, {first} 👋",
    subheading: "You're in as {role}. Setup takes about 10 minutes.",
    intro: "**{addedBy}** added you to Dev Resolve. It investigates DevRev support tickets — it searches the client's logs, database and code, and drafts an evidence-based RCA for you to review.",
    buttonLabel: "Open Dev Resolve",
    stepsTitle: "Set up in {steps} steps",
    steps: [
      { title: "Sign in", time: "1 min", text: "Open Dev Resolve and {signIn}", button: ["Sign in", "{app}/login"] },
      { title: "Pick your Pods", time: "1 min",
        text: `Click the Pods filter at the top right (it shows "All Pods") and tick your team's Pods, e.g. WMS Inbound or WMS Outbound. Tick "No Pod" too if you also want new tickets nobody has triaged yet.` },
      { title: "Install the Connector", time: "", text: "", auto: "connector" },
      { title: "Sign in to the tools", time: "2 min",
        text: `On the Connector page, under Google sign-ins, click **Sign in to all missing** (app logs and the Google-login Metabase). Investigations use your own sign-ins.`,
        button: ["Open the Connector page", "{app}/connector"] },
      { title: "Connect the VPN", time: "1 min", tag: "Reliance tickets only",
        text: `Before investigating Reliance tickets (VF, QC, JioMart 3P), connect the Cisco AnyConnect "ril" profile.` },
      { title: "Investigate a ticket", time: "",
        text: `Open Tickets, pick a ticket and click **Start investigation**. Add what you already know (order, warehouse, screenshots) — the agent checks it against logs, database and code. Review the RCA, ask follow-ups in Chat, then post it to DevRev's internal discussion.`,
        button: ["Open Tickets", "{app}/tickets"] },
    ],
    readyTitle: "You're ready when",
    ready: [`The bar at the top says "All connections OK"`, `The Connector page shows "Installed · linked to you"`, `"Start investigation" runs without a "connect the VPN" or "sign in" warning`],
    needs: `**You'll need:** Chrome, your Shipsy Google account, and the Cisco AnyConnect "ril" VPN for Reliance tickets. No DevRev, GitHub, log or database passwords — admins set those up.`,
    questions: "Questions? Reply to this email or ask **{addedBy}**.",
  };
}

/** The saved template (edited in Admin), or the default. */
export function welcomeTemplate(): { template: WelcomeTemplate; custom: boolean } {
  try {
    if (existsSync(TEMPLATE_FILE)) return { template: { ...defaultWelcomeTemplate(), ...JSON.parse(readFileSync(TEMPLATE_FILE, "utf8")) }, custom: true };
  } catch { /* broken file → default */ }
  return { template: defaultWelcomeTemplate(), custom: false };
}

const str = (v: unknown, max: number) => String(v ?? "").replace(/\r/g, "").slice(0, max);
/** Clean up a template from the editor: known fields only, sane lengths, at most 12 steps. */
export function cleanTemplate(t: Partial<WelcomeTemplate>): WelcomeTemplate {
  const d = defaultWelcomeTemplate();
  const steps = (Array.isArray(t.steps) ? t.steps : d.steps).slice(0, 12).map((x) => x.auto === "connector" ? { title: "Install the Connector", time: "", text: "", sub: [] as string[], auto: "connector" as const, tag: undefined, button: undefined } : ({
    title: str(x.title, 120).trim(), time: str(x.time, 30).trim(), tag: str(x.tag, 40).trim() || undefined, text: str(x.text, 1500).trim(),
    sub: (Array.isArray(x.sub) ? x.sub : []).map((y) => str(y, 400).trim()).filter(Boolean).slice(0, 12),
    button: Array.isArray(x.button) && str(x.button[0], 60).trim() && str(x.button[1], 500).trim() ? [str(x.button[0], 60).trim(), str(x.button[1], 500).trim()] as [string, string] : undefined,
  })).filter((x) => x.title || x.text || x.auto);
  if (!steps.length) throw new Error("Keep at least one step");
  if (steps.filter((x) => x.auto).length > 1) throw new Error("The automatic Connector step can only be in once");
  for (const x of steps) if (x.button && !/^(https?:\/\/|\{app\})/.test(x.button[1])) throw new Error(`The button link in "${x.title}" must start with https:// or {app}`);
  const subject = str(t.subject, 150).replace(/\n/g, " ").trim();
  if (!subject) throw new Error("The subject can't be empty");
  return {
    theme: t.theme && t.theme in EMAIL_THEMES ? t.theme : "clean",
    subject, heading: str(t.heading, 150).trim() || d.heading, subheading: str(t.subheading, 300).trim(), intro: str(t.intro, 2000).trim(),
    buttonLabel: str(t.buttonLabel, 60).trim() || d.buttonLabel, stepsTitle: str(t.stepsTitle, 80).trim(),
    steps: steps.map((x) => ({ ...x, sub: x.sub.length ? x.sub : undefined })),
    readyTitle: str(t.readyTitle, 80).trim(), ready: (Array.isArray(t.ready) ? t.ready : []).map((y) => str(y, 300).trim()).filter(Boolean).slice(0, 10),
    needs: str(t.needs, 1000).trim(), questions: str(t.questions, 500).trim(),
  };
}

export async function saveWelcomeTemplate(t: WelcomeTemplate | null, by: string) {
  if (t) writeFileSync(TEMPLATE_FILE, JSON.stringify(t, null, 2) + "\n", { mode: 0o600 });
  else rmSync(TEMPLATE_FILE, { force: true });
  await savePrivate(TEMPLATE_FILE, by);
}

interface Person { name: string; username: string; email: string; admin: boolean; addedBy: string; appUrl: string; hasPassword: boolean }

/**
 * The welcome mail: who added them, how to sign in, and the onboarding steps that make investigations work.
 * Email-safe HTML (tables + inline styles). The <style> block only adds polish — a gentle fade-in of the cards and a
 * hover on buttons — in clients that support it (Apple Mail, iOS, Outlook for Mac); everything is fully visible without it.
 */
export function welcomeEmail(o: Person, tpl: WelcomeTemplate = welcomeTemplate().template) {
  const app = o.appUrl.replace(/\/+$/, "");
  const vars: Record<string, string> = {
    first: o.name.split(/\s+/)[0] || o.username, name: o.name || o.username, email: o.email, username: o.username,
    addedBy: o.addedBy, role: o.admin ? "an admin" : "a member", app, steps: String(tpl.steps.length),
    signIn: o.hasPassword
      ? `click Sign in with Google, using ${o.email}. You can also use the username "${o.username}" and the password ${o.addedBy} shares with you separately.`
      : `click Sign in with Google, using ${o.email}.`,
  };
  const fill = (v: string) => v.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
  const plain = (v: string) => fill(v).replace(/\*\*(.+?)\*\*/g, "$1");
  // Escaped, then **bold** and chrome://… as code — nothing else from the template becomes HTML.
  const c = EMAIL_THEMES[tpl.theme ?? "clean"] ?? EMAIL_THEMES.clean;
  const rich = (v: string, strong: string = c.ink) => esc(fill(v))
    .replace(/\*\*(.+?)\*\*/g, `<b style="font-weight:800;color:${strong}">$1</b>`)
    .replace(/chrome:\/\/[a-z-]+/g, (m) => `<code style="background:${c.code};padding:1px 5px;border-radius:4px;font-size:12px">${m}</code>`);
  const url = (v: string) => fill(v);
  const steps = tpl.steps.map((st) => (st.auto === "connector" ? connectorStep() : st));

  const text = [
    `${plain(tpl.heading)}`, "",
    plain(tpl.intro), "",
    `${plain(tpl.buttonLabel)}: ${app}`, "",
    ...(tpl.stepsTitle ? [plain(tpl.stepsTitle).toUpperCase(), ""] : []),
    ...steps.flatMap((st, i) => [
      `${i + 1}. ${plain(st.title)}${st.tag ? ` (${plain(st.tag)})` : ""}`,
      `   ${plain(st.text)}`,
      ...(st.sub ?? []).map((x, j) => `   ${String.fromCharCode(97 + j)}) ${plain(x)}`),
      ...(st.button ? [`   → ${url(st.button[1])}`] : []), "",
    ]),
    ...(tpl.ready.length ? [plain(tpl.readyTitle).toUpperCase(), ...tpl.ready.map((r) => `   ✓ ${plain(r)}`), ""] : []),
    ...(tpl.needs ? [plain(tpl.needs), ""] : []),
    ...(tpl.questions ? [plain(tpl.questions), ""] : []),
    "— Dev Resolve",
  ].join("\n");

  const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
  const btn = (label: string, href: string, big = false) =>
    `<a class="dr-btn" href="${esc(href)}" style="display:inline-block;background:${c.accent};color:#ffffff;text-decoration:none;font-weight:600;border-radius:8px;${big ? "padding:13px 26px;font-size:15px" : "padding:8px 14px;font-size:13px"}">${esc(label)}${big ? "" : " &rarr;"}</a>`;
  const chip = (t: string, warm = false) =>
    `<span style="display:inline-block;margin-left:6px;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:600;vertical-align:middle;${warm ? "background:#fef3c7;color:#92400e" : "background:${c.chip};color:${c.accentDark}"}">${esc(t)}</span>`;
  const stepCard = (st: Step, i: number) => `
<tr><td class="dr-step" style="padding:0 0 12px 0;animation-delay:${(0.15 + i * 0.12).toFixed(2)}s">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${c.line};border-radius:12px;background:#ffffff">
    <tr>
      <td width="56" valign="top" style="padding:16px 0 16px 16px">
        <div style="width:34px;height:34px;line-height:34px;border-radius:50%;background:${c.accent};color:#ffffff;text-align:center;font-weight:700;font-size:15px">${i + 1}</div>
      </td>
      <td valign="top" style="padding:16px 18px 16px 12px">
        <div style="font-size:16px;font-weight:700;color:${c.text}">${esc(plain(st.title))}${st.tag ? chip(plain(st.tag), /reliance|only/i.test(st.tag)) : ""}${st.time ? `<span style="float:right;font-size:12px;color:${c.faint};font-weight:500">&#9201; ${esc(st.time)}</span>` : ""}</div>
        ${st.text ? `<div style="margin-top:6px;font-size:14px;line-height:1.6;color:${c.body}">${rich(st.text)}</div>` : ""}
        ${st.sub?.length ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:10px;width:100%;background:${c.soft};border-radius:8px">${st.sub.map((x, j) => `
          <tr><td width="28" valign="top" style="padding:7px 0 7px 12px;font-size:13px;font-weight:700;color:${c.accent}">${String.fromCharCode(97 + j)}</td>
              <td style="padding:7px 12px 7px 0;font-size:13px;line-height:1.5;color:${c.body}">${rich(x)}</td></tr>`).join("")}
        </table>` : ""}
        ${st.button ? `<div style="margin-top:12px">${btn(plain(st.button[0]), url(st.button[1]))}</div>` : ""}
      </td>
    </tr>
  </table>
</td></tr>`;

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  @keyframes drUp { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
  .dr-step { animation: drUp .6s ease-out both }
  .dr-hero { animation: drUp .5s ease-out both }
  .dr-btn { transition: background .2s, transform .2s }
  .dr-btn:hover { background: ${c.accentDark} !important; transform: translateY(-1px) }
  @media (prefers-reduced-motion: reduce) { .dr-step, .dr-hero { animation: none } }
  @media (max-width: 560px) { .dr-pad { padding-left: 16px !important; padding-right: 16px !important } }
</style></head>
<body style="margin:0;padding:0;background:${c.page}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.page};font-family:${font}">
<tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px">

  <tr><td class="dr-hero" style="background:${c.heroBg};background-image:${c.heroImage};border-radius:16px 16px 0 0;padding:28px 28px 26px;${c.heroBar ? `border:1px solid ${c.line};border-bottom:0;border-top:5px solid ${c.heroBar}` : ""}">
    <table role="presentation" cellpadding="0" cellspacing="0"><tr>
      <td style="width:44px;height:44px;background:${c.logoBg};border-radius:10px;text-align:center;font-weight:800;color:${c.logoText};font-size:16px">DR</td>
      <td style="padding-left:12px;color:${c.brand};font-size:13px;font-weight:600;letter-spacing:.04em;text-transform:uppercase">Dev Resolve</td>
    </tr></table>
    <div style="margin-top:18px;color:${c.heroText};font-size:24px;font-weight:700;line-height:1.3">${rich(tpl.heading, c.heroText)}</div>
    ${tpl.subheading ? `<div style="margin-top:6px;color:${c.heroSub};font-size:14px">${rich(tpl.subheading, c.heroText)}</div>` : ""}
  </td></tr>

  <tr><td class="dr-pad" style="background:#ffffff;padding:24px 28px 8px;border-left:1px solid ${c.line};border-right:1px solid ${c.line}">
    ${tpl.intro ? `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:${c.text}">${rich(tpl.intro)}</p>` : ""}
    <p style="margin:0 0 6px">${btn(plain(tpl.buttonLabel), app, true)}</p>
  </td></tr>

  <tr><td class="dr-pad" style="background:#ffffff;padding:18px 28px 10px;border-left:1px solid ${c.line};border-right:1px solid ${c.line}">
    ${tpl.stepsTitle ? `<div style="font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${c.accent};margin-bottom:12px">${esc(plain(tpl.stepsTitle))}</div>` : ""}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${steps.map(stepCard).join("")}</table>
  </td></tr>

  ${tpl.ready.length ? `<tr><td class="dr-pad" style="background:#ffffff;padding:6px 28px 22px;border-left:1px solid ${c.line};border-right:1px solid ${c.line}">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.soft};border-radius:12px">
      <tr><td style="padding:16px 18px">
        ${tpl.readyTitle ? `<div style="font-size:14px;font-weight:700;color:${c.text};margin-bottom:8px">${esc(plain(tpl.readyTitle))}</div>` : ""}
        ${tpl.ready.map((r) => `<div style="font-size:14px;line-height:1.5;color:${c.body};padding:3px 0"><span style="color:${c.accent};font-weight:700">&#10003;</span>&nbsp; ${rich(r)}</div>`).join("")}
      </td></tr>
    </table>
  </td></tr>` : ""}

  <tr><td class="dr-pad" style="background:#ffffff;border:1px solid ${c.line};border-top:0;border-radius:0 0 16px 16px;padding:0 28px 24px">
    ${tpl.needs ? `<p style="margin:0 0 10px;font-size:13px;line-height:1.6;color:${c.muted}">${rich(tpl.needs, "${c.body}")}</p>` : ""}
    ${tpl.questions ? `<p style="margin:0;font-size:13px;line-height:1.6;color:${c.muted}">${rich(tpl.questions, "${c.text}")}</p>` : ""}
  </td></tr>

  <tr><td align="center" style="padding:16px;font-size:12px;color:${c.faint}">Sent by Dev Resolve because an admin added you. Passwords are never sent by email.</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
  return { subject: plain(tpl.subject), text, html };
}
