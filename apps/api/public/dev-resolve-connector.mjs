#!/usr/bin/env node
// Dev Resolve local connector — runs on YOUR laptop (Node 22+, no install).
//
//   First time:  node dev-resolve-connector.mjs --server https://<dev-resolve> --token drc_…   (token: Connector page)
//   After that:  node dev-resolve-connector.mjs
//   Sign in again to everything:  node dev-resolve-connector.mjs --login
//
// What it does, and nothing else:
//   1. Client VPN: Dev Resolve's server can't join the client VPN, your laptop can. While this runs, your investigations' requests
//      to VPN-only hosts (and only those — the host list is pinned on first run, below) are carried out from this laptop.
//   2. Google sign-in: Metabase instances / app logs that use Google login are signed in HERE, in a Chrome window with
//      its own profile (~/.dev-resolve/chrome). Only the resulting session is sent to Dev Resolve, stored for you only.
//      Your Google password never leaves Google's page.
// Settings live in ~/.dev-resolve/connector.json (readable by you only). Stop with Ctrl+C.
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const VERSION = "1.0.0";
const HOME = path.join(os.homedir(), ".dev-resolve");
const CFG = path.join(HOME, "connector.json");
const PROFILE = process.env.DEV_RESOLVE_CHROME_PROFILE || path.join(HOME, "chrome");
const args = process.argv.slice(2);
const arg = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const log = (...m) => console.log(new Date().toLocaleTimeString(), ...m);

if (Number(process.versions.node.split(".")[0]) < 22) { console.error("Needs Node 22 or newer (you have " + process.version + ")."); process.exit(1); }

// ── settings ────────────────────────────────────────────────────────────────────────────────────────────────
mkdirSync(HOME, { recursive: true, mode: 0o700 });
let cfg = existsSync(CFG) ? JSON.parse(readFileSync(CFG, "utf8")) : {};
if (arg("--server")) cfg.server = arg("--server").replace(/\/+$/, "");
if (arg("--token")) cfg.token = arg("--token");
if (!cfg.server || !cfg.token) {
  console.error("First run: node dev-resolve-connector.mjs --server https://<dev-resolve> --token <token from the Connector page>");
  process.exit(1);
}
const save = () => writeFileSync(CFG, JSON.stringify(cfg, null, 2), { mode: 0o600 });
save();

