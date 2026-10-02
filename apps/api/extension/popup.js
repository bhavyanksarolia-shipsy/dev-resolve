const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const ago = (t) => { if (!t) return "never"; const s = Math.round((Date.now() - t) / 1000); return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };

function render(s) {
  if (!s || s.error) { $("verdict").className = "verdict bad"; $("verdict").textContent = "Couldn't read the extension's status — reload it in chrome://extensions."; return; }
  $("ver").textContent = `connector · v${s.version}`;
  $("open").href = s.app; $("conn").href = `${s.app}/connector`;
  const hosts = Object.entries(s.vpn || {});
  const vpnUp = hosts.length > 0 && hosts.every(([, ok]) => ok);
  const signed = (s.signins || []).filter((x) => x.ok).length, total = (s.signins || []).length;

  const state = !s.linked ? "warn" : s.connecting && !s.connected ? "warn" : !s.connected ? "bad" : !hosts.length || !vpnUp || signed < total ? "warn" : "ok";
  const pill = $("pill"); pill.className = `pill ${state === "ok" ? "" : state}`;
  pill.lastElementChild.textContent = !s.linked ? "Not linked" : s.connected ? "Connected" : s.connecting ? "Connecting…" : "Offline";

  const v = $("verdict"); v.className = `verdict ${state}`;
  v.innerHTML = !s.linked ? "<b>Not linked yet</b>Open the Connector page while signed in — it links itself."
    : !s.connected && s.connecting ? "<b>Connecting to Dev Resolve…</b>This takes a few seconds after Chrome starts."
    : !s.connected ? `<b>Can't reach Dev Resolve</b>${esc(s.lastError || "Check your internet connection.")}`
    : !hosts.length ? "<b>Checking the company VPN…</b>One moment."
    : !vpnUp ? "<b>Connect the company VPN</b>VPN-only systems aren't reachable from this laptop."
    : signed < total ? `<b>${total - signed} sign-in${total - signed > 1 ? "s" : ""} missing</b>Sign in on the Connector page.`
    : "<b>You're all set</b>Investigations can use your VPN and your sign-ins.";

  const row = (dot, k, val, sub) => `<li><span class="dot ${dot}"></span><span class="k">${esc(k)}${sub ? `<span class="sub">${esc(sub)}</span>` : ""}</span><span class="v">${esc(val)}</span></li>`;
  $("rows").innerHTML = [
    row(s.linked ? "ok" : "wait", "Account", s.linked ? s.user || "linked" : "not linked"),
    row(s.connected ? "ok" : s.connecting ? "wait" : "bad", "Dev Resolve", s.connected ? "connected" : s.connecting ? "connecting…" : "offline", new URL(s.server).host),
    row(!hosts.length ? "wait" : vpnUp ? "ok" : "bad", "Company VPN", hosts.length ? `${hosts.filter(([, ok]) => ok).length} of ${hosts.length} reachable` : "checking…"),
    row(!total ? "wait" : signed === total ? "ok" : "bad", "Google sign-ins", total ? `${signed} of ${total}` : "—", (s.signins || []).filter((x) => !x.ok).map((x) => x.label).join(", ")),
  ].join("");
  $("seen").textContent = `Last contact: ${ago(s.lastOk)}`;
}

const load = () => chrome.runtime.sendMessage({ type: "status" }, render);
$("recheck").addEventListener("click", () => { $("recheck").textContent = "Checking…"; chrome.runtime.sendMessage({ type: "recheck" }, () => setTimeout(() => { load(); $("recheck").textContent = "Re-check"; }, 1500)); });
load();
setInterval(load, 3000);
