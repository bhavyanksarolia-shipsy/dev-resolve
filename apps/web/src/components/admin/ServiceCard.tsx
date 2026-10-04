"use client";
import { useEffect, useState } from "react";
import { btn, btnPrimary, Field, input, Note, post, Select } from "./ui";

interface Svc { status: string; message: string; fix?: string; host?: string }
interface Data {
  claude: Svc & { method: string; model: string; defaultModel: string; usage30: { runs: number; cost: number; tokens: number } };
  devrev: Svc & { as: string | null; tokenSource: string | null };
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

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="grid grid-cols-[9rem_1fr] gap-2 py-1.5 text-sm"><dt className="text-muted">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>;
}

/** Claude or DevRev: read-only status card (keys are set on the server — Railway variables). */
export function ServiceCard({ which }: { which: "claude" | "devrev" }) {
  const [d, setD] = useState<Data | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; load().then((x) => live && setD(x)); return () => { live = false; }; }, []);
  const recheck = async () => { setBusy(true); setD(await load(true)); setBusy(false); };
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ mode: "keep", secret: "", model: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const save = async () => {
    setBusy(true); setMsg(null);
    const body = which === "devrev" ? { service: "devrev", token: f.secret }
      : { service: "claude", model: f.model, ...(f.mode === "api" ? { apiKey: f.secret } : f.mode === "oauth" ? { oauthToken: f.secret } : {}) };
    const r = await post("/api/admin/services", body);
    setBusy(false);
    if (r.error) return setMsg({ ok: false, text: r.error });
    setEdit(false); setF({ mode: "keep", secret: "", model: "" });
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
        <button className={btnPrimary} onClick={() => { setF({ mode: "keep", secret: "", model: which === "claude" ? d.claude.model : "" }); setEdit((e) => !e); }}>{edit ? "Close" : "Edit"}</button>
      </div>
      {msg && <div className="mb-3"><Note ok={msg.ok}>{msg.text}</Note></div>}
      {edit && (
        <div className="mb-4 grid gap-3 rounded-lg bg-bg p-4 sm:grid-cols-2">
          {which === "claude" ? <>
            <Field label="Sign-in">
              <Select value={f.mode} onChange={(v) => setF({ ...f, mode: v })} options={[
                { value: "keep", label: `Keep current (${d.claude.method})` },
                { value: "api", label: "Anthropic API key", hint: "sk-ant-… from console.anthropic.com" },
                { value: "oauth", label: "Claude login token", hint: "from `claude setup-token` (uses a Claude subscription)" },
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
            {f.mode !== "keep" && (
              <Field label={f.mode === "api" ? "API key" : "Login token"} hint="Stored on the server only; never shown again">
                <input className={input} type="password" autoComplete="off" value={f.secret} onChange={(e) => setF({ ...f, secret: e.target.value })} />
              </Field>
            )}
          </> : (
            <Field label="DevRev token" hint="DevRev → Settings → Account → Personal access token. Posts and updates appear as this user.">
              <input className={input} type="password" autoComplete="off" value={f.secret} onChange={(e) => setF({ ...f, secret: e.target.value })} />
            </Field>
          )}
          <div className="flex items-end gap-2 sm:col-span-2">
            <button className={btnPrimary} disabled={busy || (which === "devrev" ? !f.secret : f.mode !== "keep" && !f.secret)} onClick={save}>{busy ? "Saving…" : "Save"}</button>
            <button className={btn} onClick={() => setEdit(false)}>Cancel</button>
          </div>
        </div>
      )}
      <dl className="divide-y divide-line">
        {which === "claude" ? <>
          <Row k="Signed in with" v={d.claude.method} />
          <Row k="Model" v={<code className="text-xs">{d.claude.model}</code>} />
          <Row k="Status" v={d.claude.message} />
          <Row k="Last 30 days" v={`${d.claude.usage30.runs} agent runs · $${d.claude.usage30.cost.toFixed(2)} · ${Math.round(d.claude.usage30.tokens / 1000).toLocaleString("en-IN")}k tokens`} />
        </> : <>
          <Row k="Acting as" v={d.devrev.as ?? "—"} />
          <Row k="Token" v={d.devrev.tokenSource ?? "not set"} />
          <Row k="Status" v={d.devrev.message} />
          <Row k="Used for" v="Reading tickets, conversations and attachments; posting internal RCAs; Stage / Pod / Part / owner / resolve updates" />
        </>}
        {s.fix && <Row k="To fix" v={<span className="text-warn">{s.fix}</span>} />}
      </dl>
      <p className="mt-3 text-xs text-muted">
        {which === "claude"
          ? "A key or model saved here overrides the server variables (ANTHROPIC_API_KEY / CLAUDE_CODE_OAUTH_TOKEN / DEV_RESOLVE_MODEL)."
          : "A token saved here overrides the server variable DEVREV_TOKEN. Posts and updates appear in DevRev as this user."}
      </p>
    </section>
  );
}
