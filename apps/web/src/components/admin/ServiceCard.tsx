"use client";
import { CopyButton } from "@/components/CopyButton";
import { useEffect, useState } from "react";
import { toast } from "@/components/Dialog";
import { btn, btnPrimary, Field, input, post, Select } from "./ui";
import { SkillsCard } from "./SkillsCard";
import { Collapse as MotionCollapse } from "@/components/Motion";

interface Svc { status: string; message: string; fix?: string; host?: string }
interface Data {
  claude: Svc & { method: string; model: string; defaultModel: string; gatewayUrl: string | null; gatewayViaConnector?: boolean;
    fallback?: { personal: boolean; server: boolean; now: string | null; mainDown: boolean };
    queue?: { parallel: number; perPerson: number; running: number; waiting: number };
    carriers?: { user: string; email: string | null; vpnUp: boolean | null }[] | null; usage30: { runs: number; cost: number; tokens: number };
    tokenPreview: string | null; owner: string | null; ownerDetected: boolean; ownerNote: string;
    tools: { group: string; tools: { name: string; does: string }[] }[]; limits: string[]; sent: string;
    stored: { label: string; what: string; count: number; bytes: number; since: string | null }[] };
  devrev: Svc & { as: string | null; tokenSource: string | null; tokenPreview: string | null };
}
let cache: Promise<Data | null> | null = null;
const load = (force = false) => {
  if (force || !cache) cache = fetch("/api/admin/services", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return cache;
};

function Status({ s }: { s: Svc }) {
  const ok = s.status === "ok";
  const fb = s.status === "fallback";
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ok ? "bg-accent-soft text-accent-strong" : s.status === "not_configured" || fb ? "bg-amber-50 text-warn" : "bg-red-50 text-bad"}`}>
      {ok ? "connected" : fb ? "on fallback" : s.status === "not_configured" ? "not set up" : "not working"}
    </span>
  );
}

/** The current token, masked; the eye fetches the full value (admins only, logged) and the copy button copies it. */
export function TokenField({ which, preview }: { which: "claude" | "devrev" | "email"; preview: string | null }) {
  const [full, setFull] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!preview) return <span className="text-muted">{which === "claude" ? "none saved — uses the local Claude Code login" : "not set"}</span>;
  const toggle = async () => {
    if (shown) return setShown(false);
    if (!full) {
      setBusy(true);
      const r = await post<{ value?: string | null }>("/api/admin/services", { service: which, reveal: true });
      setBusy(false);
      if (!r.value) return;
      setFull(r.value);
    }
    setShown(true);
  };
  const icon = "grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted hover:bg-accent-soft hover:text-accent-strong";
  return (
    <span className="flex min-w-0 max-w-xl items-center gap-1 rounded-lg border border-line bg-bg py-0.5 pl-2.5 pr-1">
      <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{shown && full ? full : preview}</span>
      <button type="button" onClick={toggle} disabled={busy} aria-label={shown ? "Hide token" : "Show token"} title={shown ? "Hide" : "Show"} className={icon}>
        {shown
          ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A10.6 10.6 0 0 1 12 5c5 0 9 4.5 10 7a13 13 0 0 1-2.9 4M6.1 6.1A13 13 0 0 0 2 12c1 2.5 5 7 10 7a10.6 10.6 0 0 0 4.1-.8" /></svg>
          : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>}
      </button>
      {shown && full && (
        <CopyButton text={full} label="Copy token" />
      )}
    </span>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="grid grid-cols-[9rem_1fr] gap-2 py-1.5 text-sm"><dt className="text-muted">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>;
}

const size = (b: number) => (b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);

/** A section that opens on click (closed at first): title + one-line summary, chevron on the right. */
function Collapse({ title, summary, children }: { title: string; summary: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="overflow-hidden rounded-xl border border-line">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-bg ${open ? "bg-bg" : ""}`}>
        <span className="text-sm font-semibold">{title}</span>
        <span className="truncate text-xs text-muted">{summary}</span>
        <svg className={`ml-auto shrink-0 text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
      </button>
      <MotionCollapse open={open}><div className="border-t border-line p-4">{children}</div></MotionCollapse>
    </div>
  );
}

/** What the agent can do and what Dev Resolve keeps — each opens on click. */
function ClaudeTransparency({ c }: { c: Data["claude"] }) {
  const h = "mb-2 text-xs font-semibold uppercase tracking-wide text-muted";
  const tools = c.tools.reduce((n, g) => n + g.tools.length, 0);
  return (
    <div className="mt-4 space-y-3">
      <Collapse title="What the agent can do" summary={`${tools} tools in ${c.tools.length} groups · ${c.limits.length} limits`}>
        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-line">
              {c.tools.map((g) => g.tools.map((t, i) => (
                <tr key={t.name} className="align-top">
                  {i === 0 && <td rowSpan={g.tools.length} className="w-36 bg-bg px-3 py-2 text-xs font-medium text-muted">{g.group}</td>}
                  <td className="px-3 py-2"><code className="text-xs">{t.name}</code><div className="text-muted">{t.does}</div></td>
                </tr>
              )))}
            </tbody>
          </table>
        </div>
        <h4 className={`${h} mt-5`}>Limits</h4>
        <ul className="list-disc space-y-1 pl-5 text-sm">{c.limits.map((l) => <li key={l}>{l}</li>)}</ul>
      </Collapse>
      <Collapse title="What we keep" summary={`in Dev Resolve's database and server · ${size(c.stored.reduce((n, s) => n + s.bytes, 0))}`}>
        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-bg text-left text-xs text-muted"><tr><th className="px-3 py-2 font-medium">Data</th><th className="px-3 py-2 text-right font-medium">Items</th><th className="px-3 py-2 text-right font-medium">Size</th></tr></thead>
            <tbody className="divide-y divide-line">
              {c.stored.map((s) => (
                <tr key={s.label} className="align-top">
                  <td className="px-3 py-2"><div className="font-medium">{s.label}</div><div className="text-muted">{s.what}{s.since && <> · since {new Date(s.since).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}</>}</div></td>
                  <td className="px-3 py-2 text-right tabular-nums">{s.count.toLocaleString("en-IN")}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted">{size(s.bytes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          <div><h4 className={h}>Sent to Anthropic (Claude)</h4><p className="text-sm">{c.sent}</p></div>
          <div><h4 className={h}>Not kept</h4><p className="text-sm">The Claude token is stored only as a server setting (shown masked; every reveal is logged). Log and database passwords stay in the connection settings or each person&apos;s own sign-ins — never in investigation records, and never sent to Claude.</p></div>
        </div>
      </Collapse>
    </div>
  );
}

/** DevRev: status + token (Claude has its own card below). */
export function ServiceCard({ which }: { which: "claude" | "devrev" }) {
  if (which === "claude") return <ClaudeCard />;
  return <DevrevCard />;
}

function DevrevCard() {
  const [d, setD] = useState<Data | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);
  const [secret, setSecret] = useState("");
  useEffect(() => { let live = true; load().then((x) => live && setD(x)); return () => { live = false; }; }, []);
  const recheck = async () => { setBusy(true); setD(await load(true)); setBusy(false); };
  const save = async () => {
    setBusy(true); toast(null);
    const r = await post("/api/admin/services", { service: "devrev", token: secret });
    setBusy(false);
    if (r.error) return toast({ ok: false, text: r.error });
    setEdit(false); setSecret(""); setD(await load(true));
    toast({ ok: true, text: "Saved" });
  };
  if (d === undefined) return <div className="skeleton h-40 w-full rounded-2xl" />;
  if (!d) return <div className="card p-5 text-sm text-bad">Couldn&apos;t load the status.</div>;
  const s = d.devrev;
  const [name, email] = (s.as ?? "").match(/^(.*?)\s*<(.+)>$/)?.slice(1) ?? [s.as ?? "", ""];
  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-semibold">DevRev — tickets &amp; comments</h3>
        <Status s={s} />
        <div className="ml-auto flex gap-2">
          <button className={btn} disabled={busy} onClick={recheck}>{busy && !edit ? "Checking…" : "Check connection"}</button>
          <button className={btnPrimary} onClick={() => { setSecret(""); setEdit((e) => !e); }}>{edit ? "Close" : "Edit"}</button>
        </div>
      </div>
      {s.status !== "ok" && (
        <div className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm ring-1 ring-red-200">
          <div className="font-semibold text-bad">DevRev isn&apos;t working — {s.message}</div>
          {s.fix && <div className="mt-1 text-muted"><b className="font-medium text-fg">To fix:</b> {s.fix}</div>}
        </div>
      )}
      {edit ? (
        <div className="mt-4 space-y-4 rounded-xl bg-bg p-4">
          <Block title="Token" hint="DevRev → Settings → Account → Personal access token. Posts and updates appear as its owner">
            <div className="grid max-w-3xl gap-4">
              {s.tokenPreview && <div className="text-sm"><div className="mb-1 font-medium">Current token</div><TokenField which="devrev" preview={s.tokenPreview} /></div>}
              <Field label={s.tokenPreview ? "Replace the token" : "Token"}>
                <input className={input} type="password" autoComplete="off" value={secret} onChange={(e) => setSecret(e.target.value)} />
              </Field>
            </div>
          </Block>
          <div className="flex gap-2">
            <button className={btnPrimary} disabled={busy || !secret} onClick={save}>{busy ? "Saving…" : "Save"}</button>
            <button className={btn} onClick={() => setEdit(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Block title="Sign-in">
            <dl className="divide-y divide-line">
              <Row k="Signed in as" v={s.as ? <span><b className="font-medium">{name}</b>{email && <span className="ml-1.5 text-xs text-muted">{email}</span>}</span> : "—"} />
              <Row k="Token" v={<span className="flex flex-wrap items-center gap-2"><TokenField which="devrev" preview={s.tokenPreview} />{s.tokenSource && <span className="text-xs text-muted">{s.tokenSource}</span>}</span>} />
            </dl>
            <p className="mt-3 text-xs text-muted">Posts and updates in DevRev appear as this user.</p>
          </Block>
          <Block title="Used for">
            <ul className="space-y-1.5 text-sm">
              {["Reading tickets, conversations and attachments", "Posting internal RCAs (after a reviewer approves)", "Updating Stage, Pod, Part, owner — and resolving tickets"].map((x) => (
                <li key={x} className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />{x}</li>
              ))}
            </ul>
          </Block>
        </div>
      )}
    </section>
  );
}

/** A labelled group inside the Claude card / its edit form. */
export function Block({ title, hint, children, className = "" }: { title: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-line bg-panel p-4 ${className}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</div>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
      <div className="mt-3">{children}</div>
    </div>
  );
}
const MODELS = [
  { value: "claude-opus-5-5", label: "Claude Opus 5.5", hint: "most capable — default" },
  { value: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", hint: "faster and cheaper" },
  { value: "claude-fable-5-1", label: "Claude Fable 5.1" },
  { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", hint: "fastest, for light tickets" },
];

/**
 * Claude — the investigation agent: what it signs in with, the queue, what happens when the main sign-in fails, and
 * usage. One status box at the top says what's wrong (if anything) and what to do; the rest is grouped in sections.
 */
function ClaudeCard() {
  const [d, setD] = useState<Data | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);
  const blank = { mode: "keep", secret: "", model: "", owner: "", gateway: "", viaExt: false, fbPersonal: true, fbServer: true, parallel: "", perPerson: "" };
  const [f, setF] = useState(blank);
  // "Find models this key can use": each model tried with a 1-token request.
  const [models, setModels] = useState<{ busy: boolean; tried?: { model: string; ok: boolean; status: number; error: string }[]; error?: string } | null>(null);
  const findModels = async () => {
    setModels({ busy: true });
    const r = await post<{ tried?: { model: string; ok: boolean; status: number; error: string }[] }>("/api/admin/services", { service: "claude", findModels: true });
    setModels({ busy: false, tried: r.tried, error: r.error });
  };
  useEffect(() => { let live = true; load().then((x) => live && setD(x)); return () => { live = false; }; }, []);
  const recheck = async () => { setBusy(true); setD(await load(true)); setBusy(false); };
  if (d === undefined) return <div className="skeleton h-40 w-full rounded-2xl" />;
  if (!d) return <div className="card p-5 text-sm text-bad">Couldn&apos;t load the status.</div>;
  const c = d.claude;
  const gwHost = c.gatewayUrl ? new URL(c.gatewayUrl).host : null;
  const mainName = gwHost ? (/bifrost/i.test(gwHost) ? "Bifrost" : "API gateway") : c.method.split(" (")[0];
  const open = () => {
    // Editing an API gateway starts in the gateway form with what's saved (the key stays unless a new one is pasted).
    setF({ ...blank, mode: c.gatewayUrl ? "gateway" : "keep", model: c.model, owner: c.ownerNote, gateway: c.gatewayUrl ?? "", viaExt: !!c.gatewayViaConnector,
      fbPersonal: c.fallback?.personal ?? true, fbServer: c.fallback?.server ?? true, parallel: String(c.queue?.parallel ?? ""), perPerson: String(c.queue?.perPerson ?? "") });
    setEdit(true);
  };
  const save = async () => {
    setBusy(true); toast(null);
    const r = await post("/api/admin/services", { service: "claude", model: f.model, owner: f.owner, fallbackPersonal: f.fbPersonal, fallbackServer: f.fbServer,
      maxParallel: f.parallel, maxPerPerson: f.perPerson,
      ...(f.mode === "api" ? { apiKey: f.secret } : f.mode === "oauth" ? { oauthToken: f.secret } : f.mode === "gateway" ? { gatewayUrl: f.gateway, apiKey: f.secret, gatewayViaConnector: f.viaExt } : f.mode === "server" ? { useServerDefault: true } : {}) });
    setBusy(false);
    if (r.error) return toast({ ok: false, text: r.error });
    setEdit(false); setF(blank); setD(await load(true));
    toast({ ok: true, text: "Saved — used from the next investigation" });
  };
  const fallbackOn = c.fallback?.mainDown || c.status === "fallback";
  const canSave = !busy && (f.mode === "gateway" ? !!f.gateway.trim() && (!!f.secret || !!c.gatewayUrl) : f.mode === "keep" || f.mode === "server" || !!f.secret);
  const stat = (v: React.ReactNode, label: string) => <div><div className="text-xl font-semibold tabular-nums">{v}</div><div className="text-xs text-muted">{label}</div></div>;

  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-semibold">Claude — investigation agent</h3>
        <Status s={c} />
        <div className="ml-auto flex gap-2">
          <button className={btn} disabled={busy} onClick={recheck}>{busy && !edit ? "Checking…" : "Check connection"}</button>
          <button className={btnPrimary} onClick={() => (edit ? setEdit(false) : open())}>{edit ? "Close" : "Edit"}</button>
        </div>
      </div>

      {/* One place for "what's wrong and what to do". */}
      {c.status !== "ok" && (
        <div className={`mt-4 rounded-xl px-4 py-3 text-sm ring-1 ${fallbackOn ? "bg-amber-50 ring-amber-200" : "bg-red-50 ring-red-200"}`}>
          <div className={`font-semibold ${fallbackOn ? "text-warn" : "text-bad"}`}>
            {fallbackOn ? `${mainName} isn't reachable — investigations are running on the fallback, nothing is blocked` : `${mainName} isn't working`}
          </div>
          {fallbackOn && c.fallback?.now && <div className="mt-1 text-muted">Using now: {c.fallback.now}. It switches back to {mainName} by itself once it works again.</div>}
          {c.fix && <div className="mt-1.5 text-muted"><b className="font-medium text-fg">To fix:</b> {c.fix.replace(/\s*Nothing is blocked meanwhile;.*$/, "")}</div>}
        </div>
      )}

      {edit ? (
        <div className="mt-4 space-y-4 rounded-xl bg-bg p-4">
          <Block title="1 · Sign-in" hint="What the agent uses to reach Claude">
            <div className="grid max-w-3xl gap-4">
              <Field label="Sign in with">
                <Select value={f.mode} onChange={(v) => setF({ ...f, mode: v, secret: "" })} options={[
                  ...(c.gatewayUrl ? [] : [{ value: "keep", label: `Keep current — ${mainName}` }]),
                  { value: "gateway", label: "API gateway (e.g. Bifrost)", hint: "its address + the key it gave you (sk-bf-…)" },
                  { value: "api", label: "Anthropic API key", hint: "sk-ant-api03-… from console.anthropic.com" },
                  { value: "oauth", label: "Claude login token", hint: "from `claude setup-token` (a Claude subscription)" },
                  { value: "server", label: "Server's own Claude login", hint: "forget what's saved here" },
                ]} />
              </Field>
              {f.mode === "gateway" && <>
                <Field label="Gateway address" hint="For Bifrost it ends in /anthropic">
                  <input className={input} value={f.gateway} placeholder="https://bifrost.example.com/anthropic" onChange={(e) => setF({ ...f, gateway: e.target.value })} />
                </Field>
                {c.gatewayUrl && (
                  <div className="text-sm">
                    <div className="mb-1 font-medium">Current key</div>
                    <TokenField which="claude" preview={c.tokenPreview} />
                  </div>
                )}
                <Field label={c.gatewayUrl ? "Replace the key (leave empty to keep it)" : "Gateway key"} hint="sk-bf-… — stored on the server; admins can show it with the eye">
                  <input className={input} type="password" autoComplete="off" value={f.secret} onChange={(e) => setF({ ...f, secret: e.target.value })} />
                </Field>
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={f.viaExt} onChange={(e) => setF({ ...f, viaExt: e.target.checked })} />
                  <span>Reach it through the Dev Resolve extension
                    <span className="block text-xs text-muted">For a gateway only on the company VPN (Bifrost behind Pritunl): someone&apos;s Chrome with the extension (1.2+) and Pritunl carries the requests.</span>
                  </span>
                </label>
              </>}
              {(f.mode === "api" || f.mode === "oauth") && (
                <Field label={f.mode === "api" ? "Anthropic API key" : "Claude login token"} hint="Stored on the server; admins can show it with the eye">
                  <input className={input} type="password" autoComplete="off" value={f.secret} onChange={(e) => setF({ ...f, secret: e.target.value })} />
                </Field>
              )}
              <Field label="Model" hint={`Default ${c.defaultModel}`}>
                <Select value={f.model} onChange={(v) => setF({ ...f, model: v })} options={[...MODELS,
                  ...(models?.tried ?? []).filter((m) => m.ok && !MODELS.some((x) => x.value === m.model)).map((m) => ({ value: m.model, label: m.model, hint: "allowed for this key" }))]} />
              </Field>
              {c.gatewayUrl && (
                <div className="text-sm">
                  <button type="button" className={btn} disabled={models?.busy} onClick={findModels}>{models?.busy ? "Trying each model…" : "Find models this key can use"}</button>
                  <span className="ml-2 text-xs text-muted">sends one tiny request (1 token) per model</span>
                  {models?.error && <p className="mt-2 text-xs text-bad">{models.error}</p>}
                  {models?.tried && (
                    <ul className="mt-2 divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel">
                      {models.tried.map((m) => (
                        <li key={m.model} className="flex items-center gap-3 px-3 py-1.5 text-xs">
                          <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] text-white ${m.ok ? "bg-ok" : "bg-bad"}`}>{m.ok ? "✓" : "✕"}</span>
                          <code className="font-mono">{m.model}</code>
                          <span className="min-w-0 flex-1 truncate text-muted" title={m.error}>{m.ok ? "allowed" : m.error || `HTTP ${m.status}`}</span>
                          {m.ok && <button type="button" className="font-medium text-accent-strong hover:underline" onClick={() => setF({ ...f, model: m.model })}>{f.model === m.model ? "selected" : "Use this"}</button>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {models?.tried && !models.tried.some((m) => m.ok) && <p className="mt-2 text-xs text-warn">None of these are allowed for the key — ask the Bifrost owners which Claude models it may use.</p>}
                </div>
              )}
              <Field label="Key owner" hint={c.ownerDetected ? `Anthropic says: ${c.owner}` : "Who the key belongs to — gateways and API keys don't say"}>
                <input className={input} value={f.owner} placeholder="e.g. Bhavyank Sarolia (support team)" onChange={(e) => setF({ ...f, owner: e.target.value })} />
              </Field>
            </div>
          </Block>
          <Block title="2 · Queue" hint="Investigations and chat replies beyond these wait in line and start by themselves">
            <div className="flex flex-wrap gap-6">
              <label className="text-sm"><div className="mb-1 font-medium">Running at once</div>
                <input className={`${input} w-24`} inputMode="numeric" value={f.parallel} placeholder="2" onChange={(e) => setF({ ...f, parallel: e.target.value.replace(/\D/g, "") })} />
                <div className="mt-1 max-w-xs text-xs text-muted">2 for a 1 GB server; more with more memory</div>
              </label>
              <label className="text-sm"><div className="mb-1 font-medium">Per person</div>
                <input className={`${input} w-24`} inputMode="numeric" value={f.perPerson} placeholder="2" onChange={(e) => setF({ ...f, perPerson: e.target.value.replace(/\D/g, "") })} />
                <div className="mt-1 max-w-xs text-xs text-muted">While others are waiting (with nobody waiting, free slots are used anyway)</div>
              </label>
            </div>
          </Block>
          <Block title={`3 · If ${mainName} isn't working`} hint="The same request goes to the next one at once — investigations carry on without waiting, and come back by themselves">
            <div className="space-y-3 text-sm">
              <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={f.fbPersonal} onChange={(e) => setF({ ...f, fbPersonal: e.target.checked })} />
                <span>The person&apos;s own Claude token<span className="block text-xs text-muted">Each person adds theirs on the Connector page; only for investigations they start</span></span></label>
              <label className="flex items-start gap-2"><input type="checkbox" className="mt-1" checked={f.fbServer} onChange={(e) => setF({ ...f, fbServer: e.target.checked })} />
                <span>Then the server&apos;s own Claude login<span className="block text-xs text-muted">If the server has one set</span></span></label>
            </div>
          </Block>
          <div className="flex gap-2">
            <button className={btnPrimary} disabled={!canSave} onClick={save}>{busy ? "Saving…" : "Save"}</button>
            <button className={btn} onClick={() => setEdit(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Block title="Sign-in">
            <dl className="divide-y divide-line">
              <Row k="Using" v={<span className="flex flex-wrap items-center gap-2"><b className="font-medium">{mainName}</b>{gwHost && <span className="text-xs text-muted">{gwHost}</span>}
                {c.gatewayViaConnector && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent-strong">through the extension</span>}</span>} />
              {c.carriers && <Row k="Through" v={(() => {
                const ready = c.carriers.filter((x) => x.vpnUp === true), others = c.carriers.filter((x) => x.vpnUp !== true);
                const who = (x: { user: string; email: string | null }) => x.email ?? x.user;
                if (!c.carriers.length) return <span className="text-bad">nobody&apos;s extension is online right now</span>;
                return <span className="space-y-0.5">
                  {ready[0] ? <span className="block"><span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-ok align-middle" /><b className="font-medium">{who(ready[0])}</b><span className="ml-1 text-xs text-muted">· carrying it now</span></span>
                    : <span className="block text-bad">nobody online is on Pritunl</span>}
                  {ready.slice(1).map((x) => <span key={x.user} className="block text-xs text-muted"><span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-ok align-middle" />{who(x)} · ready</span>)}
                  {others.map((x) => <span key={x.user} className="block text-xs text-muted"><span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-line align-middle" />{who(x)} · {x.vpnUp === false ? "Pritunl off" : "checking"}</span>)}
                </span>;
              })()} />}
              <Row k="Key" v={<TokenField which="claude" preview={c.tokenPreview} />} />
              <Row k="Owner" v={c.owner ?? <span className="text-muted">not set — add it under Edit</span>} />
              <Row k="Model" v={<code className="text-xs">{c.model}</code>} />
            </dl>
          </Block>
          <Block title="If it isn't working, use">
            <ol className="space-y-2 text-sm">
              {[{ on: true, label: `${mainName} (main)`, now: !fallbackOn },
                { on: !!c.fallback?.personal, label: "Each person's own Claude token", note: c.fallback?.now?.match(/personal Claude tokens \((\d+ \w+)\)/)?.[1] ?? "nobody added one yet", now: fallbackOn },
                { on: !!c.fallback?.server, label: "The server's own Claude login" },
              ].map((x, i) => (
                <li key={i} className={`flex items-center gap-2 ${x.on ? "" : "text-muted line-through"}`}>
                  <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-bg text-xs font-medium ring-1 ring-line">{i + 1}</span>
                  <span>{x.label}{x.note && <span className="ml-1 text-xs text-muted">· {x.note}</span>}</span>
                  {x.now && x.on && <span className={`ml-auto rounded-full px-2 py-0.5 text-xs ${i === 0 ? "bg-accent-soft text-accent-strong" : "bg-amber-50 text-warn"}`}>in use now</span>}
                </li>
              ))}
            </ol>
          </Block>
          <Block title="Queue">
            <div className="flex flex-wrap gap-8">
              {stat(c.queue?.parallel ?? "—", "running at once")}
              {stat(c.queue?.perPerson ?? "—", "per person")}
              {stat(<>{c.queue?.running ?? 0}<span className="text-sm font-normal text-muted"> / {c.queue?.waiting ?? 0}</span></>, "running / waiting now")}
            </div>
          </Block>
          <Block title="Last 30 days">
            <div className="flex flex-wrap gap-8">
              {stat(c.usage30.runs.toLocaleString("en-IN"), "agent runs")}
              {stat(`${Math.round(c.usage30.tokens / 1000).toLocaleString("en-IN")}k`, "tokens")}
            </div>
          </Block>
        </div>
      )}
      <SkillsCard />
      <ClaudeTransparency c={c} />
    </section>
  );
}
