"use client";
import { useEffect, useState } from "react";
import { toast } from "@/components/Dialog";
import { btn, btnPrimary, Field, input, post } from "./ui";
import { TokenField } from "./ServiceCard";

interface Mail { configured: boolean; user: string; host: string; port: number; fromName: string; tokenPreview: string | null }

/** Admin → Connections → Email: the mailbox Dev Resolve sends welcome emails from (Google Workspace SMTP + App Password). */
export function EmailCard() {
  const [m, setM] = useState<Mail | null | undefined>(undefined);
  const [busy, setBusy] = useState<"" | "check" | "test" | "save">("");
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ user: "", pass: "", fromName: "" });
  const load = () => fetch("/api/admin/services", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => setM(d?.email ?? null)).catch(() => setM(null));
  useEffect(() => { load(); }, []);
  if (m === undefined) return <div className="skeleton h-40 w-full rounded-2xl" />;
  if (!m) return <div className="card p-5 text-sm text-bad">Couldn&apos;t load the email settings.</div>;

  const check = async () => { setBusy("check"); const r = await post<{ ok: boolean; message: string }>("/api/admin/services", { service: "email", check: true }); setBusy(""); setStatus({ ok: !r.error && r.ok, message: r.error || r.message }); };
  const test = async () => {
    setBusy("test");
    const r = await post<{ message?: string }>("/api/admin/services", { service: "email", test: true, appUrl: window.location.origin });
    setBusy("");
    toast({ ok: !r.error, text: r.error || r.message || "Sent" });
  };
  const save = async () => {
    setBusy("save");
    const r = await post("/api/admin/services", { service: "email", user: f.user, pass: f.pass, fromName: f.fromName });
    setBusy("");
    if (r.error) return toast({ ok: false, text: r.error });
    toast({ ok: true, text: "Saved — welcome emails are sent from this mailbox" });
    setEdit(false); setF({ user: "", pass: "", fromName: "" }); setStatus(null); load();
  };
  const row = (k: string, v: React.ReactNode) => <div className="grid grid-cols-[9rem_1fr] gap-2 py-1.5 text-sm"><dt className="text-muted">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>;
  return (
    <section className="card p-5">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h3 className="font-semibold">Email — welcome emails</h3>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${m.configured ? "bg-accent-soft text-accent-strong" : "bg-amber-50 text-warn"}`}>{m.configured ? "set up" : "not set up"}</span>
        <button className={`${btn} ml-auto`} disabled={!m.configured || !!busy} onClick={check}>{busy === "check" ? "Checking…" : "Check connection"}</button>
        <button className={btn} disabled={!m.configured || !!busy} onClick={test} title="Sends the welcome email to you, so you see what new people get">{busy === "test" ? "Sending…" : "Send a test email to me"}</button>
        <button className={btnPrimary} onClick={() => { setF({ user: m.user, pass: "", fromName: m.fromName }); setEdit((e) => !e); }}>{edit ? "Close" : m.configured ? "Edit" : "Set up"}</button>
      </div>
      {edit && (
        <div className="mb-4 grid gap-3 rounded-lg bg-bg p-4 sm:grid-cols-2">
          <Field label="Sending address" hint="A Shipsy Google Workspace mailbox, e.g. support@ or no-reply@">
            <input className={input} type="email" value={f.user} placeholder="support@shipsy.io" onChange={(e) => setF({ ...f, user: e.target.value })} />
          </Field>
          <Field label="Shown as" hint="The sender name people see">
            <input className={input} value={f.fromName} placeholder="Dev Resolve" onChange={(e) => setF({ ...f, fromName: e.target.value })} />
          </Field>
          <Field label={m.configured ? "New App Password" : "App Password"}
            hint={<>Signed in to that mailbox: Google account → Security → 2-Step Verification → <b>App passwords</b> → create one (16 letters). Not the normal password.{m.configured && " Leave empty to keep the saved one."}</>}>
            <input className={input} type="password" autoComplete="new-password" value={f.pass} onChange={(e) => setF({ ...f, pass: e.target.value })} />
          </Field>
          <div className="flex items-end gap-2">
            <button className={btnPrimary} disabled={!!busy || !f.user || (!m.configured && !f.pass)} onClick={save}>{busy === "save" ? "Saving…" : "Save"}</button>
            <button className={btn} onClick={() => setEdit(false)}>Cancel</button>
          </div>
        </div>
      )}
      <dl className="divide-y divide-line">
        {row("Sends from", m.user ? <>{m.fromName} &lt;{m.user}&gt;</> : <span className="text-muted">not set</span>)}
        {row("App Password", <TokenField which="email" preview={m.tokenPreview} />)}
        {row("Server", <code className="text-xs">{m.host}:{m.port}</code>)}
        {status && row("Connection", <span className={status.ok ? "text-ok" : "text-bad"}>{status.ok ? "● " : "○ "}{status.message}</span>)}
        {row("Used for", "The welcome email when you add someone (sign-in link and onboarding steps). Passwords are never emailed.")}
      </dl>
    </section>
  );
}
