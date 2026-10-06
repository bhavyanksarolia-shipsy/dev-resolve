"use client";
import { CopyButton } from "@/components/CopyButton";
import { useEffect, useState } from "react";
import { toast } from "@/components/Dialog";
import { btn, btnPrimary, Field, input, post, Select } from "./ui";
import { SkillsCard } from "./SkillsCard";

interface Svc { status: string; message: string; fix?: string; host?: string }
interface Data {
  claude: Svc & { method: string; model: string; defaultModel: string; gatewayUrl: string | null; usage30: { runs: number; cost: number; tokens: number };
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
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ok ? "bg-accent-soft text-accent-strong" : s.status === "not_configured" ? "bg-amber-50 text-warn" : "bg-red-50 text-bad"}`}>
      {ok ? "connected" : s.status === "not_configured" ? "not set up" : "not working"}
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
      {open && <div className="chat-pop border-t border-line p-4">{children}</div>}
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

/** Claude or DevRev: read-only status card (keys are set on the server — Railway variables). */
export function ServiceCard({ which }: { which: "claude" | "devrev" }) {
  const [d, setD] = useState<Data | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; load().then((x) => live && setD(x)); return () => { live = false; }; }, []);
  const recheck = async () => { setBusy(true); setD(await load(true)); setBusy(false); };
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ mode: "keep", secret: "", model: "", owner: "", gateway: "" });
  const setMsg = toast;
  const save = async () => {
    setBusy(true); setMsg(null);
    const body = which === "devrev" ? { service: "devrev", token: f.secret }
      : { service: "claude", model: f.model, owner: f.owner,
          ...(f.mode === "api" ? { apiKey: f.secret } : f.mode === "oauth" ? { oauthToken: f.secret } : f.mode === "gateway" ? { gatewayUrl: f.gateway, apiKey: f.secret } : {}) };
    const r = await post("/api/admin/services", body);
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: r.error });
    setEdit(false); setF({ mode: "keep", secret: "", model: "", owner: "", gateway: "" });
    setD(await load(true));
    setMsg({ ok: true, text: "Saved — used from the next investigation" });
  };
  if (d === undefined) return <div className="skeleton h-40 w-full rounded-2xl" />;
  if (!d) return <div className="card p-5 text-sm text-bad">Couldn&apos;t load the status.</div>;
  const s = which === "claude" ? d.claude : d.devrev;
  return (
    <section className="card p-5">
      <div className="mb-3 flex items-center gap-3">
        <h3 className="font-semibold">{which === "claude" ? "Claude — investigation agent" : "DevRev — tickets & comments"}</h3>
        <Status s={s} />
        <button className={`${btn} ml-auto`} disabled={busy} onClick={recheck}>{busy ? "Checking…" : "Check connection"}</button>
        <button className={btnPrimary} onClick={() => { setF({ mode: "keep", secret: "", model: which === "claude" ? d.claude.model : "", owner: which === "claude" ? d.claude.ownerNote : "", gateway: which === "claude" ? d.claude.gatewayUrl ?? "" : "" }); setEdit((e) => !e); }}>{edit ? "Close" : "Edit"}</button>
      </div>
      {edit && (
        <div className="mb-4 grid gap-3 rounded-lg bg-bg p-4 sm:grid-cols-2">
          {which === "claude" ? <>
            <Field label="Sign-in">
              <Select value={f.mode} onChange={(v) => setF({ ...f, mode: v })} options={[
                { value: "keep", label: `Keep current (${d.claude.method})` },
                { value: "api", label: "Anthropic API key", hint: "sk-ant-… from console.anthropic.com" },
                { value: "oauth", label: "Claude login token", hint: "from `claude setup-token` (uses a Claude subscription)" },
                { value: "gateway", label: "API gateway (e.g. Bifrost)", hint: "the gateway's address + the key it gave you (sk-bf-…)" },
              ]} />
            </Field>
            <Field label="Model" hint={`Default ${d.claude.defaultModel}`}>
              <Select value={f.model} onChange={(v) => setF({ ...f, model: v })} options={[
                { value: "claude-opus-5-5", label: "Claude Opus 5.5", hint: "most capable — default" },
                { value: "claude-sonnet-5", label: "Claude Sonnet 5", hint: "faster and cheaper" },
                { value: "claude-fable-5-1", label: "Claude Fable 5.1" },
                { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", hint: "fastest, for light tickets" },
              ]} />
            </Field>
            {f.mode === "gateway" && (
              <Field label="Gateway address" hint="Ask whoever issued the key; for Bifrost it usually ends in /anthropic">
                <input className={input} value={f.gateway} placeholder="https://bifrost.example.com/anthropic" onChange={(e) => setF({ ...f, gateway: e.target.value })} />
              </Field>
            )}
            {f.mode !== "keep" && (
              <Field label={f.mode === "api" ? "New API key" : f.mode === "gateway" ? (d.claude.gatewayUrl ? "Gateway key (empty = keep)" : "Gateway key") : "New login token"} hint="Stored on the server; admins can reveal it with the eye">
                <input className={input} type="password" autoComplete="off" value={f.secret} onChange={(e) => setF({ ...f, secret: e.target.value })} />
              </Field>
            )}
            <Field label="Token owner" hint={d.claude.ownerDetected ? `Anthropic says: ${d.claude.owner}` : "Who generated this key / token — Anthropic doesn't tell us for API keys"}>
              <input className={input} value={f.owner} placeholder="e.g. Bhavyank Sarolia (support team account)" onChange={(e) => setF({ ...f, owner: e.target.value })} />
            </Field>
          </> : (
            <Field label="New DevRev token" hint="DevRev → Settings → Account → Personal access token. Posts and updates appear as its owner.">
              <input className={input} type="password" autoComplete="off" value={f.secret} onChange={(e) => setF({ ...f, secret: e.target.value })} />
            </Field>
          )}
          <div className="flex items-end gap-2 sm:col-span-2">
            <button className={btnPrimary} disabled={busy || (which === "devrev" ? !f.secret : f.mode === "gateway" ? !f.gateway.trim() || (!f.secret && !d.claude.gatewayUrl) : f.mode !== "keep" && !f.secret)} onClick={save}>{busy ? "Saving…" : "Save"}</button>
            <button className={btn} onClick={() => setEdit(false)}>Cancel</button>
          </div>
        </div>
      )}
      <dl className="divide-y divide-line">
        {which === "claude" ? <>
          <Row k="Signed in with" v={d.claude.method} />
          <Row k="Token" v={<TokenField which="claude" preview={d.claude.tokenPreview} />} />
          <Row k="Token owner" v={d.claude.owner
            ? <>{d.claude.owner}{d.claude.ownerDetected && <span className="ml-2 text-xs text-muted">from Anthropic</span>}</>
            : <span className="text-muted">not set — add it under Edit</span>} />
          <Row k="Model" v={<code className="text-xs">{d.claude.model}</code>} />
          <Row k="Status" v={d.claude.message} />
          <Row k="Last 30 days" v={`${d.claude.usage30.runs} agent runs · $${d.claude.usage30.cost.toFixed(2)} · ${Math.round(d.claude.usage30.tokens / 1000).toLocaleString("en-IN")}k tokens`} />
        </> : <>
          <Row k="Token" v={<span className="flex flex-wrap items-center gap-2"><TokenField which="devrev" preview={d.devrev.tokenPreview} />{d.devrev.tokenSource && <span className="text-xs text-muted">{d.devrev.tokenSource}</span>}</span>} />
          <Row k="Token owner" v={d.devrev.as ? <>{d.devrev.as}<span className="ml-2 text-xs text-muted">from DevRev — posts and updates appear as this user</span></> : "—"} />
          <Row k="Status" v={d.devrev.message} />
          <Row k="Used for" v="Reading tickets, conversations and attachments; posting internal RCAs; Stage / Pod / Part / owner / resolve updates" />
        </>}
        {s.fix && <Row k="To fix" v={<span className="text-warn">{s.fix}</span>} />}
      </dl>
      {which === "devrev" && <p className="mt-3 text-xs text-muted">A token saved here overrides the server variable DEVREV_TOKEN. Posts and updates appear in DevRev as this user.</p>}
      {which === "claude" && <SkillsCard />}
      {which === "claude" && <ClaudeTransparency c={d.claude} />}
    </section>
  );
}
