"use client";
import { useEffect, useState } from "react";

interface Status {
  mode: boolean; user: string; online: boolean; vpnUp: boolean; lastSeen: string | null; version?: string;
  vpn: Record<string, boolean>; vpnHosts: string[];
  signins: { metabase: { project: string; baseUrl?: string; signedIn: boolean }[]; appLog: { project: string; signedIn: boolean } | null };
}

const Dot = ({ ok, warn }: { ok: boolean; warn?: boolean }) => (
  <span className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? "bg-ok" : warn ? "bg-warn" : "bg-bad"}`} />
);

/** Set up and watch *your* local connector: it carries your client-VPN requests and brings your Google sign-ins. */
export default function ConnectorPage() {
  const [s, setS] = useState<Status | null>(null);
  const [token, setToken] = useState<{ token: string; server: string } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () => fetch("/api/connector/status", { cache: "no-store" }).then((r) => r.json()).then((d) => live && setS(d)).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => { live = false; clearInterval(t); };
  }, []);

  async function makeToken() {
    const r = await fetch("/api/connector/token", { method: "POST" });
    const d = await r.json();
    if (r.ok) setToken(d); else setMsg(d.error);
  }
  async function signin(what: string[]) {
    setMsg(null);
    const r = await fetch("/api/connector/request-signin", { method: "POST", body: JSON.stringify({ what }) });
    const d = await r.json();
    setMsg(r.ok ? "A Chrome window is opening on your laptop — sign in with your work Google account there." : d.error);
  }

  if (!s) return <div className="skeleton h-40 w-full max-w-3xl rounded-xl" />;
  const cmd = token && `node dev-resolve-connector.mjs --server ${token.server} --token ${token.token}`;
  const needs = [...s.signins.metabase.filter((m) => !m.signedIn).map((m) => m.project), ...(s.signins.appLog && !s.signins.appLog.signedIn ? ["app_log"] : [])];

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Your local connector</h1>
        <p className="mt-1 text-sm text-muted">
          The server can&apos;t join the client VPN or sign in to Google for you. A small program on <b>your</b> laptop does both:
          your investigations reach VPN-only systems through your laptop (while it&apos;s on the VPN), and Google-login Metabase / app logs use
          <b> your own</b> sign-in. Nobody else&apos;s investigations use your laptop or your sign-ins.
        </p>
        {!s.mode && <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-warn ring-1 ring-amber-200">Connector mode is off on this server (local setup) — connections are made directly from this machine.</p>}
      </div>

      <section className="card space-y-3 p-5">
        <h2 className="font-semibold">Status</h2>
        <div className="flex items-center gap-2 text-sm"><Dot ok={s.online} />
          {s.online ? <>Connector running{s.version && <span className="text-muted"> · v{s.version}</span>}</> : <>Not running{s.lastSeen && <span className="text-muted"> · last seen {new Date(s.lastSeen).toLocaleString("en-IN")}</span>}</>}
        </div>
        <div className="flex items-start gap-2 text-sm"><span className="mt-1"><Dot ok={s.vpnUp} warn={!s.online} /></span>
          <div>
            {s.online ? (s.vpnUp ? "VPN connected — VPN-only systems reachable from your laptop" : "Your laptop can't reach VPN-only systems — connect the VPN") : "VPN: unknown until the connector runs"}
            {s.online && (
              <ul className="mt-1 space-y-0.5 text-xs text-muted">
                {s.vpnHosts.map((h) => <li key={h}>{s.vpn[h] ? "✓" : "✗"} {h}</li>)}
              </ul>
            )}
          </div>
        </div>
        <div className="border-t border-line pt-3">
          <div className="mb-2 text-sm font-medium">Your Google sign-ins</div>
          <ul className="space-y-1.5 text-sm">
            {s.signins.metabase.map((m) => (
              <li key={m.project} className="flex items-center gap-2"><Dot ok={m.signedIn} warn />
                <span>Metabase · {m.project}</span><span className="text-xs text-muted">{m.signedIn ? "signed in" : "not signed in"}</span>
                <button onClick={() => signin([m.project])} disabled={!s.online} className="ml-auto rounded-md border border-line px-2 py-0.5 text-xs hover:border-accent disabled:opacity-40">{m.signedIn ? "Sign in again" : "Sign in"}</button>
              </li>
            ))}
            {s.signins.appLog && (
              <li className="flex items-center gap-2"><Dot ok={s.signins.appLog.signedIn} warn />
                <span>App logs</span><span className="text-xs text-muted">{s.signins.appLog.signedIn ? "signed in" : "not signed in"}</span>
                <button onClick={() => signin(["app_log"])} disabled={!s.online} className="ml-auto rounded-md border border-line px-2 py-0.5 text-xs hover:border-accent disabled:opacity-40">{s.signins.appLog.signedIn ? "Sign in again" : "Sign in"}</button>
              </li>
            )}
          </ul>
          {needs.length > 1 && s.online && <button onClick={() => signin(needs)} className="mt-3 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-strong">Sign in to all missing ({needs.length})</button>}
          {msg && <p className="mt-2 text-xs text-muted">{msg}</p>}
        </div>
      </section>

      <section className="card space-y-3 p-5 text-sm">
        <h2 className="font-semibold">Set up (once per laptop)</h2>
        <ol className="list-decimal space-y-3 pl-5">
          <li>Needs <b>Node 22+</b> and <b>Google Chrome</b>. <a className="text-accent hover:underline" href="/dev-resolve-connector.mjs" download>Download the connector</a> (one file, no install).</li>
          <li>
            <button onClick={makeToken} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-strong">{token ? "Make a new token" : "Make my connector token"}</button>
            <span className="ml-2 text-xs text-muted">Shown once. Making a new one retires the old one.</span>
            {cmd && (
              <div className="mt-2">
                <div className="text-xs text-muted">Run this in a terminal, in the folder you downloaded it to:</div>
                <div className="mt-1 flex items-start gap-2">
                  <code className="block flex-1 break-all rounded-lg bg-bg px-3 py-2 font-mono text-xs ring-1 ring-line">{cmd}</code>
                  <button onClick={() => { navigator.clipboard.writeText(cmd); setCopied(true); }} className="rounded-md border border-line px-2 py-1 text-xs">{copied ? "Copied" : "Copy"}</button>
                </div>
              </div>
            )}
          </li>
          <li>After the first time, just run <code className="rounded bg-bg px-1 font-mono text-xs">node dev-resolve-connector.mjs</code> whenever you use Dev Resolve (keep the VPN connected).</li>
        </ol>
        <p className="text-xs text-muted">
          Safety: the connector only calls hosts ending in the VPN host suffix it pinned on first run, only GET/POST, and only while it&apos;s running.
          Google sign-in happens in its own Chrome profile on your laptop; only the resulting session reaches Dev Resolve, stored for you alone.
        </p>
      </section>
    </div>
  );
}
