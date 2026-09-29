// Sign in (or re-sign in) to the Shipsy app-logs MCP for Dev Resolve. Opens your browser once for Google login;
// tokens are saved under .auth/mcp-remote (gitignored). Run when the "Shipsy app logs (MCP)" chip asks for it.
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const raw = require("../config/projects.json").shipsy_app_log.opensearch_mcp;
const envFile = Object.fromEntries(fs.readFileSync(path.join(__dirname, "..", "config", "config.env"), "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const cfg = { ...raw, args: raw.args.map((a) => a.replace(/\$\{([A-Z0-9_]+)\}/g, (_, k) => process.env[k] || envFile[k] || "")) };
const env = { ...process.env, MCP_REMOTE_CONFIG_DIR: path.join(__dirname, "..", cfg.config_dir) };
const p = spawn(cfg.command, cfg.args, { env, stdio: ["pipe", "pipe", "inherit"] });
let buf = "";
const timer = setTimeout(() => { console.error("\nTimed out waiting for sign-in (5 min)."); p.kill(); process.exit(1); }, 5 * 60 * 1000);
p.stdout.on("data", (d) => {
  buf += d;
  if (buf.includes('"id":1')) {
    clearTimeout(timer);
    console.log("\n✓ Signed in to Shipsy app logs. Dev Resolve will keep this session renewed automatically.");
    p.kill(); process.exit(0);
  }
});
p.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "dev-resolve-login", version: "0" } } }) + "\n");
console.log("If a browser tab opens, sign in with your Shipsy Google account…");
