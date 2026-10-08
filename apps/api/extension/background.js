// Dev Resolve connector — Chrome extension (Manifest V3 service worker).
// While Chrome is open it (1) carries the signed-in person's VPN-only requests from this laptop (on the client VPN, and the
// Claude gateway on the company VPN when Dev Resolve is set up that way) and (2) keeps that person's Google-login Metabase / app-logs sessions synced to Dev Resolve. Nothing else.
// config.json (written by the server when you downloaded this) holds the Dev Resolve addresses.
const VERSION = chrome.runtime.getManifest().version;
let cfg = null;               // { server, app }
let loopRunning = false;
let vpn = {};
let hello = null, helloAt = 0;
// Contact state survives the worker being restarted by Chrome (chrome.storage.session lasts for the browser session).
let lastOk = 0, lastError = null, polling = false;
const startedAt = Date.now();
const markOk = () => { lastOk = Date.now(); lastError = null; chrome.storage.session.set({ lastOk, lastError: null }); };
const markErr = (m) => { lastError = m; chrome.storage.session.set({ lastError: m }); };
chrome.storage.session.get(["lastOk", "lastError", "hello", "vpn"]).then((s) => {
  if (s.vpn && !Object.keys(vpn).length) vpn = s.vpn;
  if (s.lastOk > lastOk) lastOk = s.lastOk;
  if (!hello && s.hello) hello = s.hello;
});

