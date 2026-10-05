import "server-only";
import nodemailer from "nodemailer";
import { adminSetting } from "./config";
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
      const p = await gmailApi("profile");
      return { ok: true, message: `Connected to Gmail as ${p.emailAddress ?? s.gmailSender}` };
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

/** The welcome mail: who added them, how to sign in, and the onboarding steps that make investigations work. */
export function welcomeEmail(o: { name: string; username: string; email: string; admin: boolean; addedBy: string; appUrl: string; hasPassword: boolean }) {
  const app = o.appUrl.replace(/\/+$/, "");
  const first = o.name.split(/\s+/)[0] || o.username;
  const signIn = o.hasPassword
    ? `Sign in with Google (${o.email}), or with username "${o.username}" and the password ${o.addedBy} shares with you separately.`
    : `Sign in with Google, using ${o.email}.`;
  const steps: [string, string][] = [
    ["Sign in", `Open ${app} and ${signIn.charAt(0).toLowerCase()}${signIn.slice(1)}`],
    ["Pick your Pods", `Top right, "My Pods": tick your team's Pods (e.g. WMS Inbound / WMS Outbound). Tick "No Pod" too if you want new, untriaged tickets.`],
    ["Add the Connector", `Open ${app}/connector and click "Add to Chrome" (once per laptop), then come back to that page. It lets investigations reach systems that are only on the client VPN, through your own laptop.`],
    ["Sign in to the tools", `On the Connector page, click "Sign in to all missing" (app logs and the Google-login Metabase instances). Investigations use your own sign-ins.`],
    ["Connect the VPN for Reliance", `Before investigating Reliance tickets (VF, QC, JioMart 3P), connect the Cisco AnyConnect "ril" profile.`],
    ["Investigate a ticket", `Tickets → open a ticket → "Start investigation". You can add what you already know (order, warehouse, screenshots) — the agent checks it against logs, database and code. Review the RCA, ask follow-ups in Chat, then post it to DevRev's internal discussion.`],
  ];
  const ready = `You're ready when the status line at the top says "All connections OK" and "Start investigation" runs without a "connect the VPN" or "sign in" warning.`;
  const text = [
    `Hi ${first},`, "",
    `${o.addedBy} added you to Dev Resolve as ${o.admin ? "an admin" : "a member"}. Dev Resolve investigates DevRev support tickets — it searches the client's logs, database and code and drafts an evidence-based RCA for you to review.`, "",
    "Getting started:",
    ...steps.map(([t, d], i) => `${i + 1}. ${t} — ${d}`), "",
    ready, "",
    "You'll need: Chrome, your Shipsy Google account, and the Cisco AnyConnect \"ril\" VPN for Reliance tickets. No DevRev, GitHub, log or database passwords — those are set up by admins.", "",
    `Questions? Reply to this email or ask ${o.addedBy}.`, "",
    "— Dev Resolve",
  ].join("\n");
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#14251c;max-width:600px">
<div style="background:#15803d;color:#fff;padding:18px 22px;border-radius:12px 12px 0 0"><b style="font-size:17px">Welcome to Dev Resolve</b></div>
<div style="border:1px solid #dfe9e2;border-top:0;border-radius:0 0 12px 12px;padding:20px 22px">
<p>Hi ${esc(first)},</p>
<p><b>${esc(o.addedBy)}</b> added you to Dev Resolve as <b>${o.admin ? "an admin" : "a member"}</b>. Dev Resolve investigates DevRev support tickets — it searches the client's logs, database and code and drafts an evidence-based RCA for you to review.</p>
<p style="margin:18px 0"><a href="${esc(app)}" style="background:#15803d;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600;display:inline-block">Open Dev Resolve</a></p>
<p style="margin-bottom:6px"><b>Getting started</b></p>
<ol style="padding-left:20px;margin-top:0">${steps.map(([t, d]) => `<li style="margin-bottom:8px"><b>${esc(t)}</b> — ${esc(d)}</li>`).join("")}</ol>
<p style="background:#eef7f1;border-radius:8px;padding:10px 12px">${esc(ready)}</p>
<p style="color:#5b6b62;font-size:13px">You'll need: Chrome, your Shipsy Google account, and the Cisco AnyConnect "ril" VPN for Reliance tickets. No DevRev, GitHub, log or database passwords — admins set those up.</p>
<p style="color:#5b6b62;font-size:13px">Questions? Reply to this email or ask ${esc(o.addedBy)}.</p>
</div></div>`;
  return { subject: "You've been added to Dev Resolve", text, html };
}
