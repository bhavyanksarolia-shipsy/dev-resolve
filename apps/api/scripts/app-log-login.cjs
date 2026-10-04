// Sign in (or re-sign in) to the Shipsy app-logs MCP for Dev Resolve. Opens your browser for Google login;
// tokens are saved under .auth/mcp-remote (gitignored). Run when the "Shipsy app logs (MCP)" chip asks for it.
//
// Always a real sign-in: the saved login is set aside first, otherwise mcp-remote reuses it (the gateway may still
// accept it for a while) and nothing new is saved — so the next renewal fails again. If the sign-in doesn't finish,
// the old login is put back.
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const raw = require("../config/projects.json").shipsy_app_log.opensearch_mcp;
const envFile = Object.fromEntries(fs.readFileSync(path.join(__dirname, "..", "config", "config.env"), "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const cfg = { ...raw, args: raw.args.map((a) => a.replace(/\$\{([A-Z0-9_]+)\}/g, (_, k) => process.env[k] || envFile[k] || "")) };
const dir = path.join(__dirname, "..", cfg.config_dir);

const tokenFiles = () => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map(String).filter((f) => f.endsWith("_tokens.json")).map((f) => path.join(dir, f)) : []);
const stamp = Date.now();
const setAside = tokenFiles().map((f) => { const to = `${f}.before-login-${stamp}`; fs.renameSync(f, to); return [f, to]; });
const putBack = () => { for (const [f, to] of setAside) if (fs.existsSync(to) && !fs.existsSync(f)) fs.renameSync(to, f); };
let done = false;
const finish = (ok, msg) => {
  if (done) return;
  done = true;
  if (ok) for (const [, to] of setAside) fs.rmSync(to, { force: true });
  else putBack();
  console[ok ? "log" : "error"](msg);
  p.kill();
  process.exit(ok ? 0 : 1);
};

const env = { ...process.env, MCP_REMOTE_CONFIG_DIR: dir };
const p = spawn(cfg.command, cfg.args, { env, stdio: ["pipe", "pipe", "inherit"] });
let buf = "";
const timer = setTimeout(() => finish(false, "\nTimed out waiting for sign-in (5 min) — your previous login was kept."), 5 * 60 * 1000);
p.stdout.on("data", (d) => {
  buf += d;
  if (!buf.includes('"id":1')) return;
  clearTimeout(timer);
  // Success only if a new login was actually saved.
  const fresh = tokenFiles().filter((f) => fs.statSync(f).mtimeMs >= stamp);
  if (fresh.length) finish(true, "\n✓ Signed in to Shipsy app logs (new login saved). Dev Resolve keeps it renewed while it can.");
  else finish(false, "\nThe gateway answered, but no new login was saved — sign-in didn't complete. Your previous login was kept; try again.");
});
p.on("exit", (code) => { if (code) finish(false, `\nSign-in stopped (exit ${code}) — your previous login was kept.`); });
process.on("SIGINT", () => finish(false, "\nCancelled — your previous login was kept."));
p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "dev-resolve-login", version: "0" } } }) + "\n");
console.log("A browser tab will open — sign in with your Shipsy Google account…");