const store = {
  get: async (k) => (await chrome.storage.local.get(k))[k],
  set: (k, v) => chrome.storage.local.set({ [k]: v }),
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b64 = (buf) => { let s = ""; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s) => Uint8Array.from(atob(s || ""), (c) => c.charCodeAt(0));

async function config() {
  if (!cfg) cfg = await (await fetch(chrome.runtime.getURL("config.json"))).json();
  return cfg;
}

async function api(path, { method = "GET", body, headers = {}, timeout = 40000 } = {}) {
  const token = await store.get("token");
  if (!token) throw Object.assign(new Error("not linked"), { code: "NO_TOKEN" });
  const r = await fetch((await config()).server + path, {
    method, signal: AbortSignal.timeout(timeout),
    headers: { Authorization: `Bearer ${token}`, "x-connector-version": `ext-${VERSION}`, ...(body && { "Content-Type": "application/json" }), ...headers },
    body: body && JSON.stringify(body),
  });
  if (r.status === 401) {
    // Forget the token only if it's still the one that was rejected (a newer one may have just been linked).
    if ((await store.get("token")) === token) await store.set("token", null);
    throw Object.assign(new Error("token rejected"), { code: "NO_TOKEN" });
  }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

// ── VPN relay ──────────────────────────────────────────────────────────────────────────────────────────────
// The Claude gateway (e.g. Bifrost on the company VPN), when Dev Resolve sends the agent's requests through here: only
// the exact host Dev Resolve names, and only if this extension's own permissions (fixed when it was installed) cover it.
const permitted = (u) => (chrome.runtime.getManifest().host_permissions || []).some((p) => {
  try { const m = new URL(p.replace("*.", "")); return m.protocol === u.protocol && (p.includes("*.") ? u.hostname.endsWith(`.${m.hostname}`) : u.hostname === m.hostname); } catch { return false; }
});
async function allowed(url) {
  const pinned = (await store.get("allowSuffixes")) || [];
  try {
    const u = new URL(url), host = u.hostname.toLowerCase();
    if (!["https:", "http:"].includes(u.protocol)) return false;
    return pinned.some((s) => host.endsWith(s)) || ((hello?.gatewayHosts || []).includes(host) && permitted(u));
  } catch { return false; }
}

async function doRequest(req) {
  if (!["GET", "POST"].includes(req.method)) throw new Error(`method ${req.method} not allowed`);
  if (!(await allowed(req.url))) throw new Error(`host not allowed by this extension: ${new URL(req.url).hostname}`);
  const headers = { ...req.headers };
  for (const h of Object.keys(headers)) if (/^(host|content-length|connection)$/i.test(h)) delete headers[h];
  try {
    const r = await fetch(req.url, {
      method: req.method, headers, credentials: "omit", redirect: "manual",
      body: req.body_b64 ? unb64(req.body_b64) : undefined,
      signal: AbortSignal.timeout(Math.min(req.timeout_ms || 30000, 600000)), // Claude answers can take minutes
    });
    return { status: r.status, headers: { "content-type": r.headers.get("content-type") || "" }, body_b64: b64(await r.arrayBuffer()) };
  } catch (e) {
    const g = vpnGroupsOf(hello).find((x) => x.hosts.includes(new URL(req.url).host));
    throw new Error(`${e.name === "TimeoutError" ? "timed out" : e.message} — is ${g ? `${g.name}${g.app ? ` (${g.app})` : ""}` : "the VPN"} connected on this laptop?`);
  }
}

// Two different VPNs: the client's (Cisco AnyConnect) and the company's (Pritunl, for the Claude gateway) — Dev Resolve
// names them in hello.vpns; older servers only send vpnHosts (the client VPN).
const vpnGroupsOf = (h) => h?.vpns || (h?.vpnHosts?.length ? [{ id: "client", name: "Client VPN", app: "", purpose: "", hosts: h.vpnHosts }] : []);
const vpnCheckHosts = (h) => [...new Set(vpnGroupsOf(h).flatMap((g) => g.hosts))];

async function checkVpn(hosts) {
  const next = {};
  await Promise.all(hosts.map(async (h) => {
    try { await fetch(`https://${h}/`, { method: "HEAD", mode: "no-cors", credentials: "omit", signal: AbortSignal.timeout(5000) }); next[h] = true; }
    catch { next[h] = false; }
  }));
  vpn = next;
  chrome.storage.session.set({ vpn });
  const ok = hosts.length > 0 && Object.values(vpn).every(Boolean);
  chrome.action.setBadgeText({ text: ok ? "" : "VPN" });
  chrome.action.setBadgeBackgroundColor({ color: "#b91c1c" });
}

// ── Google sign-ins ────────────────────────────────────────────────────────────────────────────────────────
async function syncMetabase(m, { openIfMissing }) {
  if (!/^https?:\/\//.test(m.baseUrl || "")) return false; // server config has no address for it (yet)
  const c = await chrome.cookies.get({ url: m.baseUrl, name: "metabase.SESSION" });
  if (c?.value) {
    await api("/api/connector/signin", { method: "POST", body: { kind: "metabase", project: m.project, session: c.value } });
    return true;
  }
  if (openIfMissing) {
    const t = await chrome.tabs.create({ url: `${m.baseUrl.replace(/\/$/, "")}/auth/login`, active: true });
    await store.set("openedTabs", [...((await store.get("openedTabs")) || []).slice(-20), t.id]);
  }
  return false; // the cookie listener below uploads it once they've signed in
}

// Whenever the person signs in to one of the Google-login Metabase instances in Chrome, keep Dev Resolve in sync.
chrome.cookies.onChanged.addListener(async ({ cookie, removed }) => {
  if (removed || cookie.name !== "metabase.SESSION" || !hello) return;
  const m = hello.signins.metabase.find((x) => new URL(x.baseUrl).hostname.endsWith(cookie.domain.replace(/^\./, "")));
  if (!m) return;
  await api("/api/connector/signin", { method: "POST", body: { kind: "metabase", project: m.project, session: cookie.value } }).catch(() => {});
  // Close the sign-in tab we opened, if it's sitting on that Metabase now.
  const tabs = await chrome.tabs.query({ url: `${new URL(m.baseUrl).origin}/*` });
  for (const t of tabs) if ((await store.get("openedTabs") || []).includes(t.id)) chrome.tabs.remove(t.id).catch(() => {});
});

let appLogFlow = null;
async function signInAppLogs(info) {
  const meta = await (await fetch(new URL("/.well-known/oauth-authorization-server", info.gateway))).json();
  const verifier = b64(crypto.getRandomValues(new Uint8Array(32))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const challenge = b64(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const state = b64(crypto.getRandomValues(new Uint8Array(16))).replace(/[^a-zA-Z0-9]/g, "");
  const redirect = `http://localhost:${info.callbackPort}/oauth/callback`;
  const url = new URL(meta.authorization_endpoint);
  url.search = new URLSearchParams({ response_type: "code", client_id: info.clientId, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: "S256", state, scope: "openid profile email" }).toString();
  const tab = await chrome.tabs.create({ url: url.toString(), active: true });
  appLogFlow = { tabId: tab.id, redirect, state, verifier, tokenEndpoint: meta.token_endpoint, clientId: info.clientId };
}

// The sign-in ends by sending the tab to localhost/oauth/callback?code=… — read the code there (nothing listens on it).
chrome.tabs.onUpdated.addListener(async (tabId, change) => {
  const f = appLogFlow;
  if (!f || tabId !== f.tabId || !change.url?.startsWith(f.redirect)) return;
  appLogFlow = null;
  chrome.tabs.remove(tabId).catch(() => {});
  const u = new URL(change.url);
  if (u.searchParams.get("state") !== f.state || !u.searchParams.get("code")) return;
  const r = await fetch(f.tokenEndpoint, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: f.clientId, code: u.searchParams.get("code"), redirect_uri: f.redirect, code_verifier: f.verifier }),
  });
  const tokens = await r.json();
  if (r.ok) await api("/api/connector/signin", { method: "POST", body: { kind: "app_log", tokens } }).catch(() => {});
});

async function doSignins(h, only) {
  for (const m of h.signins.metabase) {
    if (only ? only.includes(m.project) : !m.signedIn) await syncMetabase(m, { openIfMissing: !!only }).catch(() => {});
  }
  const a = h.signins.appLog;
  if (a && (only ? only.includes("app_log") : false)) await signInAppLogs(a).catch(() => {});
}

// ── main loop (kept alive by its own activity + a 1-minute alarm) ─────────────────────────────────────────
async function loop() {
  if (loopRunning) return;
  loopRunning = true;
  try {
    for (let backoff = 2000; ;) {
      await chrome.storage.session.set({ alive: Date.now() }); // extension API call → keeps the worker awake
      try {
        if (!hello || Date.now() - helloAt > 10 * 60e3) {
          hello = await api("/api/connector/hello"); helloAt = Date.now(); markOk();
          chrome.storage.session.set({ hello });
          if (!(await store.get("allowSuffixes"))) await store.set("allowSuffixes", hello.allowSuffixes);
          await store.set("user", hello.user);
          await checkVpn(vpnCheckHosts(hello));
          await doSignins(hello); // silently picks up existing Metabase sign-ins
        }
        polling = true;
        const { jobs, signin } = await api("/api/connector/poll", { headers: { "x-connector-vpn": JSON.stringify(vpn) }, timeout: 35000 }).finally(() => { polling = false; });
        backoff = 2000; markOk();
        if (signin?.length) api("/api/connector/hello").then((h) => { hello = h; return doSignins(h, signin); }).catch(() => {});
        for (const job of jobs) {
          doRequest(job.req)
            .then((res) => api("/api/connector/result", { method: "POST", body: { id: job.id, ok: true, res } }))
            .catch((e) => api("/api/connector/result", { method: "POST", body: { id: job.id, ok: false, error: e.message } }).catch(() => {}));
        }
      } catch (e) {
        markErr(e.code === "NO_TOKEN" ? "not linked" : e.message);
        if (e.code === "NO_TOKEN") { chrome.action.setBadgeText({ text: "!" }); chrome.action.setBadgeBackgroundColor({ color: "#b45309" }); return; }
        await sleep(backoff); backoff = Math.min(backoff * 2, 30000);
      }
    }
  } finally {
    loopRunning = false;
  }
}

chrome.alarms.create("keepalive", { periodInMinutes: 1 });
chrome.alarms.create("vpn", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "keepalive") loop();
  if (a.name === "vpn" && hello) checkVpn(vpnCheckHosts(hello));
});
chrome.runtime.onStartup.addListener(loop);
chrome.runtime.onInstalled.addListener(async () => {
  // First install: open Dev Resolve's Connector page — it links this extension to the signed-in person.
  if (!(await store.get("token"))) chrome.tabs.create({ url: `${(await config()).app}/connector?link=extension` });
  loop();
});

