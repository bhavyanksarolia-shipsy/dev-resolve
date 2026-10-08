"use client";
import { useEffect, useState } from "react";
import { CopyButton } from "@/components/CopyButton";

interface Mine { enabled: boolean; main: string | null; token: { preview: string; owner: string | null; addedAt: string } | null; chain: string[] }

/**
 * Your own Claude token — the fallback for your investigations when the main Claude sign-in (e.g. Bifrost) isn't
 * working. The switch happens per request, so an investigation carries on where it was without waiting.
 */
export function MyClaudeCard() {
  const [d, setD] = useState<Mine | null>(null);
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [help, setHelp] = useState(false);
  const load = () => fetch("/api/my-claude", { cache: "no-store" }).then((r) => r.json()).then(setD).catch(() => {});
  useEffect(() => { load(); }, []);

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/my-claude", { method: "POST", body: JSON.stringify({ token: val }) });
      const j = await r.json();
      setMsg({ ok: r.ok, text: r.ok ? j.message : j.error });
      if (r.ok) { setVal(""); load(); }
    } finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true);
    await fetch("/api/my-claude", { method: "DELETE" }).finally(() => setBusy(false));
    setMsg({ ok: true, text: "Removed" }); load();
  }

  if (!d) return <section className="card skeleton h-40" />;
  return (
    <section className="card divide-y divide-line">
      <div className="flex items-center gap-2 px-5 py-3">
        <h2 className="font-semibold">Your Claude token</h2>
        <span className="text-xs text-muted">· fallback for your investigations</span>
        <span className={`ml-auto inline-flex items-center gap-1.5 text-xs ${d.token ? "text-ok" : "text-muted"}`}>
          <span className={`h-2 w-2 rounded-full ${d.token ? "bg-ok" : "bg-line"}`} />{d.token ? "added" : "not added"}
        </span>
      </div>
      <div className="space-y-3 px-5 py-4 text-sm">
        {!d.enabled && <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-warn ring-1 ring-amber-200">An admin has switched personal fallback off, so your token isn&apos;t used right now.</p>}
        <p className="text-muted">
          If {d.main ?? "the main Claude sign-in"} isn&apos;t working, your investigations switch to your own Claude token on the spot and carry on where
          they were — no waiting. It&apos;s used only for investigations and chats <b>you</b> start, and nobody else can see it.
        </p>
        {d.chain.length > 0 && (
          <p className="text-xs text-muted">Your investigations use, in order: {d.chain.map((c, i) => <span key={c}>{i > 0 && " → "}<b className="font-medium text-fg">{c}</b></span>)}</p>
        )}
        {d.token ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-bg px-3 py-2">
            <code className="font-mono text-xs">{d.token.preview}</code>
            {d.token.owner && <span className="text-xs text-muted">{d.token.owner}</span>}
            <span className="text-xs text-muted">added {new Date(d.token.addedAt).toLocaleDateString("en-IN", { dateStyle: "medium" })}</span>
            <button onClick={remove} disabled={busy} className="ml-auto rounded-md border border-line px-2.5 py-1 text-xs hover:border-bad hover:text-bad disabled:opacity-40">Remove</button>
          </div>
        ) : null}
        <div className="flex gap-2">
          <input type="password" autoComplete="off" value={val} onChange={(e) => setVal(e.target.value)} placeholder={d.token ? "Paste a new token to replace it" : "sk-ant-oat01-…"}
            className="min-w-0 flex-1 rounded-lg border border-line bg-panel px-3 py-2 font-mono text-xs outline-none focus:border-accent" />
          <button onClick={save} disabled={busy || !val.trim()} className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white hover:bg-accent-strong disabled:opacity-40">{busy ? "Checking…" : "Check & save"}</button>
        </div>
        {msg && <p className={`text-xs ${msg.ok ? "text-ok" : "text-bad"}`}>{msg.text}</p>}
        <button type="button" onClick={() => setHelp((h) => !h)} className="text-xs text-accent-strong underline">{help ? "Hide" : "How do I get my token?"} (2 minutes, once)</button>
        {help && (
          <ol className="space-y-2 text-xs text-muted">
            <li><b className="text-fg">1.</b> You need a Claude subscription (Pro, Max or Team) and Claude Code installed on your laptop.</li>
            <li className="flex flex-wrap items-center gap-2"><b className="text-fg">2.</b> Open Terminal and run
              <code className="rounded bg-bg px-1.5 py-0.5 font-mono ring-1 ring-line">claude setup-token</code>
              <CopyButton text="claude setup-token" label="Copy command" /></li>
            <li><b className="text-fg">3.</b> Your browser opens — sign in to Claude and click <b>Authorize</b>.</li>
            <li><b className="text-fg">4.</b> Back in Terminal, copy the token it prints (starts with <code className="font-mono">sk-ant-oat01-</code>, valid for a year) and paste it above.</li>
            <li>Have an Anthropic API key instead (<code className="font-mono">sk-ant-api03-…</code>)? That works too.</li>
          </ol>
        )}
      </div>
    </section>
  );
}
