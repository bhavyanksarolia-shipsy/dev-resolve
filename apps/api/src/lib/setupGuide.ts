import "server-only";
import { settings } from "./settings";

const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * "Dev Resolve — setup guide": a one-page HTML file attached to the welcome email. Everything a new person sets up, in
 * order, with what to check after each step and fixes for the usual problems. Opens in any browser; prints well.
 */
export function setupGuide(o: { appUrl: string; name?: string }) {
  const app = o.appUrl.replace(/\/+$/, "");
  const store = settings.extensionStoreUrl();
  const a = (href: string, label = href) => `<a href="${esc(href)}">${esc(label)}</a>`;
  const steps: { title: string; why: string; how: string[]; check: string }[] = [
    { title: "Sign in", why: "Your Dev Resolve account.",
      how: [`Open ${a(app)} and click <b>Sign in with Google</b> with your Shipsy account.`],
      check: "You see the Dashboard with your name at the top right." },
    { title: "Pick your Pods", why: "So the dashboard and ticket list show your team's tickets.",
      how: ["Click the <b>Pods</b> filter at the top right and tick your team's Pods (e.g. WMS Inbound, WMS Outbound)."],
      check: "The Tickets page lists your Pods' open tickets." },
    { title: "Install the Dev Resolve extension (Chrome)", why: "Investigations reach systems only your laptop can reach (the VPNs) and use your own sign-ins.",
      how: store
        ? [`Open ${a(store, "the extension in the Chrome Web Store")} and click <b>Add to Chrome</b>.`, `Open ${a(`${app}/connector`, "the Connector page")} — it links itself to you.`]
        : [`Open ${a(`${app}/connector`, "the Connector page")} and click <b>Download the extension</b>, then unzip it.`,
          "In Chrome go to <code>chrome://extensions</code> and switch on <b>Developer mode</b> (top right).",
          "Click <b>Load unpacked</b> and choose the unzipped folder.", "Go back to the Connector page — it links itself to you."],
      check: "Connector page: “Chrome extension — Running · linked to you”, and a green dot next to Connector in the menu." },
    { title: "Connect Pritunl (company VPN)", why: "Dev Resolve's Claude agent reaches Bifrost, the company's AI gateway, through the company VPN.",
      how: [`Download the Pritunl client from ${a("https://client.pritunl.com/", "client.pritunl.com")} and install it.`,
        "Import the Shipsy profile IT gave you (a <code>pritunl://</code> link or a <code>.tar</code> file) — ask IT if you don't have one.",
        "Click <b>Connect</b>, and keep it connected while you work."],
      check: "Connector page: “Company VPN · Pritunl — Connected”." },
    { title: "Connect Cisco AnyConnect (Reliance VPN)", why: "Only for Reliance tickets (VF, QC, JioMart 3P): their logs and databases are on Reliance's network.",
      how: ["Open Cisco AnyConnect and connect the <b>ril</b> profile before investigating Reliance tickets."],
      check: "Connector page: “Reliance client VPN · Cisco AnyConnect — Connected”." },
    { title: "Sign in to the tools (Google)", why: "Investigations use your own access to app logs and Metabase.",
      how: [`On ${a(`${app}/connector`, "the Connector page")}, open <b>Google sign-ins</b> and click <b>Sign in to all missing</b>. Pick your Shipsy account in each tab that opens — they close by themselves.`],
      check: "Google sign-ins: every connection has a green dot." },
    { title: "Add your Claude token (optional, recommended)", why: "If Bifrost isn't reachable, your investigations switch to your own Claude account on the spot instead of stopping.",
      how: ["You need a Claude subscription (Pro, Max or Team) and Claude Code on your laptop.",
        "In Terminal run <code>claude setup-token</code>, sign in to Claude in the browser that opens and click <b>Authorize</b>.",
        `Copy the token it prints (starts with <code>sk-ant-oat01-</code>) and paste it on ${a(`${app}/connector`, "the Connector page")} → <b>Your Claude token</b> → <b>Add your token</b>.`],
      check: "Your Claude token: “Working”." },
    { title: "Turn on notifications", why: "You get a pop-up and a sound when your RCA or chat reply is ready.",
      how: ["Click the bell at the top right → <b>Desktop notifications → Turn on</b>, then <b>Send a test notification</b>.",
        "No desktop pop-up on a Mac? System Settings → Notifications → Google Chrome → Allow notifications."],
      check: "The test shows a pop-up in the page and plays a short chime." },
    { title: "Investigate your first ticket", why: "",
      how: ["Open <b>Tickets</b>, pick a ticket and click <b>Investigate</b>. Add what you already know (order, warehouse, screenshots).",
        "Review the RCA, ask follow-ups in Chat, then post it to DevRev's internal discussion."],
      check: "The investigation finishes with a draft RCA and a confidence level." },
  ];
  const trouble: [string, string][] = [
    ["The dot next to Connector is grey", "Hover it to see what's missing — usually Chrome is closed, a VPN is off, or a Google sign-in expired (Connector page → Sign in again)."],
    ["“Login expired — sign in again” on a Google sign-in", "Click Sign in again next to it on the Connector page."],
    ["“Queued · 2nd · ~6 min”", "Several investigations are running; yours starts by itself and you get a notification when it's done."],
    ["“Your Metabase query limit … resets at …”", "You've used your Metabase queries for the hour — start the investigation again after the time shown."],
    ["“Claude connected to your personal account”", "Bifrost wasn't reachable, so your own Claude token took over. It switches back by itself."],
  ];
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dev Resolve — setup guide</title>
<style>
  :root{--ink:#0f1f16;--body:#35463c;--muted:#5b6b62;--line:#e3e8e5;--accent:#15803d;--soft:#f4f8f5}
  *{box-sizing:border-box} body{margin:0;background:#f4f6f5;color:var(--ink);font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif}
  main{max-width:760px;margin:0 auto;padding:32px 20px 48px}
  h1{font-size:26px;margin:0 0 4px} .sub{color:var(--muted);margin:0 0 24px}
  .step{background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px 20px;margin:0 0 14px;break-inside:avoid}
  .step h2{font-size:17px;margin:0;display:flex;gap:10px;align-items:center}
  .n{width:28px;height:28px;border-radius:50%;background:var(--accent);color:#fff;display:inline-grid;place-items:center;font-size:14px;flex:none}
  .why{color:var(--muted);margin:6px 0 8px} ol{margin:6px 0 10px;padding-left:22px;color:var(--body)} li{margin:3px 0}
  .check{background:var(--soft);border-radius:10px;padding:8px 12px;font-size:14px} .check b{color:var(--accent)}
  code{background:#eceff0;padding:1px 6px;border-radius:5px;font-size:13px} a{color:var(--accent)}
  table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line);border-radius:14px;overflow:hidden}
  td{padding:10px 14px;border-top:1px solid var(--line);vertical-align:top;font-size:14px} tr:first-child td{border-top:0} td:first-child{width:38%;font-weight:600}
  h3{margin:28px 0 10px} @media print{body{background:#fff} .step,table{border-color:#ccc}}
</style></head><body><main>
<h1>Dev Resolve — setup guide</h1>
<p class="sub">${o.name ? `For ${esc(o.name)} · ` : ""}About 15 minutes, once. Dev Resolve: ${a(app)}</p>
${steps.map((s, i) => `<section class="step"><h2><span class="n">${i + 1}</span>${esc(s.title)}</h2>
${s.why ? `<p class="why">${esc(s.why)}</p>` : ""}<ol>${s.how.map((h) => `<li>${h}</li>`).join("")}</ol>
<div class="check"><b>✓ Done when:</b> ${esc(s.check)}</div></section>`).join("\n")}
<h3>If something isn't working</h3>
<table>${trouble.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</table>
<p class="sub" style="margin-top:20px">Still stuck? Reply to your welcome email or ask the person who added you.</p>
</main></body></html>`;
  return { filename: "Dev Resolve - setup guide.html", content: html, contentType: "text/html; charset=utf-8" };
}
