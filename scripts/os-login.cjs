// Sign in to a Cognito/Google-protected OpenSearch Dashboards ONCE, in your own Chrome window.
// The session is kept in a private browser profile under .auth/ (gitignored, chmod 700) so Dev Resolve
// can reuse it for read-only log searches. Your password is never seen or stored by this script.
//
//   node scripts/os-login.cjs [dashboards-url]
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("playwright-core");

const envFile = Object.fromEntries(fs.readFileSync(path.join(__dirname, "..", "config", "config.env"), "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]));
const BASE = (process.argv[2] || process.env.DASHBOARDS_URL || envFile.DASHBOARDS_URL || "").replace(/\/app\/.*$/, "").replace(/\/$/, "");
if (!BASE) { console.error("Set DASHBOARDS_URL in config/config.env (or pass the URL)"); process.exit(1); }
const host = new URL(BASE).host;
const PROFILE = path.join(__dirname, "..", ".auth", host);

(async () => {
  fs.mkdirSync(PROFILE, { recursive: true, mode: 0o700 });
  const ctx = await chromium.launchPersistentContext(PROFILE, { channel: "chrome", headless: false, viewport: null });
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto(`${BASE}/app/home`);
  console.log(`\n→ A Chrome window opened. Sign in with Google there (incl. 2-step verification).`);
  console.log(`  Waiting up to 5 minutes for the OpenSearch home page…`);
  await page.waitForURL((u) => u.host === host && u.pathname.startsWith("/_dashboards/app/"), { timeout: 5 * 60 * 1000 });
  await page.waitForTimeout(1500);

  // Read-only checks through the same endpoint Dev Resolve uses.
  const search = await page.evaluate(async (base) => {
    const r = await fetch(`${base}/internal/search/opensearch-with-long-numerals`, {
      method: "POST", headers: { "Content-Type": "application/json", "osd-xsrf": "osd-fetch" },
      body: JSON.stringify({ params: { index: "*", body: { size: 0, query: { range: { "@timestamp": { gte: "now-1h" } } } } } }),
    });
    return { status: r.status, text: (await r.text()).slice(0, 300) };
  }, BASE);
  const patterns = await page.evaluate(async (base) => {
    const r = await fetch(`${base}/api/saved_objects/_find?type=index-pattern&per_page=1000&fields=title`, { headers: { "osd-xsrf": "osd-fetch" } });
    if (!r.ok) return { status: r.status, titles: [] };
    const d = await r.json();
    return { status: r.status, titles: d.saved_objects.map((o) => o.attributes.title).sort() };
  }, BASE);
  const cookies = (await ctx.cookies(`https://${host}`)).map((c) => ({ name: c.name, expires: c.expires > 0 ? new Date(c.expires * 1000).toISOString() : "session" }));

  fs.writeFileSync(path.join(PROFILE, "..", `${host}.index-patterns.json`), JSON.stringify(patterns.titles, null, 1));
  console.log(`\nSearch test: HTTP ${search.status}`);
  console.log(`Index patterns found: ${patterns.titles.length} (saved to .auth/${host}.index-patterns.json)`);
  console.log(`Session cookies: ${JSON.stringify(cookies)}`);
  await ctx.close();
})().catch((e) => { console.error("Login helper failed:", e.message); process.exit(1); });
