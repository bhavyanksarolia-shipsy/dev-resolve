"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { btn, btnPrimary, Field, input, Note, post } from "./ui";

type Info = Record<string, { present: boolean; size?: number; updated?: string; files?: number }>;
const FILES = [
  { kind: "projects.json", label: "projects.json", hint: "All clients and connections at once (from another Dev Resolve or a backup). Normally edit them in the Clients / Connections tabs.", accept: ".json" },
  { kind: "config.env", label: "config.env", hint: "All endpoints and credentials at once. Normally set them per connection in the Connections tab.", accept: ".env,text/plain" },
  { kind: "knowledge.tgz", label: "Knowledge base (.tgz)", hint: "An archive from “Download knowledge base” (e.g. from another Dev Resolve) — merged into this one.", accept: ".tgz,.gz,application/gzip" },
];

/** Bulk files, backups and the Chrome extension package — all from the browser. */
export function FilesTab() {
  const [info, setInfo] = useState<Info | null>(null);
  const [msg, setMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [settings, setSettings] = useState<Record<string, { label: string; value: string }> | null>(null);
  const [store, setStore] = useState("");
  // The site's own address (browser only — empty while rendering on the server, so the HTML matches).
  const origin = useSyncExternalStore(() => () => {}, () => window.location.origin, () => "");
  const load = () => fetch("/api/admin/private-files", { cache: "no-store" }).then((r) => r.json()).then(setInfo);
  useEffect(() => {
    load();
    fetch("/api/admin/settings").then((r) => r.json()).then((d) => { setSettings(d); setStore(d.EXTENSION_STORE_URL?.value ?? ""); });
  }, []);

  async function upload(kind: string, file?: File) {
    if (!file) return;
    setBusy(kind);
    const fd = new FormData(); fd.set("kind", kind); fd.set("file", file);
    const r = await fetch("/api/admin/private-files", { method: "POST", body: fd });
    const d = await r.json().catch(() => ({}));
    setBusy(null);
    setMsg((m) => ({ ...m, [kind]: { ok: r.ok, text: r.ok ? d.message : d.error || `HTTP ${r.status}` } }));
    load();
  }
  const status = (k: string) => {
    const i = info?.[k === "knowledge.tgz" ? "knowledge" : k];
    if (!i) return "…";
    if (!i.present) return "not saved yet";
    return `saved · ${k === "knowledge.tgz" ? `${i.files ?? "?"} files · ` : i.size ? `${Math.round(i.size / 1024)} KB · ` : ""}updated ${new Date(i.updated!).toLocaleString("en-IN")}`;
  };

  return (
    <div className="space-y-5">
      <section className="card space-y-3 p-5">
        <h2 className="font-semibold">Chrome extension</h2>
        <p className="text-sm text-muted">Users need the Dev Resolve extension for VPN-only systems and their Google sign-ins. Publish it once on the Chrome Web Store
          (visibility <b>Private</b> = only your Google Workspace) so everyone gets an <b>Add to Chrome</b> button.</p>
        <div className="flex flex-wrap gap-2">
          <a className={btnPrimary} href="/api/admin/extension-package">Download package for the Web Store</a>
          <a className={btn} href="https://chrome.google.com/webstore/devconsole" target="_blank" rel="noreferrer">Open the Web Store developer dashboard ↗</a>
        </div>
        <ol className="list-decimal space-y-1 pl-5 text-xs text-muted">
          <li>Dashboard → <b>New item</b> → upload the downloaded zip.</li>
          <li>Listing: name “Dev Resolve connector”, category Developer Tools, privacy policy <code className="rounded bg-bg px-1">{origin}/privacy</code>.</li>
          <li>Privacy tab: single purpose “let the company&apos;s Dev Resolve reach internal systems through the user&apos;s laptop and use their own sign-ins”; no remote code.</li>
          <li>Visibility <b>Private</b> → submit. When it&apos;s approved, paste its store link below.</li>
        </ol>
        <Field label="Chrome Web Store link" hint="When set, the Connector page shows “Add to Chrome” instead of the manual install.">
          <div className="flex gap-2">
            <input className={input} value={store} placeholder="https://chromewebstore.google.com/detail/…" onChange={(e) => setStore(e.target.value)} />
            <button className={btnPrimary} disabled={busy === "store" || store === (settings?.EXTENSION_STORE_URL?.value ?? "")}
              onClick={async () => { setBusy("store"); const r = await post("/api/admin/settings", { EXTENSION_STORE_URL: store }); setBusy(null); setMsg((m) => ({ ...m, store: { ok: !r.error, text: r.error || "Saved — the Connector page now shows Add to Chrome" } })); }}>Save</button>
          </div>
        </Field>
        {msg.store && <Note ok={msg.store.ok}>{msg.store.text}</Note>}
      </section>

      <section className="card divide-y divide-line">
        <div className="p-4">
          <h2 className="font-semibold">Private files</h2>
          <p className="mt-1 text-xs text-muted">Kept in the backend&apos;s database (never in the repo or the frontend) and survive every deploy. Uploading replaces the stored copy; knowledge is merged.</p>
        </div>
        {FILES.map((f) => (
          <div key={f.kind} className="flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-56 flex-1">
              <div className="font-medium">{f.label}</div>
              <div className="text-xs text-muted">{f.hint}</div>
              <div className="mt-1 text-xs">{status(f.kind)}</div>
              {msg[f.kind] && <div className={`mt-1 text-xs ${msg[f.kind].ok ? "text-ok" : "text-bad"}`}>{msg[f.kind].text}</div>}
            </div>
            <label className={`cursor-pointer ${btn} ${busy === f.kind ? "opacity-50" : ""}`}>
              {busy === f.kind ? "Uploading…" : "Upload"}
              <input type="file" accept={f.accept} className="hidden" disabled={!!busy} onChange={(e) => { upload(f.kind, e.target.files?.[0]); e.target.value = ""; }} />
            </label>
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-3 p-4">
          <div className="min-w-56 flex-1"><div className="font-medium">Backup</div><div className="text-xs text-muted">Download everything the agent has learned (playbooks, saved queries) as one archive.</div></div>
          <a className={btn} href="/api/admin/knowledge-archive">Download knowledge base</a>
        </div>
      </section>
    </div>
  );
}
