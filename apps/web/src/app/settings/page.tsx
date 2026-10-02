"use client";
import { useEffect, useState } from "react";

type Info = Record<string, { present: boolean; size?: number; updated?: string }>;
const FILES = [
  { kind: "projects.json", label: "projects.json", hint: "accounts and connections (apps/api/config/projects.json on your laptop)", accept: ".json" },
  { kind: "config.env", label: "config.env", hint: "endpoints and credentials (apps/api/config/config.env)", accept: ".env,text/plain" },
  { kind: "knowledge.tgz", label: "knowledge (.tgz)", hint: "make it with: npm run pack-knowledge — merged into the server's knowledge", accept: ".tgz,.gz,application/gzip" },
];

/** Admin: put the backend's private files on the server (no "secret files" on hosts like Railway). */
export default function SettingsPage() {
  const [info, setInfo] = useState<Info | null>(null);
  const [msg, setMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => fetch("/api/admin/private-files", { cache: "no-store" }).then(async (r) => {
    const d = await r.json();
    if (r.ok) setInfo(d); else setMsg({ _: { ok: false, text: d.error } });
  });
  useEffect(() => { load(); }, []);

  async function upload(kind: string, file?: File) {
    if (!file) return;
    setBusy(kind);
    const fd = new FormData();
    fd.set("kind", kind);
    fd.set("file", file);
    const r = await fetch("/api/admin/private-files", { method: "POST", body: fd });
    const d = await r.json().catch(() => ({}));
    setBusy(null);
    setMsg((m) => ({ ...m, [kind]: { ok: r.ok, text: r.ok ? d.message : d.error || `HTTP ${r.status}` } }));
    load();
  }

  const status = (k: string) => {
    const i = info?.[k === "knowledge.tgz" ? "knowledge" : k];
    if (!i) return "…";
    return i.present ? `on the server · ${i.size != null && k !== "knowledge.tgz" ? `${Math.round(i.size / 1024)} KB · ` : ""}updated ${new Date(i.updated!).toLocaleString("en-IN")}` : "not uploaded yet";
  };

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold">Settings · private files</h1>
        <p className="mt-1 text-sm text-muted">These stay on the backend only (never in the repo or the frontend). Uploading replaces the server&apos;s copy; knowledge is merged.</p>
      </div>
      {msg._ && <p className="text-sm text-bad">{msg._.text}</p>}
      <div className="card divide-y divide-line">
        {FILES.map((f) => (
          <div key={f.kind} className="flex flex-wrap items-center gap-3 p-4">
            <div className="min-w-56 flex-1">
              <div className="font-medium">{f.label}</div>
              <div className="text-xs text-muted">{f.hint}</div>
              <div className="mt-1 text-xs">{status(f.kind)}</div>
              {msg[f.kind] && <div className={`mt-1 text-xs ${msg[f.kind].ok ? "text-ok" : "text-bad"}`}>{msg[f.kind].text}</div>}
            </div>
            <label className={`cursor-pointer rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:border-accent ${busy === f.kind ? "opacity-50" : ""}`}>
              {busy === f.kind ? "Uploading…" : "Upload"}
              <input type="file" accept={f.accept} className="hidden" disabled={!!busy} onChange={(e) => { upload(f.kind, e.target.files?.[0]); e.target.value = ""; }} />
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}
