"use client";
import { useEffect, useState } from "react";
import { CopyButton } from "@/components/CopyButton";
import { Field, Select, btn, btnPrimary, input } from "@/components/admin/ui";

type Kind = "oauth" | "api";
interface Mine {
  enabled: boolean; main: string | null; chain: string[];
  token: { preview: string; kind: Kind; owner: string | null; addedAt: string; check: { ok: boolean; message: string; at: string } | null } | null;
}
const KIND_LABEL: Record<Kind, string> = { oauth: "Claude login token (your subscription)", api: "Anthropic API key" };

/**
 * Your own Claude sign-in — the fallback for your investigations when the main Claude sign-in (e.g. Bifrost) isn't
 * working. Laid out like Admin → Connections → Claude: status + Check connection, the saved token (hidden, eye to show,
 * copy), Edit to change it.
 */
export function MyClaudeCard() {
  const [d, setD] = useState<Mine | null>(null);
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState<{ kind: Kind; token: string }>({ kind: "oauth", token: "" });
  const [busy, setBusy] = useState<"" | "save" | "check" | "remove">("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [full, setFull] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [help, setHelp] = useState(false);
  const load = () => fetch("/api/my-claude", { cache: "no-store" }).then((r) => r.json()).then(setD).catch(() => {});
  useEffect(() => { load(); }, []);

  const call = async (method: string, body?: object) => {
    const r = await fetch("/api/my-claude", { method, ...(body && { body: JSON.stringify(body) }) });
    return { ok: r.ok, ...(await r.json().catch(() => ({}))) } as { ok: boolean; message?: string; error?: string; value?: string | null };
  };
  async function save() {
    setBusy("save"); setMsg(null);
    const r = await call("POST", { kind: f.kind, token: f.token });
    setBusy(""); setMsg({ ok: r.ok, text: (r.ok ? r.message : r.error) ?? "" });
    if (r.ok) { setEdit(false); setF({ ...f, token: "" }); setFull(null); setShown(false); load(); }
  }
  async function check() {
    setBusy("check"); setMsg(null);
    const r = await call("POST", { check: true });
    setBusy(""); setMsg({ ok: r.ok, text: (r.ok ? r.message : r.error ?? r.message) ?? "" }); load();
  }
  async function remove() {
    setBusy("remove");
    await call("DELETE");
    setBusy(""); setMsg({ ok: true, text: "Removed" }); setEdit(false); setFull(null); setShown(false); load();
  }
  async function toggleShow() {
    if (shown) return setShown(false);
    if (!full) { const r = await call("POST", { reveal: true }); if (!r.value) return; setFull(r.value); }
    setShown(true);
  }

  if (!d) return <section className="card skeleton h-40" />;
  const t = d.token;
  const state = !t ? { tone: "text-muted", dot: "bg-line", text: "Not added" }
    : !t.check ? { tone: "text-muted", dot: "bg-warn", text: "Saved · not checked yet" }
    : t.check.ok ? { tone: "text-ok", dot: "bg-ok", text: "Working" } : { tone: "text-bad", dot: "bg-bad", text: "Not working" };
  const icon = "grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted hover:bg-accent-soft hover:text-accent-strong";
  const row = (k: string, v: React.ReactNode) => <div className="grid grid-cols-[8rem_1fr] gap-2 py-1.5 text-sm"><dt className="text-muted">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>;

  return (
    <section className="card">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
        <h2 className="font-semibold">Your Claude token</h2>
        <span className="text-xs text-muted">· fallback for your investigations</span>
        <span className={`ml-auto inline-flex items-center gap-1.5 text-xs font-medium ${state.tone}`}><span className={`h-2 w-2 rounded-full ${state.dot}`} />{state.text}</span>
        {t && <button className={btn} disabled={!!busy} onClick={check}>{busy === "check" ? "Checking…" : "Check connection"}</button>}
        <button className={btnPrimary} onClick={() => { setF({ kind: t?.kind ?? "oauth", token: "" }); setMsg(null); setEdit((e) => !e); }}>{edit ? "Close" : t ? "Edit" : "Add"}</button>
      </div>

      <div className="space-y-3 px-5 py-4">
        {!d.enabled && <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-warn ring-1 ring-amber-200">An admin has switched personal fallback off, so your token isn&apos;t used right now.</p>}

        {edit && (
          <div className="grid gap-3 rounded-lg bg-bg p-4 sm:grid-cols-2">
            <Field label="Sign-in type">
              <Select value={f.kind} onChange={(v) => setF({ ...f, kind: v as Kind })} options={[
                { value: "oauth", label: KIND_LABEL.oauth, hint: "sk-ant-oat01-… from `claude setup-token` — uses your Claude Pro / Max / Team plan" },
                { value: "api", label: KIND_LABEL.api, hint: "sk-ant-api03-… from console.anthropic.com — billed per use" },
              ]} />
            </Field>
            <Field label={t ? "New token (replaces the saved one)" : "Token"} hint="Checked with Anthropic before it's saved. Only you can see it.">
              <input className={`${input} font-mono`} type="password" autoComplete="off" value={f.token} placeholder={f.kind === "oauth" ? "sk-ant-oat01-…" : "sk-ant-api03-…"}
                onChange={(e) => setF({ ...f, token: e.target.value })} />
            </Field>
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
              <button className={btnPrimary} disabled={!!busy || !f.token.trim()} onClick={save}>{busy === "save" ? "Checking…" : "Check & save"}</button>
              <button className={btn} onClick={() => setEdit(false)}>Cancel</button>
              {t && <button className={`${btn} ml-auto hover:border-bad hover:text-bad`} disabled={!!busy} onClick={remove}>{busy === "remove" ? "Removing…" : "Remove my token"}</button>}
            </div>
            <div className="text-xs sm:col-span-2">
              <button type="button" onClick={() => setHelp((h) => !h)} className="text-accent-strong underline">{help ? "Hide" : "How do I get it?"}</button>
              {help && (f.kind === "oauth" ? (
                <ol className="mt-2 space-y-1.5 text-muted">
                  <li><b className="text-fg">1.</b> You need a Claude subscription (Pro, Max or Team) and Claude Code on your laptop.</li>
                  <li className="flex flex-wrap items-center gap-2"><b className="text-fg">2.</b> In Terminal run <code className="rounded bg-panel px-1.5 py-0.5 font-mono ring-1 ring-line">claude setup-token</code><CopyButton text="claude setup-token" label="Copy command" /></li>
                  <li><b className="text-fg">3.</b> Sign in to Claude in the browser that opens and click <b>Authorize</b>.</li>
                  <li><b className="text-fg">4.</b> Copy the token Terminal prints (starts with <code className="font-mono">sk-ant-oat01-</code>, valid for a year) and paste it above.</li>
                </ol>
              ) : (
                <p className="mt-2 text-muted">console.anthropic.com → <b>API keys</b> → <b>Create key</b> → copy it (starts with <code className="font-mono">sk-ant-api03-</code>) and paste it above.</p>
              ))}
            </div>
          </div>
        )}

        <dl className="divide-y divide-line">
          {row("Sign-in type", t ? KIND_LABEL[t.kind] : <span className="text-muted">none — click Add</span>)}
          {t && row("Token", (
            <span className="flex min-w-0 max-w-xl items-center gap-1 rounded-lg border border-line bg-bg py-0.5 pl-2.5 pr-1">
              <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{shown && full ? full : t.preview}</span>
              <button type="button" onClick={toggleShow} aria-label={shown ? "Hide token" : "Show token"} title={shown ? "Hide" : "Show"} className={icon}>
                {shown
                  ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A10.6 10.6 0 0 1 12 5c5 0 9 4.5 10 7a13 13 0 0 1-2.9 4M6.1 6.1A13 13 0 0 0 2 12c1 2.5 5 7 10 7a10.6 10.6 0 0 0 4.1-.8" /></svg>
                  : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>}
              </button>
              {shown && full && <CopyButton text={full} label="Copy token" />}
            </span>
          ))}
          {t?.owner && row("Belongs to", t.owner)}
          {t && row("Last check", t.check
            ? <span className={t.check.ok ? "text-ok" : "text-bad"}>{t.check.message} <span className="text-xs text-muted">· {new Date(t.check.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</span></span>
            : <span className="text-muted">not checked yet — click Check connection</span>)}
          {t && row("Added", new Date(t.addedAt).toLocaleDateString("en-IN", { dateStyle: "medium" }))}
          {row("Used when", <span className="text-muted">{d.main ?? "The main Claude sign-in"} isn&apos;t working — your investigations switch to it on the spot and carry on where they were. Only for investigations and chats <b className="text-fg">you</b> start.</span>)}
          {d.chain.length > 0 && row("Order", <span className="text-xs">{d.chain.map((c, i) => <span key={c}>{i > 0 && <span className="text-muted"> → </span>}<b className="font-medium">{c}</b></span>)}</span>)}
        </dl>
        {msg && <p className={`text-xs ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.text}</p>}
      </div>
    </section>
  );
}
