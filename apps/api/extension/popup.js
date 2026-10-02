chrome.runtime.sendMessage({ type: "status" }, (s) => {
  const el = document.getElementById("s");
  if (!s || s.error) { el.textContent = "Couldn't read status"; return; }
  const hosts = Object.entries(s.vpn || {});
  const up = hosts.length && hosts.every(([, ok]) => ok);
  el.innerHTML = `<div><b>Dev Resolve connector</b> v${s.version}</div>` +
    (s.linked ? `<div>Linked to <b>${s.user || "you"}</b></div>` : `<div class="bad">Not linked yet</div>`) +
    `<div class="${up ? "" : "bad"}">${hosts.length ? (up ? "VPN hosts reachable ✓" : "Can't reach VPN hosts — connect the VPN") : "VPN: checking…"}</div>` +
    `<p><a href="${s.app}/connector" target="_blank">Open the Connector page</a></p>`;
});