// Messages from the Connector page (via content.js) and from the popup.
chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  (async () => {
    if (msg.type === "link" && typeof msg.token === "string" && msg.token.startsWith("drc_")) {
      await store.set("token", msg.token); hello = null; chrome.action.setBadgeText({ text: "" });
      loop();
      return { ok: true };
    }
    if (msg.type === "status") {
      const c = await config();
      const s = hello?.signins;
      return {
        version: VERSION, linked: !!(await store.get("token")), user: await store.get("user"), vpn, vpns: vpnGroupsOf(hello), server: c.server, app: c.app,
        // Connected = heard from Dev Resolve in the last minute, or a request to it is open right now without errors.
        connected: Date.now() - lastOk < 60000 || (polling && !lastError),
        connecting: !lastError && Date.now() - startedAt < 45000 && Date.now() - lastOk >= 60000,
        lastOk, lastError,
        signins: s ? [...s.metabase.map((m) => ({ label: `Metabase · ${m.project}`, ok: m.signedIn })), ...(s.appLog ? [{ label: "App logs", ok: s.appLog.signedIn }] : [])] : [],
      };
    }
    if (msg.type === "recheck") {
      hello = await api("/api/connector/hello").catch(() => hello); helloAt = Date.now();
      if (hello) await checkVpn(vpnCheckHosts(hello));
      loop();
      return { ok: true };
    }
    if (msg.type === "signin" && Array.isArray(msg.what)) { const h = await api("/api/connector/hello"); hello = h; await doSignins(h, msg.what); return { ok: true }; }
    return { error: "unknown message" };
  })().then(reply, (e) => reply({ error: e.message }));
  return true;
});

loop();