async function api(pathname, { method = "GET", body, headers = {}, timeout = 40_000 } = {}) {
  const r = await fetch(cfg.server + pathname, {
    method, signal: AbortSignal.timeout(timeout),
    headers: { Authorization: `Bearer ${cfg.token}`, "x-connector-version": VERSION, ...(body && { "Content-Type": "application/json" }), ...headers },
    body: body && JSON.stringify(body),
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) { console.error("Dev Resolve rejected this connector token — make a new one on the Connector page and run with --token."); process.exit(1); }
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

// ── 1. VPN relay ──────────────────────────────────────────────────────────────────────────────────────────────
// The hosts this laptop will call on Dev Resolve's behalf are pinned the first time. If the server later asks for
// more, they are NOT allowed until you delete "allowSuffixes" from ~/.dev-resolve/connector.json.
function allowed(url) {
  try {
    const u = new URL(url);
    if (!["https:", "http:"].includes(u.protocol)) return false;
    return (cfg.allowSuffixes || []).some((s) => u.hostname.toLowerCase().endsWith(s));
  } catch { return false; }
}

function doRequest(req) {
  return new Promise((resolve, reject) => {
    if (!["GET", "POST"].includes(req.method)) return reject(new Error(`method ${req.method} not allowed`));
    if (!allowed(req.url)) return reject(new Error(`host not allowed by this connector: ${new URL(req.url).hostname}`));
    const u = new URL(req.url);
    const lib = u.protocol === "http:" ? http : https;
    const body = req.body_b64 ? Buffer.from(req.body_b64, "base64") : undefined;
    const r = lib.request({
      method: req.method, hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search,
      headers: { ...req.headers, ...(body && { "Content-Length": String(body.length) }) },
      rejectUnauthorized: !req.insecure, timeout: Math.min(req.timeout_ms || 30_000, 300_000),
    }, (res) => {
      const chunks = []; let size = 0;
      res.on("data", (c) => { size += c.length; if (size > 50 * 1024 * 1024) { r.destroy(new Error("response over 50 MB")); } else chunks.push(c); });
      res.on("end", () => resolve({ status: res.statusCode || 0, headers: { "content-type": String(res.headers["content-type"] || "") }, body_b64: Buffer.concat(chunks).toString("base64") }));
    });
    r.on("timeout", () => r.destroy(new Error("timed out")));
    r.on("error", (e) => reject(new Error(`${e.code || ""} ${e.message}${["ENOTFOUND", "ETIMEDOUT", "ECONNREFUSED", "EHOSTUNREACH"].includes(e.code) ? " — is the VPN connected on this laptop?" : ""}`.trim())));
    if (body) r.write(body);
    r.end();
  });
}

let vpn = {};
async function checkVpn(hosts) {
  const next = {};
  await Promise.all(hosts.map((h) => new Promise((done) => {
    const [host, port] = h.split(":");
    const s = net.connect({ host, port: Number(port || 443), timeout: 4000 });
    const end = (ok) => { next[h] = ok; s.destroy(); done(); };
    s.on("connect", () => end(true)); s.on("timeout", () => end(false)); s.on("error", () => end(false));
  })));
  const was = Object.values(vpn).every(Boolean) && Object.keys(vpn).length > 0, now = Object.values(next).every(Boolean);
  if (Object.keys(vpn).length === 0 || was !== now) log(now ? "✓ VPN hosts reachable — VPN-only requests will work" : "✗ Can't reach VPN-only hosts — connect the VPN on this laptop");
  vpn = next;
}

// ── 2. Google sign-ins in your own Chrome (Chrome DevTools protocol, no extra software) ────────────────────
function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const c = {
    darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium"],
    win32: [path.join(process.env["PROGRAMFILES"] || "C:\\Program Files", "Google/Chrome/Application/chrome.exe"), path.join(process.env["PROGRAMFILES(X86)"] || "C:\\Program Files (x86)", "Google/Chrome/Application/chrome.exe"), path.join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe")],
    linux: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"],
  }[process.platform] || [];
  const p = c.find((x) => existsSync(x));
  if (!p) throw new Error("Chrome not found — set CHROME_PATH to your Chrome executable");
  return p;
}

async function openChrome(url) {
  mkdirSync(PROFILE, { recursive: true, mode: 0o700 });
  rmSync(path.join(PROFILE, "DevToolsActivePort"), { force: true });
  const proc = spawn(chromePath(), [`--user-data-dir=${PROFILE}`, "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check", "--new-window", url], { stdio: "ignore" });
  let port;
  for (let i = 0; i < 100 && !port; i++) {
    await new Promise((r) => setTimeout(r, 150));
    try { port = readFileSync(path.join(PROFILE, "DevToolsActivePort"), "utf8").split("\n")[0]; } catch { /* not yet */ }
  }
  if (!port) { proc.kill(); throw new Error("Chrome didn't start (is it already open with this profile?)"); }
  const { webSocketDebuggerUrl } = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = () => bad(new Error("DevTools connection failed")); });
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  return { send, close: async () => { await send("Browser.close").catch(() => {}); ws.close(); } };
}

async function signInMetabase(project, baseUrl) {
  const host = new URL(baseUrl).hostname;
  log(`→ Chrome opened ${host} — click "Sign in with Google" and pick your work account…`);
  const b = await openChrome(`${baseUrl.replace(/\/$/, "")}/auth/login`);
  try {
    for (let i = 0; i < 300; i++) { // 5 minutes
      const r = await b.send("Storage.getCookies");
      const c = (r.result?.cookies || []).find((x) => x.name === "metabase.SESSION" && host.endsWith(x.domain.replace(/^\./, "")));
      if (c) {
        await api("/api/connector/signin", { method: "POST", body: { kind: "metabase", project, session: c.value } });
        log(`✓ Signed in to ${project} (saved to Dev Resolve for you)`);
        return true;
      }
      await new Promise((r2) => setTimeout(r2, 1000));
    }
    log(`✗ ${project}: no sign-in within 5 minutes`);
    return false;
  } finally { await b.close(); }
}

