"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { confirmDialog, toast } from "@/components/Dialog";
import { btn, btnPrimary, Field, input, post } from "./ui";

type Info = Record<string, { present: boolean; size?: number; updated?: string; files?: number; by?: string | null }>;
const FILES = [
  { kind: "projects.json", label: "projects.json", what: "Every client and connection (Clients and Connections tabs) in one file.",
    upload: "Replaces all clients and connections", download: "/api/admin/private-files?download=projects.json", accept: ".json" },
  { kind: "config.env", label: "config.env", what: "Every endpoint, username, password and token (Connections, Claude, DevRev, Email, GitHub).",
    upload: "Replaces all credentials", download: "/api/admin/private-files?download=config.env", accept: ".env,text/plain", secret: true },
  { kind: "knowledge.tgz", label: "Knowledge base", what: "Everything the agent has learned per client: playbooks, saved queries, verified facts.",
    upload: "Merged in — nothing is deleted", download: "/api/admin/knowledge-archive", accept: ".tgz,.gz,application/gzip" },
];

/** Bulk files, backups and the Chrome extension package — all from the browser. */
export function FilesTab() {
  const [info, setInfo] = useState<Info | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [settings, setSettings] = useState<Record<string, { label: string; value: string }> | null>(null);
  const [store, setStore] = useState("");
  // The site's own address (browser only — empty while rendering on the server, so the HTML matches).
  const origin = useSyncExternalStore(() => () => {}, () => window.location.origin, () => "");
  const load = () => fetch("/api/admin/private-files", { cache: "no-store" }).then(async (r) => { if (r.ok) setInfo(await r.json()); }).catch(() => {});
  useEffect(() => {
    load();
    fetch("/api/admin/settings").then(async (r) => { if (!r.ok) return; const d = await r.json(); setSettings(d); setStore(d.EXTENSION_STORE_URL?.value ?? ""); }).catch(() => {});
  }, []);

  async function upload(kind: string, file?: File) {
    if (!file) return;
    setBusy(kind);
    const fd = new FormData(); fd.set("kind", kind); fd.set("file", file);
    const r = await fetch("/api/admin/private-files", { method: "POST", body: fd });
    const d = await r.json().catch(() => ({}));
    setBusy(null);
    toast({ ok: r.ok, text: r.ok ? d.message : d.error || `HTTP ${r.status}` });
    load();
  }
  const [open, setOpen] = useState(false);
  const meta = (k: string) => info?.[k === "knowledge.tgz" ? "knowledge" : k];
  const when = (iso?: string) => (iso ? new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" }) : "—");
  const kb = (n?: number) => (n == null ? "—" : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
  const latest = info ? Object.values(info).filter((x) => x.present && x.updated).sort((x, y) => (y.updated! > x.updated! ? 1 : -1))[0] : undefined;
  const confirmUpload = async (f: (typeof FILES)[number], file?: File) => {
    if (!file) return;
    if (f.kind !== "knowledge.tgz" && !(await confirmDialog({ title: `Upload ${f.label}?`, message: `${f.upload} on this server with the contents of "${file.name}". Download the current one first if you may need it back.`, confirmLabel: "Upload", danger: true }))) return;
    upload(f.kind, file);
  };
  const download = async (f: (typeof FILES)[number]) => {
    if (f.secret && !(await confirmDialog({ title: "Download config.env?", message: "It contains every password and token in plain text. Keep it somewhere safe and delete it when you're done. The download is logged.", confirmLabel: "Download" }))) return;
    const a = document.createElement("a"); a.href = f.download; a.click();
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
        <Field label="Chrome Web Store link" hint={<>e.g. <code className="font-mono">https://chromewebstore.google.com/detail/dev-resolve/abcdefghijklmnop</code></>}>
          <div className="flex gap-2">
            <input className={input} value={store} placeholder="https://" onChange={(e) => setStore(e.target.value)} />
            <button className={btnPrimary} disabled={busy === "store" || store === (settings?.EXTENSION_STORE_URL?.value ?? "")}
              onClick={async () => { setBusy("store"); const r = await post("/api/admin/settings", { EXTENSION_STORE_URL: store }); setBusy(null); toast({ ok: !r.error, text: r.error || "Saved — the Connector page now shows Add to Chrome" }); }}>Save</button>
          </div>
        </Field>
      </section>

      <section className="card overflow-hidden">
        <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={`flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-bg ${open ? "bg-bg" : ""}`}>
          <h2 className="font-semibold">Private files</h2>
          <span className="truncate text-xs text-muted">Back up, move or restore Dev Resolve&apos;s setup{latest && ` · last change ${when(latest.updated)}`}</span>
          <svg className={`ml-auto shrink-0 text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
        </button>
        {open && (
          <div className="chat-pop space-y-4 border-t border-line p-5">
            <div className="grid gap-3 text-sm sm:grid-cols-3">
              {[
                ["What it is", "The settings and knowledge behind Dev Resolve. They're kept in its database (never in the code repository) and survive every deploy."],
                ["Download to", "Keep a backup before a big change, or copy the setup to another Dev Resolve (e.g. from a laptop to production)."],
                ["Upload to", "Restore a backup or bring in a setup in one go. Day to day, edit things in the Clients and Connections tabs instead."],
              ].map(([h, t]) => <div key={h} className="rounded-lg bg-bg p-3"><div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{h}</div><p className="text-muted">{t}</p></div>)}
            </div>
            <div className="overflow-x-auto rounded-xl border border-line">
              <table className="w-full min-w-[56rem] text-sm">
                <thead className="bg-bg text-left text-xs text-muted">
                  <tr><th className="px-3 py-2 font-medium">File</th><th className="px-3 py-2 font-medium">What&apos;s in it</th><th className="px-3 py-2 text-right font-medium">Size</th>
                    <th className="px-3 py-2 font-medium">Updated on</th><th className="px-3 py-2 font-medium">Updated by</th><th className="px-3 py-2 text-right font-medium">Actions</th></tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {FILES.map((f) => {
                    const m = meta(f.kind);
                    const act = "rounded-md border border-line bg-panel px-2 py-1 text-xs font-medium transition hover:border-accent hover:text-accent-strong disabled:opacity-40";
                    return (
                      <tr key={f.kind} className="align-top transition hover:bg-bg/60">
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <div className="font-medium">{f.label}</div>
                          {f.secret && <span className="mt-1 inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-warn">contains credentials</span>}
                        </td>
                        <td className="max-w-md px-3 py-2.5"><div className="text-muted">{f.what}</div><div className="mt-0.5 text-xs text-muted">Upload: {f.upload.toLowerCase()}</div></td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-muted">{!m ? "…" : !m.present ? "—" : f.kind === "knowledge.tgz" ? `${m.files ?? "?"} files` : kb(m.size)}</td>
                        <td className="whitespace-nowrap px-3 py-2.5">{!m ? "…" : m.present ? when(m.updated) : <span className="text-muted">not saved yet</span>}</td>
                        <td className="whitespace-nowrap px-3 py-2.5">{m?.by ?? <span className="text-muted">—</span>}</td>
                        <td className="whitespace-nowrap px-3 py-2.5">
                          <div className="flex justify-end gap-1.5">
                            <button type="button" className={act} disabled={!m?.present} onClick={() => download(f)}>Download</button>
                            <label className={`${act} cursor-pointer ${busy === f.kind ? "opacity-50" : ""}`}>
                              {busy === f.kind ? "Uploading…" : "Upload"}
                              <input type="file" accept={f.accept} className="hidden" disabled={!!busy} onChange={(e) => { confirmUpload(f, e.target.files?.[0]); e.target.value = ""; }} />
                            </label>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
