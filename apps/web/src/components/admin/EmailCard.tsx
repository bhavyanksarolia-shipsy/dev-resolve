"use client";
import { useEffect, useState } from "react";
import { toast } from "@/components/Dialog";
import { btn, btnPrimary, Field, input, post } from "./ui";
import { TokenField } from "./ServiceCard";
import { WelcomeEmailEditor } from "./WelcomeEmailEditor";

interface Mail { configured: boolean; method: "gmail" | "smtp" | null; gmailSender: string; smtp: boolean; user: string; host: string; port: number; fromName: string; tokenPreview: string | null }

/**
 * Admin → Connections → Email: the mailbox Dev Resolve sends welcome emails from. "Connect Gmail" (Google sign-in,
 * send-only permission, over HTTPS) is the main way; SMTP + App Password stays as a fallback for hosts that allow SMTP.
 */
export function EmailCard() {
  const [m, setM] = useState<Mail | null | undefined>(undefined);
  const [busy, setBusy] = useState<"" | "check" | "test" | "save" | "disconnect">("");
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [edit, setEdit] = useState(false);
  const [nameEdit, setNameEdit] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ user: "", pass: "", fromName: "" });
  const load = () => fetch("/api/admin/services", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => setM(d?.email ?? null)).catch(() => setM(null));
  useEffect(() => {
    load();
    // Back from Google's screen: say how it went, then drop the result from the address bar.
    const q = new URLSearchParams(window.location.search), ok = q.get("mail_connected"), err = q.get("mail_error");
    if (ok || err) {
      toast({ ok: !!ok, text: ok ? `Gmail connected — welcome emails go out from ${ok}` : `Couldn't connect Gmail: ${err}` });
      q.delete("mail_connected"); q.delete("mail_error");
      window.history.replaceState(null, "", `${window.location.pathname}?${q}`);
    }
  }, []);
  if (m === undefined) return <div className="skeleton h-40 w-full rounded-2xl" />;
  if (!m) return <div className="card p-5 text-sm text-bad">Couldn&apos;t load the email settings.</div>;

  const check = async () => { setBusy("check"); const r = await post<{ ok: boolean; message: string }>("/api/admin/services", { service: "email", check: true }); setBusy(""); setStatus({ ok: !r.error && r.ok, message: r.error || r.message }); };
  const test = async () => {
    setBusy("test");
    const r = await post<{ message?: string }>("/api/admin/services", { service: "email", test: true, appUrl: window.location.origin });
    setBusy("");
    toast({ ok: !r.error, text: r.error || r.message || "Sent" });
  };
  const disconnect = async (which: "gmail" | "smtp") => {
    setBusy("disconnect");
    const r = await post<{ message?: string }>("/api/admin/services", { service: "email", disconnect: which });
    setBusy("");
    toast({ ok: !r.error, text: r.error || r.message || "Done" });
    setStatus(null); load();
  };
  const saveName = async () => {
    setBusy("save");
    const r = await post("/api/admin/services", { service: "email", fromName: nameEdit ?? "" });
    setBusy("");
    toast({ ok: !r.error, text: r.error || "Sender name saved" });
    if (!r.error) { setNameEdit(null); load(); }
  };
  const save = async () => {
    setBusy("save");
    const r = await post("/api/admin/services", { service: "email", user: f.user, pass: f.pass, fromName: f.fromName });
    setBusy("");
    if (r.error) return toast({ ok: false, text: r.error });
    toast({ ok: true, text: m.method === "gmail" ? "Saved" : "Saved — welcome emails are sent from this mailbox" });
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
        {/* A full page visit (not client routing): it's an API route that sends the browser to Google. */}
        <a className={m.method === "gmail" ? btn : btnPrimary} href="/api/auth/google?purpose=mail"
          title="Sign in with the Google account to send from and allow 'Send email on your behalf'">{m.method === "gmail" ? "Reconnect Gmail" : "Connect Gmail"}</a>
      </div>
      {edit && (
        <div className="mb-4 grid gap-3 rounded-lg bg-bg p-4 sm:grid-cols-2">
          <p className="text-xs text-muted sm:col-span-2">SMTP with an App Password — only where the server can reach port 465/587. Railway blocks these on Trial / Hobby plans; use <b>Connect Gmail</b> there.</p>
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
        {row("Sends from", m.method ? <>{m.fromName} &lt;{m.method === "gmail" ? m.gmailSender : m.user}&gt;</> : <span className="text-muted">not set — click <b>Connect Gmail</b> and sign in with the mailbox to send from</span>)}
        {row("Method", m.method === "gmail"
          ? <span>Gmail, via Google sign-in (send-only permission) · <button className="text-bad underline-offset-2 hover:underline disabled:opacity-50" disabled={!!busy} onClick={() => disconnect("gmail")}>Disconnect</button></span>
          : m.method === "smtp" ? <span>SMTP <code className="text-xs">{m.host}:{m.port}</code> with an App Password</span>
          : <span className="text-muted">none</span>)}
        {m.method === "smtp" && row("App Password", <TokenField which="email" preview={m.tokenPreview} />)}
        {row("Sender name", <span>{m.fromName} <button className="ml-2 text-accent-strong underline-offset-2 hover:underline" onClick={() => setNameEdit(nameEdit === null ? m.fromName : null)}>{nameEdit === null ? "Change" : "Cancel"}</button>
          {nameEdit !== null && <span className="mt-2 flex gap-2"><input className={`${input} max-w-xs`} value={nameEdit} placeholder="Dev Resolve" onChange={(e) => setNameEdit(e.target.value)} />
            <button className={btnPrimary} disabled={!!busy} onClick={saveName}>Save</button></span>}</span>)}
        {row("SMTP instead", <span>{m.smtp ? <>{m.user} · </> : null}<button className="text-accent-strong underline-offset-2 hover:underline" onClick={() => { setF({ user: m.user, pass: "", fromName: m.fromName }); setEdit((e) => !e); }}>{edit ? "Close" : m.smtp ? "Edit" : "Set up SMTP"}</button>
          {m.smtp && <> · <button className="text-bad underline-offset-2 hover:underline disabled:opacity-50" disabled={!!busy} onClick={() => disconnect("smtp")}>Remove</button></>}
          {m.smtp && m.method === "gmail" && <span className="text-muted"> (not used while Gmail is connected)</span>}</span>)}
        {status && row("Connection", <span className={status.ok ? "text-ok" : "text-bad"}>{status.ok ? "● " : "○ "}{status.message}</span>)}
        {row("Welcome email", <span>Sign-in link and the onboarding steps, sent when you add someone. Passwords are never emailed.
          <button className="ml-2 font-medium text-accent-strong underline-offset-2 hover:underline" onClick={() => setEditing(true)}>Edit email</button></span>)}
      </dl>
      {editing && <WelcomeEmailEditor onClose={() => setEditing(false)} />}
    </section>
  );
}
