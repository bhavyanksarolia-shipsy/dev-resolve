import "server-only";
import nodemailer from "nodemailer";
import { adminSetting } from "./config";

/**
 * Outgoing email (welcome mails) through an SMTP mailbox — by default a Google Workspace account with an App Password.
 * Set in Admin → Connections → Email (saved like the other credentials; server variables are the fallback).
 */
export function mailSettings() {
  const user = adminSetting("SMTP_USER") || "";
  return {
    host: adminSetting("SMTP_HOST") || "smtp.gmail.com",
    port: Number(adminSetting("SMTP_PORT") || 465),
    user,
    pass: adminSetting("SMTP_PASS") || "",
    fromName: adminSetting("SMTP_FROM_NAME") || "Dev Resolve",
    configured: !!(user && adminSetting("SMTP_PASS")),
  };
}

function transport() {
  const s = mailSettings();
  if (!s.configured) throw new Error("Email isn't set up — Admin → Connections → Email");
  return nodemailer.createTransport({ host: s.host, port: s.port, secure: s.port === 465, auth: { user: s.user, pass: s.pass }, connectionTimeout: 15000 });
}

/** Signs in to the mailbox without sending anything. */
export async function checkMail(): Promise<{ ok: boolean; message: string }> {
  const s = mailSettings();
  if (!s.configured) return { ok: false, message: "Not set up — add the sending address and its App Password" };
  try {
    await transport().verify();
    return { ok: true, message: `Signed in to ${s.host} as ${s.user}` };
  } catch (e) {
    const m = (e as Error).message;
    return { ok: false, message: /535|Username and Password not accepted|Invalid login/i.test(m)
      ? "Google refused the sign-in — use an App Password (Google account → Security → 2-Step Verification → App passwords), not the normal password"
      : m.slice(0, 200) };
  }
}

export async function sendMail(m: { to: string; subject: string; text: string; html: string; replyTo?: string }) {
  const s = mailSettings();
  await transport().sendMail({ from: `"${s.fromName}" <${s.user}>`, to: m.to, subject: m.subject, text: m.text, html: m.html, ...(m.replyTo && { replyTo: m.replyTo }) });
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
