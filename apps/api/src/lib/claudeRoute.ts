import "server-only";
import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { adminSetting, ROOT } from "./config";
import { gatewayCarrier, gatewayViaConnector, relay, userAuthDir, writePrivate } from "./connector";
import { savePrivate } from "./privateStore";

/**
 * How the agent reaches Claude, with automatic fallback. The main sign-in is whatever Admin → Connections → Claude
 * says (Bifrost, directly or through the extension; an Anthropic API key; a Claude login token). When it fails, the very
 * same request goes on to the next one at once — the person's own Claude token, then the server's Claude login — so the
 * investigation carries on where it was (every request holds the whole conversation) without waiting. A sign-in that
 * failed is skipped until a check every 20 s finds it working again; then requests go back to it.
 */
export interface Upstream {
  id: string; // "main" | "personal:<user>" | "server"
  label: string; // shown to people: "Bifrost", "bhavyank's own Claude token", …
  auth: "key" | "oauth";
  base: string; // API base, without a trailing slash
  secret: string;
  viaExtension?: boolean;
}

const ANTHROPIC = "https://api.anthropic.com";
const isOauth = (t: string) => t.startsWith("sk-ant-oat");
const host = (u: string) => { try { return new URL(u).host; } catch { return u; } };

// ── each person's own Claude token ──────────────────────────────────────────────────────────────────────────
const tokenFile = (user: string) => path.join(userAuthDir(user), "claude", "token.json");
export interface PersonalToken { token: string; owner: string | null; addedAt: string }
export function personalToken(user?: string | null): PersonalToken | null {
  if (!user) return null;
  try {
    const f = tokenFile(user);
    return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as PersonalToken) : null;
  } catch { return null; }
}
export function savePersonalToken(user: string, token: string, owner: string | null) {
  writePrivate(tokenFile(user), JSON.stringify({ token, owner, addedAt: new Date().toISOString() }));
  breaker.delete(`personal:${user}`);
}
export async function removePersonalToken(user: string) {
  const f = tokenFile(user);
  if (existsSync(f)) rmSync(f);
  await savePrivate(f); // gone from disk → removed from the database too
}

