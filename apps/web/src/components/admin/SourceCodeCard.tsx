"use client";
import { useCallback, useEffect, useState } from "react";
import { btn, btnPrimary, Field, input, Note, post } from "./ui";
import { confirmDialog } from "@/components/Dialog";

interface Status {
  base: string; branch: string; tokenSet: boolean; tokenSource?: string | null; tokenPreview?: string | null; connected?: string[]; syncing: boolean;
  last: { at: string; ok: boolean; error?: string; repos: { repo: string; ok: boolean; commit?: string; error?: string }[] } | null;
  repos: { repo: string; present: boolean; head?: string | null }[];
}

/** Where the agent's source code comes from (GitHub, read-only) and whether each repo is on the server. */
export function SourceCodeCard() {
  const [s, setS] = useState<Status | null>(null);
  const [edit, setEdit] = useState<{ base: string; branch: string; token: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => fetch("/api/admin/code", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => d && setS(d)).catch(() => {}), []);
  useEffect(() => { load(); }, [load]);

  async function act(body: Record<string, unknown>) {
    setBusy(true); setMsg(null);
    const r = await post<{ status?: Status; message?: string }>("/api/admin/code", body);
    setBusy(false);
    setMsg({ ok: !r.error, text: r.error || r.message || "Done" });
    if (r.status) setS(r.status);
    if (!r.error) setEdit(null);
  }

  if (!s) return <div className="skeleton h-48 w-full rounded-2xl" />;
  const missing = s.repos.filter((r) => !r.present);
  const local = !s.base && !missing.length; // e.g. a laptop with the repos checked out already
  const result = (repo: string) => s.last?.repos.find((x) => x.repo === repo);
  const badge = local ? ["Using local checkouts", "bg-accent-soft text-accent-strong"] : !s.base ? ["Not set up", "bg-red-50 text-bad"]
    : missing.length ? [`${missing.length} of ${s.repos.length} repos missing`, "bg-amber-50 text-warn"] : [`${s.repos.length} repos ready`, "bg-accent-soft text-accent-strong"];
  return (
    <section className="card">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-4">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-fg text-white" aria-hidden>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.54-3.88-1.54-.53-1.33-1.28-1.69-1.28-1.69-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.69 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.84 1.19 3.1 0 4.42-2.7 5.4-5.27 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" /></svg>
        </span>
        <div className="min-w-0">
          <h3 className="font-semibold">Source code</h3>
          <p className="text-xs text-muted">The code the agent reads, downloaded from GitHub (read-only)</p>
        </div>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${badge[1]}`}>{badge[0]}</span>
        <div className="ml-auto flex gap-2">
          {s.base && <button className={btn} disabled={busy} onClick={() => act({ action: "check" })}>Check connection</button>}
          {s.base && <button className={btn} disabled={busy || s.syncing} onClick={() => act({ action: "sync" })}>{s.syncing ? "Syncing…" : "Sync now"}</button>}
          <button className={btnPrimary} onClick={() => setEdit(edit ? null : { base: s.base, branch: s.branch, token: "" })}>{edit ? "Close" : s.base ? "Edit" : "Set up"}</button>
        </div>
      </div>

      <div className="space-y-5 px-5 py-4">
        {msg && (msg.ok || !s.last?.repos.some((r) => !r.ok)) && <Note ok={msg.ok}>{msg.text}</Note>}

        {/* Settings: read-only summary, or the edit form */}
        {edit ? (
          <div className="grid gap-3 rounded-xl bg-bg p-4 sm:grid-cols-3">
            <Field label="GitHub address" hint="https://github.com/<org>"><input className={input} value={edit.base} onChange={(e) => setEdit({ ...edit, base: e.target.value })} /></Field>
            <Field label="Branch"><input className={input} value={edit.branch} onChange={(e) => setEdit({ ...edit, branch: e.target.value })} /></Field>
            <Field label="New token" hint={s.tokenSet ? "Leave empty to keep the saved one" : "Classic (repo scope) or fine-grained (Contents: read)"}>
              <input className={input} type="password" autoComplete="off" placeholder={s.tokenPreview ?? ""} value={edit.token} onChange={(e) => setEdit({ ...edit, token: e.target.value })} />
            </Field>
            <div className="flex gap-2 sm:col-span-3">
              <button className={btnPrimary} disabled={busy} onClick={() => act({ action: "save", ...edit })}>{busy ? "Saving & syncing…" : "Save & sync"}</button>
              <button className={btn} onClick={() => setEdit(null)}>Cancel</button>
            </div>
          </div>
        ) : s.base ? (
          <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-muted">Organisation</dt><dd className="mt-0.5 font-mono text-[13px]">{s.base.replace(/^https:\/\//, "")}</dd></div>
            <div><dt className="text-xs text-muted">Branch</dt><dd className="mt-0.5 font-mono text-[13px]">{s.branch}</dd></div>
            <div><dt className="text-xs text-muted">Token {s.tokenSource && <span>· {s.tokenSource}</span>}</dt><dd className="mt-0.5"><TokenField preview={s.tokenPreview ?? null} /></dd></div>
          </dl>
        ) : (
          <p className="text-sm text-muted">{local ? "Repos are already on this machine — no GitHub sync needed." : "Set up GitHub so the agent can read the code behind each error."}</p>
        )}

        {/* Repos */}
        {s.repos.length > 0 && (
          <div>
            <div className="mb-2 flex items-baseline gap-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">Connected repos · {s.repos.length}</h4>
              {s.last && <span className="text-xs text-muted">last sync {new Date(s.last.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })} · every 30 min</span>}
            </div>
            <AddRepo connected={s.connected ?? []} busy={busy} onAdd={(r) => act({ action: "repos", repos: [...(s.connected ?? []), r] })} />
            <ul className="mt-3 divide-y divide-line overflow-hidden rounded-xl border border-line">
              {s.repos.map((r) => {
                const x = result(r.repo);
                const [hash, date] = (x?.commit ?? r.head ?? "").split(" · ");
                return (
                  <li key={r.repo} className="group flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${r.present && !x?.error ? "bg-ok" : "bg-bad"}`} aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{r.repo}</span>
                    {x?.error ? <span className="truncate text-xs text-bad" title={x.error}>{x.error}</span>
                      : hash ? <><code className="rounded bg-bg px-1.5 py-0.5 text-xs text-muted">{hash}</code><span className="w-24 text-right text-xs text-muted">{date}</span></>
                      : <span className="text-xs text-muted" title={r.present ? "Downloaded (not a git checkout)" : "Not downloaded yet — Sync now"}>{r.present ? "downloaded" : "not downloaded yet"}</span>}
                    {(s.connected ?? []).includes(r.repo) && (
                      <button type="button" disabled={busy} title="Disconnect this repo" aria-label={`Disconnect ${r.repo}`}
                        onClick={async () => {
                          const ok = await confirmDialog({
                            title: `Disconnect ${r.repo}?`,
                            message: "The agent stops reading this repo, and clients can no longer pick it. Clients that already use it keep it until you remove it from them (Admin → Clients → Code).",
                            confirmLabel: "Disconnect", danger: true,
                          });
                          if (ok) act({ action: "repos", repos: (s.connected ?? []).filter((x) => x !== r.repo) });
                        }}
                        className="ml-1 grid h-6 w-6 place-items-center rounded-md text-muted opacity-0 transition hover:bg-red-50 hover:text-bad group-hover:opacity-100">✕</button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

/** Saved token: masked, with an eye to reveal (fetched on demand) and copy. */
function TokenField({ preview }: { preview: string | null }) {
  const [full, setFull] = useState<string | null>(null);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!preview) return <span className="text-bad">not set</span>;
  async function toggle() {
    if (shown) return setShown(false);
    if (!full) {
      setBusy(true);
      const r = await post<{ token?: string }>("/api/admin/code", { action: "reveal" });
      setBusy(false);
      if (!r.token) return;
      setFull(r.token);
    }
    setShown(true);
  }
  const icon = "grid h-6 w-6 place-items-center rounded-md text-muted hover:bg-accent-soft hover:text-accent-strong";
  return (
    <span className="flex min-w-0 items-center gap-1 rounded-lg border border-line bg-bg py-0.5 pl-2.5 pr-1">
      <span className="min-w-0 flex-1 truncate font-mono text-[13px]" title={shown ? undefined : "Hidden — click the eye to show"}>{shown && full ? full : preview}</span>
      <button type="button" onClick={toggle} disabled={busy} aria-label={shown ? "Hide token" : "Show token"} title={shown ? "Hide" : "Show"} className={icon}>
        {shown
          ? <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A10.6 10.6 0 0 1 12 5c5 0 9 4.5 10 7a13 13 0 0 1-2.9 4M6.1 6.1A13 13 0 0 0 2 12c1 2.5 5 7 10 7a10.6 10.6 0 0 0 4.1-.8" /></svg>
          : <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></svg>}
      </button>
      {shown && full && (
        <button type="button" onClick={() => navigator.clipboard?.writeText(full)} aria-label="Copy token" title="Copy" className={icon}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>
        </button>
      )}
    </span>
  );
}

/** Connect another repo: search everything the token can read (or local checkouts) and add it — it's downloaded right away. */
function AddRepo({ connected, busy, onAdd }: { connected: string[]; busy: boolean; onAdd: (repo: string) => void }) {
  const [all, setAll] = useState<string[] | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => { fetch("/api/admin/code?repos=1").then((r) => (r.ok ? r.json() : null)).then((d) => setAll(d?.repos ?? [])).catch(() => setAll([])); }, []);
  const needle = q.trim().toLowerCase();
  const matches = (all ?? []).filter((r) => !connected.includes(r) && (!needle || r.toLowerCase().includes(needle))).slice(0, 12);
  return (
    <div className="relative">
      <input className={input} value={q} disabled={busy} onFocus={() => setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={(e) => { if (e.key === "Enter" && matches[0]) { e.preventDefault(); onAdd(matches[0]); setQ(""); } }}
        placeholder={all === null ? "Loading repos…" : `+ Connect a repo — search ${all.length} available…`} />
      {open && (
        <ul className="absolute left-0 right-0 top-full z-40 mt-1 max-h-72 overflow-auto rounded-xl border border-line bg-panel py-1 text-sm shadow-xl">
          {matches.map((r) => (
            <li key={r}><button type="button" onMouseDown={(e) => { e.preventDefault(); onAdd(r); setQ(""); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs hover:bg-accent-soft"><span className="text-accent-strong">+</span>{r}</button></li>
          ))}
          {!matches.length && <li className="px-3 py-2 text-xs text-muted">{needle ? `No repo matches “${q}”` : "Every repo is connected"}</li>}
        </ul>
      )}
    </div>
  );
}