async function signInAppLogs(info) {
  const meta = await (await fetch(new URL("/.well-known/oauth-authorization-server", info.gateway))).json();
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("hex");
  const redirect = `http://localhost:${info.callbackPort}/oauth/callback`;
  const code = await new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, redirect);
      if (u.pathname !== "/oauth/callback") { res.writeHead(404).end(); return; }
      res.writeHead(200, { "Content-Type": "text/html" }).end("<p>Signed in — you can close this window and go back to Dev Resolve.</p>");
      srv.close();
      if (u.searchParams.get("state") !== state) reject(new Error("sign-in state mismatch"));
      else if (u.searchParams.get("code")) resolve(u.searchParams.get("code"));
      else reject(new Error(u.searchParams.get("error_description") || u.searchParams.get("error") || "no code"));
    });
    srv.on("error", (e) => reject(new Error(e.code === "EADDRINUSE" ? `port ${info.callbackPort} is busy — close whatever uses it and retry` : e.message)));
    srv.listen(info.callbackPort, "127.0.0.1");
    setTimeout(() => { srv.close(); reject(new Error("no sign-in within 5 minutes")); }, 300_000).unref();
    const url = new URL(meta.authorization_endpoint);
    url.search = new URLSearchParams({ response_type: "code", client_id: info.clientId, redirect_uri: redirect, code_challenge: challenge, code_challenge_method: "S256", state, scope: "openid profile email" }).toString();
    log("→ Chrome opened the app-logs sign-in — pick your work Google account…");
    openChrome(url.toString()).then((b) => { const t = setInterval(() => {}, 1000); srv.on("close", () => { clearInterval(t); b.close(); }); }).catch(reject);
  });
  const r = await fetch(meta.token_endpoint, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: info.clientId, code, redirect_uri: redirect, code_verifier: verifier }),
  });
  const tokens = await r.json();
  if (!r.ok) throw new Error(tokens.error_description || tokens.error || `token HTTP ${r.status}`);
  await api("/api/connector/signin", { method: "POST", body: { kind: "app_log", tokens } });
  log("✓ Signed in to app logs (saved to Dev Resolve for you)");
}

let signingIn = false;
async function doSignins(hello, only) {
  if (signingIn) return; signingIn = true;
  try {
    for (const m of hello.signins.metabase) {
      if (only ? only.includes(m.project) : !m.signedIn) await signInMetabase(m.project, m.baseUrl).catch((e) => log(`✗ ${m.project}: ${e.message}`));
    }
    const a = hello.signins.appLog;
    if (a && (only ? only.includes("app_log") : !a.signedIn)) await signInAppLogs(a).catch((e) => log(`✗ app logs: ${e.message}`));
  } finally { signingIn = false; }
}

// ── main loop ──────────────────────────────────────────────────────────────────────────────────────────────
const hello = await api("/api/connector/hello");
if (!cfg.allowSuffixes) {
  cfg.allowSuffixes = hello.allowSuffixes; save();
  log(`Pinned: this laptop will only relay to hosts ending in ${cfg.allowSuffixes.join(", ") || "(none)"}`);
} else if (hello.allowSuffixes.some((s) => !cfg.allowSuffixes.includes(s))) {
  log(`! Dev Resolve now asks for more hosts (${hello.allowSuffixes.join(", ")}); still only allowing ${cfg.allowSuffixes.join(", ")}.`);
}
log(`Dev Resolve connector ${VERSION} · signed in as ${hello.user} · ${cfg.server}`);
await checkVpn(hello.vpnHosts);
setInterval(() => checkVpn(hello.vpnHosts).catch(() => {}), 20_000).unref();
const missing = [...hello.signins.metabase.filter((m) => !m.signedIn).map((m) => m.project), ...(hello.signins.appLog && !hello.signins.appLog.signedIn ? ["app logs"] : [])];
if (args.includes("--login")) doSignins(hello, [...hello.signins.metabase.map((m) => m.project), "app_log"]);
else if (missing.length && !args.includes("--no-browser")) { log(`Google sign-ins needed: ${missing.join(", ")}`); doSignins(hello); }

let jobsDone = 0;
for (let backoff = 1000; ;) {
  try {
    const { jobs, signin } = await api("/api/connector/poll", { headers: { "x-connector-vpn": JSON.stringify(vpn) } });
    backoff = 1000;
    if (signin?.length) api("/api/connector/hello").then((h) => doSignins(h, signin)).catch((e) => log(`✗ sign-in: ${e.message}`));
    for (const job of jobs) {
      doRequest(job.req)
        .then((res) => api("/api/connector/result", { method: "POST", body: { id: job.id, ok: true, res } }))
        .catch((e) => api("/api/connector/result", { method: "POST", body: { id: job.id, ok: false, error: e.message } }).catch(() => {}))
        .finally(() => { if (++jobsDone % 25 === 1) log(`relayed ${jobsDone} request(s)`); });
    }
  } catch (e) {
    log(`Dev Resolve unreachable (${e.message}) — retrying in ${Math.round(backoff / 1000)}s`);
    await new Promise((r) => setTimeout(r, backoff));
    backoff = Math.min(backoff * 2, 30_000);
  }
}
