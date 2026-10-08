"use client";
import { CopyButton } from "@/components/CopyButton";
import { MyClaudeCard } from "@/components/MyClaudeCard";
import { useEffect, useRef, useState } from "react";

interface Status {
  mode: boolean; user: string; online: boolean; vpnUp: boolean; lastSeen: string | null; version?: string; storeUrl?: string | null;
  vpn: Record<string, boolean>; vpnHosts: string[];
  /** The two different VPNs: the client's (Cisco AnyConnect) and the company's (Pritunl, for the Claude gateway). */
  vpns?: { id: string; name: string; app: string; purpose: string; hosts: string[] }[];
  signins: { metabase: { project: string; label?: string; baseUrl?: string; signedIn: boolean }[]; appLog: { project: string; signedIn: boolean } | null };
}
type Tone = "ok" | "bad" | "wait";

const TONE: Record<Tone, { ring: string; dot: string; text: string }> = {
  ok: { ring: "ring-emerald-200 bg-emerald-50/60", dot: "bg-ok", text: "text-ok" },
  bad: { ring: "ring-red-200 bg-red-50/60", dot: "bg-bad", text: "text-bad" },
  wait: { ring: "ring-line bg-panel", dot: "bg-warn", text: "text-warn" },
};

function Tile({ tone, title, value, detail }: { tone: Tone; title: string; value: string; detail: string }) {
  const t = TONE[tone];
  return (
    <div className={`rounded-xl p-4 ring-1 ${t.ring}`}>
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted"><span className={`h-2.5 w-2.5 rounded-full ${t.dot}`} />{title}</div>
      <div className={`mt-2 text-lg font-semibold ${t.text}`}>{value}</div>
      <div className="mt-0.5 text-xs text-muted">{detail}</div>
    </div>
  );
}

