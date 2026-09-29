// Google sign-in for Metabase instances that use "Sign in with Google" (bi_neo, stockone_metabase, …).
//
//   node scripts/metabase-login.cjs <project>            visible Chrome window — only needed the very first time,
//                                                         or if Google itself has signed you out
//   node scripts/metabase-login.cjs <project> --silent   hidden browser, no window: reuses your Google session.
//                                                         The Metabase tool runs this automatically when a session expires.
//
// One shared Chrome profile (.auth/google-sso, gitignored) holds your Google sign-in for every service.
// The Metabase session is saved to config/config.env via the metabase skill's set-session. Your Google password
// is never seen or stored. Exit codes: 0 = signed in, 2 = a visible sign-in is needed, 1 = error.
const path = require("node:path");
const fs = require("node:fs");
const { execFileSync } = require("node:child_process");
const { chromium } = require("playwright-core");

const project = process.argv[2];
const silent = process.argv.includes("--silent");
const root = path.join(__dirname, "..");
const cfgDir = process.env.DEV_RESOLVE_CONFIG_DIR || path.join(root, "config");
const cfg = JSON.parse(fs.readFileSync(path.join(cfgDir, "projects.json"), "utf8"));
const mb = cfg[project]?.metabase;
if (!mb) { console.error(`Unknown Metabase project "${project}". Try: ${Object.keys(cfg).filter((k) => cfg[k]?.metabase?.sso === "google").join(", ")}`); process.exit(1); }
const env = Object.fromEntries(fs.readFileSync(path.join(cfgDir, "config.env"), "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const base = env[mb.base_url_env].replace(/\/$/, "");
const PROFILE = path.join(root, ".auth", "google-sso");
const query = (args) => execFileSync("python3", [path.join(root, ".claude/skills/metabase-sql/query.py"), ...args], { stdio: silent ? "pipe" : "inherit", env: { ...process.env, DEV_RESOLVE_CONFIG_DIR: cfgDir } });

async function sessionCookie(ctx) {
  return (await ctx.cookies(base)).find((c) => c.name === "metabase.SESSION")?.value ?? null;
}

(async () => {
  fs.mkdirSync(PROFILE, { recursive: true, mode: 0o700 });
  const ctx = await chromium.launchPersistentContext(PROFILE, { channel: "chrome", headless: silent, viewport: silent ? { width: 1280, height: 800 } : null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  let token = null;
  await page.goto(`${base}/auth/login`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  if (silent) {
    // Click "Sign in with Google"; Google's account chooser pops up — pick the account from SSO_ACCOUNT_DOMAIN (config.env); it closes by itself.
    const popupP = ctx.waitForEvent("page", { timeout: 10000 }).catch(() => null);
    await page.getByRole("button", { name: /Sign in with Google/i }).first().click({ timeout: 10000 });
    const pop = await popupP;
    if (pop) {
      await pop.waitForLoadState("domcontentloaded").catch(() => {});
      const domain = env.SSO_ACCOUNT_DOMAIN || "";
      const acct = pop.locator(domain ? `[data-email*="@${domain}"], div[data-identifier*="@${domain}"]` : "[data-email], div[data-identifier]").first();
      if (await acct.count()) await acct.click().catch(() => {});
      const cont = pop.getByRole("button", { name: /^(Continue|Confirm)$/i }).first();
      if (await cont.count()) await cont.click().catch(() => {});
    }
    for (let i = 0; i < 30 && !token; i++) { token = await sessionCookie(ctx); if (!token) await page.waitForTimeout(1000); }
    await ctx.close();
    if (!token) {
      console.error(`SSO_NEEDS_USER: Google needs you to sign in again — run: npm run metabase-login -- ${project}`);
      process.exit(2);
    }
  } else {
    console.log(`\n→ Chrome opened ${new URL(base).host}. Click "Sign in with Google" and sign in with your Shipsy account…`);
    for (let i = 0; i < 300 && !token; i++) { token = await sessionCookie(ctx); if (!token) await page.waitForTimeout(1000); }
    await ctx.close();
    if (!token) { console.error("Timed out waiting for sign-in (5 min)."); process.exit(1); }
  }
  query(["set-session", token, "--project", project]);
  if (!silent) query(["whoami", "--project", project]);
  else console.log(`Signed in to ${project} silently.`);
})().catch((e) => { console.error("Metabase login failed:", e.message); process.exit(1); });
