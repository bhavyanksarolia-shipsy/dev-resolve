"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "@/components/Dialog";
import { btn, btnPrimary, Field, input, post } from "./ui";
import { StorageCard } from "./StorageCard";

/** Storage figures and the Chrome extension package. (Settings, clients and knowledge are edited in their own tabs.) */
export function FilesTab() {
  const [busy, setBusy] = useState<string | null>(null);
  const [settings, setSettings] = useState<Record<string, { label: string; value: string }> | null>(null);
  const [store, setStore] = useState("");
  // The site's own address (browser only — empty while rendering on the server, so the HTML matches).
  const origin = useSyncExternalStore(() => () => {}, () => window.location.origin, () => "");
  useEffect(() => {
    fetch("/api/admin/settings").then(async (r) => { if (!r.ok) return; const d = await r.json(); setSettings(d); setStore(d.EXTENSION_STORE_URL?.value ?? ""); }).catch(() => {});
  }, []);

  const [extOpen, setExtOpen] = useState(false);
  return (
    <div className="space-y-5">
      <StorageCard />
      <section className="card overflow-hidden">
        {/* Opens and closes; closed it says whether it's on the Web Store yet. */}
        <button type="button" aria-expanded={extOpen} onClick={() => setExtOpen((o) => !o)} className={`flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-bg ${extOpen ? "bg-bg" : ""}`}>
          <h2 className="font-semibold">Chrome extension</h2>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${settings?.EXTENSION_STORE_URL?.value ? "bg-accent-soft text-accent-strong" : "bg-amber-50 text-warn"}`}>
            {settings?.EXTENSION_STORE_URL?.value ? "on the Web Store" : "not on the Web Store yet"}</span>
          <span className="hidden truncate text-xs text-muted sm:inline">Package, Web Store steps and the store link</span>
          <svg className={`ml-auto shrink-0 text-muted transition-transform duration-200 ${extOpen ? "rotate-180" : ""}`} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
        </button>
        {extOpen && <div className="chat-pop space-y-3 border-t border-line p-5">
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
              onClick={async () => { setBusy("store"); const r = await post("/api/admin/settings", { EXTENSION_STORE_URL: store }); setBusy(null); toast({ ok: !r.error, text: r.error || "Saved — the Connector page now shows Add to Chrome" }); if (!r.error) setSettings((x) => (x ? { ...x, EXTENSION_STORE_URL: { label: x.EXTENSION_STORE_URL?.label ?? "", value: store } } : x)); }}>Save</button>
          </div>
        </Field>
        </div>}
      </section>

    </div>
  );
}