/** Your connector: the Chrome extension that gives your investigations your VPN and your Google sign-ins. */
export default function ConnectorPage() {
  const [s, setS] = useState<Status | null>(null);
  const [ext, setExt] = useState<{ version: string; linked?: boolean } | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [showHosts, setShowHosts] = useState(false);
  const [showNode, setShowNode] = useState(false);
  const [token, setToken] = useState<{ token: string; server: string } | null>(null);
  const linking = useRef(false);

  useEffect(() => {
    let live = true;
    const load = () => fetch("/api/connector/status", { cache: "no-store" }).then((r) => r.json()).then((d) => live && setS(d)).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => { live = false; clearInterval(t); };
  }, []);

  // Find the extension on this page and, if it isn't linked yet, hand it this person's token. The extension's
  // script and this page start in either order, so keep asking for a few seconds instead of once.
  useEffect(() => {
    const ask = (type: string, extra: object = {}) => window.postMessage({ source: "devresolve-page", type, ...extra }, location.origin);
    let found = false;
    const onMsg = async (e: MessageEvent) => {
      if (e.source !== window || e.data?.source !== "devresolve-ext") return;
      if (e.data.type === "hello") { found = true; setExt((x) => ({ ...x, version: e.data.version })); ask("status"); }
      if (e.data.type === "status-result" && e.data.res) {
        setExt({ version: e.data.res.version, linked: e.data.res.linked });
        if (!e.data.res.linked && !linking.current) {
          linking.current = true;
          const r = await fetch("/api/connector/token", { method: "POST" });
          const d = await r.json();
          if (r.ok) ask("link", { token: d.token });
        }
      }
      if (e.data.type === "link-result" && e.data.res?.ok) setExt((x) => (x ? { ...x, linked: true } : x));
    };
    window.addEventListener("message", onMsg);
    let tries = 0;
    const t = setInterval(() => { if (found || ++tries > 10) clearInterval(t); else ask("ping"); }, 700);
    ask("ping");
    return () => { window.removeEventListener("message", onMsg); clearInterval(t); };
  }, []);

  async function signin(what: string[]) {
    setMsg(null);
    const r = await fetch("/api/connector/request-signin", { method: "POST", body: JSON.stringify({ what }) });
    const d = await r.json();
    setMsg(r.ok ? "A sign-in tab is opening — pick your work Google account; it closes by itself." : d.error);
  }
  async function makeToken() {
    const r = await fetch("/api/connector/token", { method: "POST" });
    if (r.ok) setToken(await r.json());
  }

  if (!s) return <div className="mx-auto max-w-5xl space-y-4"><div className="skeleton h-10 w-72" /><div className="grid gap-4 sm:grid-cols-3">{[0, 1, 2].map((i) => <div key={i} className="skeleton h-28 rounded-xl" />)}</div></div>;

  const viaExt = s.online && s.version?.startsWith("ext-");
  const running = s.online;
  const installedHere = !!ext || viaExt;
  const signins = [...s.signins.metabase.map((m) => ({ key: m.project, label: `Metabase · ${m.label ?? m.project}`, ok: m.signedIn })),
    ...(s.signins.appLog ? [{ key: "app_log", label: "App logs", ok: s.signins.appLog.signedIn }] : [])];
  const signedIn = signins.filter((x) => x.ok).length;
  const vpns = (s.vpns ?? [{ id: "client", name: "Client VPN", app: "", purpose: "VPN-only systems", hosts: s.vpnHosts }]).map((g) => {
    const okCount = g.hosts.filter((h) => s.vpn[h]).length;
    return { ...g, okCount, up: okCount === g.hosts.length };
  });
  const vpnOkCount = vpns.reduce((n, g) => n + g.okCount, 0), vpnHostCount = vpns.reduce((n, g) => n + g.hosts.length, 0);
  const vpnLabel = (g: (typeof vpns)[number]) => (g.app ? `${g.app} (${g.name})` : g.name);
  const todo = [
    !running && "install / open the Chrome extension",
    ...(running ? vpns.filter((g) => !g.up).map((g) => `connect ${vpnLabel(g)}`) : []),
    signedIn < signins.length && `sign in to ${signins.length - signedIn} more`,
  ].filter(Boolean) as string[];
  const cmd = token && `node dev-resolve-connector.mjs --server ${token.server} --token ${token.token}`;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Your connector</h1>
        <p className="mt-1 text-sm text-muted">Your investigations use <b>your</b> laptop&apos;s VPN and <b>your</b> Google sign-ins, through the Dev Resolve Chrome extension.</p>
      </div>

      {!s.mode && <div className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-warn ring-1 ring-amber-200">Connector mode is off on this server (local setup): the server reaches the client VPN and your sign-ins directly, so the extension isn&apos;t needed here.</div>}

      <div className={`flex items-center gap-3 rounded-xl px-5 py-4 ring-1 ${todo.length ? "bg-amber-50 ring-amber-200" : "bg-emerald-50 ring-emerald-200"}`}>
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg text-white ${todo.length ? "bg-warn" : "bg-ok"}`}>{todo.length ? "!" : "✓"}</span>
        <div>
          <div className={`font-semibold ${todo.length ? "text-warn" : "text-ok"}`}>{todo.length ? `${todo.length} thing${todo.length > 1 ? "s" : ""} to do` : "You're all set"}</div>
          <div className="text-sm text-muted">{todo.length ? `To investigate every client: ${todo.join(", then ")}.` : `Investigations can reach every system with your access. Keep Chrome open${vpns.length ? ` and ${vpns.map((g) => g.app || g.name).join(" + ")} connected` : ""}.`}</div>
        </div>
      </div>

      <div className={`grid gap-4 sm:grid-cols-2 ${vpns.length > 1 ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
        <Tile tone={running ? "ok" : "bad"} title="Chrome extension" value={running ? "Running" : "Not running"}
          detail={running ? `${viaExt ? `v${s.version!.slice(4)}` : `terminal v${s.version ?? "?"}`} · linked to ${s.user}` : s.lastSeen ? `last seen ${new Date(s.lastSeen).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}` : "not set up yet"} />
        {vpns.map((g) => (
          <Tile key={g.id} tone={!running ? "wait" : g.up ? "ok" : "bad"} title={g.name} value={!running ? "Unknown" : g.up ? "Connected" : "Not connected"}
            detail={`${g.app ? `${g.app} · ` : ""}${!running ? "shows once the extension runs" : g.up ? `for ${g.purpose}` : `connect it for ${g.purpose}`}`} />
        ))}
        <Tile tone={signedIn === signins.length ? "ok" : "bad"} title="Google sign-ins" value={`${signedIn} of ${signins.length}`}
          detail={signedIn === signins.length ? "all signed in" : `${signins.length - signedIn} need signing in`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-6">
          <section className="card divide-y divide-line">
            <div className="flex items-center gap-2 px-5 py-3">
              <h2 className="font-semibold">Google sign-ins</h2>
              {signedIn < signins.length && running && (
                <button onClick={() => signin(signins.filter((x) => !x.ok).map((x) => x.key))} className="ml-auto rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-strong">Sign in to all missing</button>
              )}
            </div>
            {signins.map((x) => (
              <div key={x.key} className="flex items-center gap-3 px-5 py-3 text-sm">
                <span className={`h-2.5 w-2.5 rounded-full ${x.ok ? "bg-ok" : "bg-bad"}`} />
                <span className="flex-1">{x.label}</span>
                <span className={`text-xs ${x.ok ? "text-ok" : "text-bad"}`}>{x.ok ? "signed in" : "not signed in"}</span>
                <button onClick={() => signin([x.key])} disabled={!running} title={running ? "" : "Needs the extension running"}
                  className="rounded-md border border-line px-2.5 py-1 text-xs hover:border-accent disabled:opacity-40">{x.ok ? "Sign in again" : "Sign in"}</button>
              </div>
            ))}
            {msg && <div className="px-5 py-3 text-xs text-muted">{msg}</div>}
          </section>

          <MyClaudeCard />

          <section className="card">
            <button type="button" onClick={() => setShowHosts((v) => !v)} className="flex w-full items-center gap-2 px-5 py-3 text-left">
              <h2 className="font-semibold">VPN-only systems</h2>
              <span className="text-xs text-muted">{running ? `${vpnOkCount}/${vpnHostCount} reachable` : "checked by the extension"}</span>
              <span className={`ml-auto text-muted transition-transform ${showHosts ? "rotate-90" : ""}`}>›</span>
            </button>
            {showHosts && (
              <div className="space-y-3 border-t border-line px-5 py-3">
                {vpns.map((g) => (
                  <div key={g.id}>
                    <div className="text-xs font-semibold">{vpnLabel(g)} <span className="font-normal text-muted">— {g.purpose}</span></div>
                    <ul className="mt-1 space-y-1 font-mono text-xs">
                      {g.hosts.map((h) => <li key={h} className={running ? (s.vpn[h] ? "text-ok" : "text-bad") : "text-muted"}>{running ? (s.vpn[h] ? "✓" : "✗") : "·"} {h}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          {!running || !installedHere ? (
            <section className="card space-y-4 p-5">
              <h2 className="font-semibold">Set up the extension <span className="text-xs font-normal text-muted">· once per laptop</span></h2>
              {s.storeUrl ? (
                <>
                  <a href={s.storeUrl} target="_blank" rel="noreferrer" className="block rounded-lg bg-accent px-4 py-2.5 text-center text-sm font-medium text-white hover:bg-accent-strong">Add to Chrome</a>
                  <p className="text-xs text-muted">Then come back to this page — it links itself to you.</p>
                </>
              ) : (
                <ol className="space-y-3 text-sm">
                  {[
                    <><a className="font-medium text-accent-strong underline" href="/api/connector/extension">Download the extension</a> and unzip it</>,
                    <>Open <code className="rounded bg-bg px-1 font-mono text-xs">chrome://extensions</code> and switch on <b>Developer mode</b></>,
                    <>Click <b>Load unpacked</b> and pick the unzipped folder</>,
                    <>Come back here — it links itself to you</>,
                  ].map((step, i) => (
                    <li key={i} className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-soft text-xs font-semibold text-accent-strong">{i + 1}</span><span className="pt-0.5">{step}</span></li>
                  ))}
                </ol>
              )}
            </section>
          ) : (
            <section className="card space-y-2 p-5 text-sm">
              <h2 className="font-semibold">Extension</h2>
              <p className="text-muted">Installed{ext?.version ? ` · v${ext.version}` : ""} · linked to you. Nothing to run — it works whenever Chrome is open.</p>
              <a className="text-xs text-accent-strong underline" href={s.storeUrl || "/api/connector/extension"} target={s.storeUrl ? "_blank" : undefined} rel="noreferrer">{s.storeUrl ? "Open in the Chrome Web Store" : "Download again (after an update)"}</a>
            </section>
          )}

          <section className="card space-y-2 p-5 text-xs text-muted">
            <h2 className="text-sm font-semibold text-fg">What it does</h2>
            <p>Only for <b>your</b> investigations: read requests to the VPN-only systems above, made from your laptop, and your own sessions for Google-login tools.</p>
            <p>It only talks to the hosts in its manifest. Your Google password never leaves Google&apos;s pages; only the session reaches Dev Resolve, stored for you alone.</p>
            <button type="button" onClick={() => setShowNode((v) => !v)} className="text-accent-strong underline">{showNode ? "Hide" : "No Chrome? Use"} the terminal connector</button>
            {showNode && (
              <div className="space-y-2 pt-1">
                <p>Needs Node 22+. <a className="text-accent-strong underline" href="/dev-resolve-connector.mjs" download>Download it</a>, then:</p>
                <button onClick={makeToken} className="rounded-md border border-line px-2.5 py-1 text-xs hover:border-accent">{token ? "Make a new token" : "Make my token"}</button>
                {cmd && (
                  <div className="flex items-start gap-2">
                    <code className="block flex-1 break-all rounded-md bg-bg px-2 py-1.5 font-mono ring-1 ring-line">{cmd}</code>
                    <CopyButton text={cmd} label="Copy command" className="rounded-md border border-line px-2 py-1 hover:border-accent">Copy</CopyButton>
                  </div>
                )}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