/** Check a Claude token against Anthropic; returns whose it is when Anthropic says (login tokens). */
export async function verifyClaudeToken(token: string): Promise<{ ok: true; owner: string | null } | { ok: false; message: string }> {
  const u: Upstream = { id: "check", label: "", auth: isOauth(token) ? "oauth" : "key", base: ANTHROPIC, secret: token };
  try {
    const r = await fetch(`${ANTHROPIC}/v1/models?limit=1`, { headers: authHeaders(u, { "anthropic-version": "2023-06-01" }), signal: AbortSignal.timeout(10_000) });
    if (r.status === 401 || r.status === 403) return { ok: false, message: "Anthropic refused this token — make a new one and paste it again" };
    if (!r.ok) return { ok: false, message: `Anthropic answered HTTP ${r.status} — try again in a minute` };
  } catch (e) {
    return { ok: false, message: `Couldn't reach Anthropic: ${(e as Error).message}` };
  }
  if (!isOauth(token)) return { ok: true, owner: null };
  const owner = await fetch(`${ANTHROPIC}/api/oauth/profile`, { headers: { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" }, signal: AbortSignal.timeout(8000) })
    .then(async (r) => {
      if (!r.ok) return null;
      const j = (await r.json()) as { account?: { email_address?: string; email?: string; full_name?: string; display_name?: string } };
      return j.account?.email_address || j.account?.email || j.account?.full_name || j.account?.display_name || null;
    }).catch(() => null);
  return { ok: true, owner };
}

// ── the chain ─────────────────────────────────────────────────────────────────────────────────────────────
export const fallbackPersonalOn = () => adminSetting("CLAUDE_FALLBACK_PERSONAL") !== "off";
export const fallbackServerOn = () => adminSetting("CLAUDE_FALLBACK_SERVER") !== "off";

/** The main sign-in from Admin (null = this computer's own Claude Code login, local setups only). */
export function mainUpstream(): Upstream | null {
  const key = adminSetting("ANTHROPIC_API_KEY"), oauth = adminSetting("CLAUDE_CODE_OAUTH_TOKEN"), gateway = adminSetting("ANTHROPIC_BASE_URL");
  if (key && gateway) {
    const h = host(gateway);
    return { id: "main", label: /bifrost/i.test(h) ? "Bifrost" : `the Claude gateway (${h})`, auth: "key", base: gateway.replace(/\/+$/, ""), secret: key, viaExtension: gatewayViaConnector() };
  }
  if (key) return { id: "main", label: "the team's Anthropic API key", auth: isOauth(key) ? "oauth" : "key", base: ANTHROPIC, secret: key };
  if (oauth) return { id: "main", label: "the team's Claude login", auth: "oauth", base: ANTHROPIC, secret: oauth };
  return null;
}

/** The server's own Claude login (its variables, not what Admin saved) — the last fallback. */
function serverUpstream(): Upstream | null {
  const t = process.env.CLAUDE_CODE_OAUTH_TOKEN || (!process.env.ANTHROPIC_BASE_URL ? process.env.ANTHROPIC_API_KEY : undefined);
  return t ? { id: "server", label: "the server's Claude login", auth: isOauth(t) || t === process.env.CLAUDE_CODE_OAUTH_TOKEN ? "oauth" : "key", base: ANTHROPIC, secret: t } : null;
}

/** Everything one person's run may use, in order (duplicates of the same key dropped). */
export function chainFor(user?: string | null): Upstream[] {
  const out: Upstream[] = [];
  const add = (u: Upstream | null) => { if (u && !out.some((x) => x.secret === u.secret && x.base === u.base)) out.push(u); };
  add(mainUpstream());
  const mine = fallbackPersonalOn() ? personalToken(user) : null;
  // Label without the name: it shows in the investigation timeline, which others read too.
  if (mine && user) add({ id: `personal:${user}`, label: "the personal Claude token of the person who started it", auth: isOauth(mine.token) ? "oauth" : "key", base: ANTHROPIC, secret: mine.token });
  if (fallbackServerOn()) add(serverUpstream());
  return out;
}

/** What carries the work when the main sign-in is down, in words ("personal Claude tokens (3 people) and the server's Claude login"). */
export function fallbackSummary(): string | null {
  const parts: string[] = [];
  if (fallbackPersonalOn()) {
    const dir = path.join(ROOT, ".auth", "users");
    const n = existsSync(dir) ? readdirSync(dir).filter((u) => existsSync(path.join(dir, u, "claude", "token.json"))).length : 0;
    if (n) parts.push(`personal Claude tokens (${n} ${n === 1 ? "person" : "people"})`);
  }
  if (fallbackServerOn()) {
    const s = serverUpstream(), m = mainUpstream();
    if (s && s.secret !== m?.secret) parts.push(s.label);
  }
  return parts.length ? parts.join(" and ") : null;
}

// ── which sign-ins are working (circuit breaker + recovery checks) ────────────────────────────────────────────
interface Down { since: number; reason: string; until?: number; probe?: NodeJS.Timeout; upstream: Upstream; user?: string | null }
const g = globalThis as unknown as { drClaude?: { breaker: Map<string, Down>; restored: Map<string, number>; runs: Map<number, { last?: string; events: string[] }> } };
const S = (g.drClaude ??= { breaker: new Map(), restored: new Map(), runs: new Map() });
const breaker = S.breaker;

/** Can this sign-in be tried right now? (Not marked down, and for the extension route: a laptop that can carry it.) */
export function usable(u: Upstream, user?: string | null) {
  const d = breaker.get(u.id);
  if (d && !(d.until && Date.now() > d.until)) return false;
  if (u.viaExtension && !gatewayCarrier(user, { vpnChecked: true })) return false;
  return true;
}

export function markDown(u: Upstream, reason: string, opts: { forMs?: number; user?: string | null } = {}) {
  const prev = breaker.get(u.id);
  if (prev && !(prev.until && Date.now() > prev.until)) { prev.reason = reason; return; }
  if (prev?.probe) clearInterval(prev.probe);
  const d: Down = { since: Date.now(), reason, upstream: u, user: opts.user, ...(opts.forMs && { until: Date.now() + opts.forMs }) };
  breaker.set(u.id, d);
  console.warn(`[claude] ${u.label} not working (${reason}) — using the fallback until it is`);
  if (!opts.forMs) {
    d.probe = setInterval(() => { void probe(d); }, 20_000);
    d.probe.unref();
  }
}

export function markUp(id: string) {
  const d = breaker.get(id);
  if (!d) return;
  if (d.probe) clearInterval(d.probe);
  breaker.delete(id);
  if (id === "main") S.restored.set(id, Date.now());
  console.log(`[claude] ${d.upstream.label} is working again — back on it`);
}

async function probe(d: Down) {
  const u = d.upstream;
  try {
    const r = await send(u, d.user, { method: "GET", path: "/v1/models?limit=1", headers: { "anthropic-version": "2023-06-01" }, headerMs: 10_000 });
    if (r.status < 500 && r.status !== 401 && r.status !== 403 && r.status !== 429) markUp(u.id);
  } catch { /* still down */ }
}

/** For the connection check and the banner: is the main sign-in on a fallback right now, and since when? */
export function mainState(): { down: false; restoredAt: number | null } | { down: true; since: number; reason: string } {
  const d = breaker.get("main");
  if (d && !(d.until && Date.now() > d.until)) return { down: true, since: d.since, reason: d.reason };
  const r = S.restored.get("main") ?? null;
  return { down: false, restoredAt: r && Date.now() - r < 15 * 60_000 ? r : null };
}

// ── what the investigation's timeline should say ──────────────────────────────────────────────────────────────
function noteRoute(runId: number | null, chain: Upstream[], used: Upstream, failed: { u: Upstream; reason: string }[]) {
  if (!runId) return;
  const r = S.runs.get(runId) ?? { events: [] };
  S.runs.set(runId, r);
  if (r.last === used.id) return;
  const main = chain[0];
  if (used.id === main.id) {
    if (r.last) r.events.push(`Claude connection is working fine again — back on ${main.label}.`);
  } else {
    const why = failed.length ? failed.map((f) => `${f.u.label}: ${f.reason}`).join("; ") : breaker.get(main.id) ? `${main.label}: ${breaker.get(main.id)!.reason}` : "";
    r.events.push(`${failed[0]?.u.label ?? main.label} isn't working right now${why ? ` (${why})` : ""} — switched to ${used.label}. The investigation continues where it was, without delay.`);
  }
  r.last = used.id;
}
/** Messages for the investigation's timeline since the last call (Claude switched, or came back). */
export function takeRouteEvents(runId: number): string[] {
  const r = S.runs.get(runId);
  if (!r?.events.length) return [];
  return r.events.splice(0);
}
export function routeUsed(runId: number) {
  return S.runs.get(runId)?.last;
}
export function endRun(runId: number) {
  S.runs.delete(runId);
}

// ── sending ─────────────────────────────────────────────────────────────────────────────────────────────────
const DROP = /^(host|connection|content-length|transfer-encoding|accept-encoding|authorization|x-api-key|x-bf-vk|x-relay-[a-z-]+)$/i;

/** The agent's request, signed for this sign-in (login tokens and keys use different headers / beta flags). */
function authHeaders(u: Upstream, incoming: Record<string, string>) {
  const h: Record<string, string> = {};
  for (const [k, v] of Object.entries(incoming)) if (!DROP.test(k)) h[k.toLowerCase()] = v;
  const betas = (h["anthropic-beta"] || "").split(",").map((s) => s.trim()).filter(Boolean).filter((b) => b !== "oauth-2025-04-20");
  if (u.auth === "oauth") {
    h.authorization = `Bearer ${u.secret}`;
    betas.push("oauth-2025-04-20");
  } else {
    h["x-api-key"] = u.secret;
    if (u.secret.startsWith("sk-bf-")) h["x-bf-vk"] = u.secret; // older Bifrost versions read the virtual key here
  }
  if (betas.length) h["anthropic-beta"] = betas.join(","); else delete h["anthropic-beta"];
  return h;
}

interface Sent { status: number; headers: Headers | Record<string, string>; body: ReadableStream<Uint8Array> | Uint8Array | null }

async function send(u: Upstream, user: string | null | undefined, r: { method: string; path: string; headers: Record<string, string>; body?: Uint8Array; headerMs: number; signal?: AbortSignal }): Promise<Sent> {
  const url = `${u.base}${r.path}`;
  const headers = authHeaders(u, r.headers);
  if (u.viaExtension) {
    const carrier = gatewayCarrier(user, { vpnChecked: true });
    if (!carrier) throw new Error("nobody's extension is on the company VPN (Pritunl)");
    const res = await relay(carrier, { method: r.method, url, headers, body_b64: r.body ? Buffer.from(r.body).toString("base64") : undefined, timeout_ms: 600_000 });
    return { status: res.status, headers: res.headers, body: Buffer.from(res.body_b64, "base64") };
  }
  // Time out only while waiting for the answer to start (a streamed answer starts at once; it may then run for minutes).
  const ac = new AbortController();
  const stop = () => ac.abort();
  r.signal?.addEventListener("abort", stop);
  const t = setTimeout(stop, r.headerMs);
  try {
    const res = await fetch(url, { method: r.method, headers, body: r.body ? Buffer.from(r.body) : undefined, signal: ac.signal, cache: "no-store" });
    return { status: res.status, headers: res.headers, body: res.body };
  } finally {
    clearTimeout(t);
  }
}

const reasonFor = (status: number) =>
  status === 401 || status === 403 ? `sign-in refused (HTTP ${status})` : status === 429 ? "usage limit reached" : `HTTP ${status}`;

/**
 * Send the agent's request along the chain: the first sign-in that works answers; a failure moves on at once.
 * Request problems (HTTP 400/404/413…) come back as they are — another sign-in would get the same answer.
 */
export async function forward(req: Request, chain: Upstream[], opts: { user?: string | null; runId?: number | null; path: string }): Promise<Response> {
  const body = req.method === "POST" ? new Uint8Array(await req.arrayBuffer()) : undefined;
  const incoming: Record<string, string> = {};
  req.headers.forEach((v, k) => { incoming[k] = v; });
  let streaming = false;
  try { streaming = !!body && JSON.parse(Buffer.from(body).toString("utf8")).stream === true; } catch { /* not JSON */ }
  const failed: { u: Upstream; reason: string }[] = [];
  let last: Response | null = null;
  // Sign-ins marked down are skipped; if every one is down, try them anyway (one may just have come back).
  const ready = chain.filter((u) => usable(u, opts.user));
  const order = ready.length ? ready : chain.filter((u) => !u.viaExtension || gatewayCarrier(opts.user, { vpnChecked: true }));
  for (const u of order) {
    try {
      const r = await send(u, opts.user, { method: req.method, path: opts.path, headers: incoming, body, headerMs: streaming ? 45_000 : 600_000, signal: req.signal });
      const retryable = r.status >= 500 || r.status === 429 || r.status === 401 || r.status === 403;
      if (retryable && u !== order[order.length - 1]) {
        const ra = Number((r.headers instanceof Headers ? r.headers.get("retry-after") : r.headers["retry-after"]) || 0);
        markDown(u, reasonFor(r.status), { user: opts.user, ...(r.status === 429 && { forMs: Math.min(Math.max(ra, 30), 600) * 1000 }) });
        failed.push({ u, reason: reasonFor(r.status) });
        if (r.body instanceof ReadableStream) await r.body.cancel().catch(() => {});
        continue;
      }
      // A streamed answer counts once it finished (one cut off halfway isn't "working again").
      if (r.status < 400 && !(r.body instanceof ReadableStream)) noteRoute(opts.runId ?? null, chain, u, failed);
      const ct = (r.headers instanceof Headers ? r.headers.get("content-type") : r.headers["content-type"]) || "application/json";
      const rid = r.headers instanceof Headers ? r.headers.get("request-id") : null;
      let out = r.body;
      // A stream that breaks halfway: mark this sign-in down so the agent's automatic retry goes to the next one.
      if (out instanceof ReadableStream) {
        const reader = out.getReader();
        out = new ReadableStream<Uint8Array>({
          async pull(c) {
            try {
              const { done, value } = await reader.read();
              if (done) { if (r.status < 400) noteRoute(opts.runId ?? null, chain, u, failed); c.close(); } else c.enqueue(value);
            } catch (e) {
              if (!req.signal.aborted) markDown(u, `connection dropped mid-answer (${(e as Error).message})`, { user: opts.user });
              c.error(e);
            }
          },
          cancel() { void reader.cancel().catch(() => {}); },
        });
      }
      return new Response(out as BodyInit | null, { status: r.status, headers: { "content-type": ct, ...(rid && { "request-id": rid }) } });
    } catch (e) {
      if (req.signal.aborted) return new Response(null, { status: 499 });
      const reason = /abort/i.test((e as Error).name + (e as Error).message) ? "no answer in time" : (e as Error).message.replace(/^CONNECTOR_OFFLINE: /, "");
      markDown(u, reason, { user: opts.user });
      failed.push({ u, reason });
      last = Response.json({ type: "error", error: { type: "api_error", message: `${u.label}: ${reason}` } }, { status: 503 });
    }
  }
  if (last) return last;
  // Nothing to try at all: say so plainly, and with 403 so the agent stops now instead of retrying for minutes.
  return Response.json({ type: "error", error: { type: "permission_error", message: noRouteMessage(chain) } }, { status: 403 });
}

export function noRouteMessage(chain: Upstream[]) {
  const main = chain[0];
  if (!main) return "Claude isn't set up — add a sign-in in Admin → Connections → Claude";
  return `${main.label} isn't reachable${main.viaExtension ? " (nobody's Dev Resolve extension is on the company VPN — Pritunl)" : ""} and there's no working fallback. Add your own Claude token on the Connector page, or connect Pritunl, then try again.`;
}
