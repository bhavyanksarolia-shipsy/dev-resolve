"use client";
import { useCallback, useEffect, useState } from "react";
import { btn, btnPrimary, Field, input, Note, post } from "./ui";

interface Status {
  base: string; branch: string; tokenSet: boolean; tokenSource?: string | null; syncing: boolean;
  last: { at: string; ok: boolean; error?: string; repos: { repo: string; ok: boolean; commit?: string; error?: string }[] } | null;
  repos: { repo: string; present: boolean }[];
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

  if (!s) return null;
  const missing = s.repos.filter((r) => !r.present);
  const local = !s.base && !missing.length; // e.g. a laptop with the repos checked out already
  const result = (repo: string) => s.last?.repos.find((x) => x.repo === repo);
  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h3 className="font-semibold">Source code</h3>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${local ? "bg-accent-soft text-accent-strong" : !s.base ? "bg-red-50 text-bad" : missing.length ? "bg-amber-50 text-warn" : "bg-accent-soft text-accent-strong"}`}>
          {local ? "using the local copy" : !s.base ? "not set up" : missing.length ? `${missing.length} of ${s.repos.length} repos missing` : `${s.repos.length} repos ready`}
        </span>
        <span className="text-xs text-muted">{s.base ? `${s.base} · ${s.branch} · token ${s.tokenSet ? `set (${s.tokenSource ?? "saved"})` : "not set"}` : local ? "Repos are already on this machine; no GitHub sync needed." : "The agent can't check code conditions until this is set."}</span>
        <div className="ml-auto flex gap-2">
          {s.base && <button className={btn} disabled={busy || s.syncing} onClick={() => act({ action: "sync" })}>{busy || s.syncing ? "Syncing…" : "Sync now"}</button>}
          <button className={btnPrimary} onClick={() => setEdit({ base: s.base, branch: s.branch, token: "" })}>{s.base ? "Edit" : "Set up"}</button>
        </div>
      </div>
      {msg && (msg.ok || !s.last?.repos.some((r) => !r.ok)) && <div className="mb-3"><Note ok={msg.ok}>{msg.text}</Note></div>}
      {edit && (
        <div className="mb-3 grid gap-3 rounded-lg bg-bg p-3 sm:grid-cols-3">
          <Field label="GitHub address" hint="https://github.com/<org>"><input className={input} value={edit.base} onChange={(e) => setEdit({ ...edit, base: e.target.value })} /></Field>
          <Field label="Branch"><input className={input} value={edit.branch} onChange={(e) => setEdit({ ...edit, branch: e.target.value })} /></Field>
          <Field label="Read-only token" hint={s.tokenSet ? "Leave empty to keep the saved one" : "Fine-grained, Contents: read on these repos"}>
            <input className={input} type="password" autoComplete="off" value={edit.token} onChange={(e) => setEdit({ ...edit, token: e.target.value })} />
          </Field>
          <div className="flex gap-2 sm:col-span-3">
            <button className={btnPrimary} disabled={busy} onClick={() => act({ action: "save", ...edit })}>{busy ? "Saving & syncing…" : "Save & sync"}</button>
            <button className={btn} onClick={() => setEdit(null)}>Cancel</button>
          </div>
        </div>
      )}
      <ul className="flex flex-wrap gap-2 text-xs">
        {s.repos.map((r) => {
          const x = result(r.repo);
          return (
            <li key={r.repo} title={x?.error || x?.commit || ""} className={`rounded-full px-2.5 py-1 ring-1 ${r.present ? "ring-line" : "text-bad ring-red-200"}`}>
              {r.present ? "●" : "○"} {r.repo}{x?.commit ? <span className="text-muted"> · {x.commit}</span> : x?.error ? <span> · failed</span> : null}
            </li>
          );
        })}
      </ul>
      {s.last && !s.last.ok && s.last.repos.some((r) => !r.ok) && (
        <p className="mt-2 text-xs text-bad">{s.last.repos.filter((r) => !r.ok).map((r) => `${r.repo}: ${r.error}`).join(" · ")}</p>
      )}
      <AvailableNote using={s.repos.length} />
      {s.last && <p className="mt-2 text-xs text-muted">Last sync {new Date(s.last.at).toLocaleString("en-IN")} · refreshes every 30 min</p>}
    </div>
  );
}

/** "The token can read 37 repos — 2 are used by clients": explains why only some repos are downloaded. */
function AvailableNote({ using }: { using: number }) {
  const [n, setN] = useState<number | null>(null);
  useEffect(() => { fetch("/api/admin/code?repos=1").then((r) => (r.ok ? r.json() : null)).then((d) => setN(d?.repos?.length ?? null)).catch(() => {}); }, []);
  if (!n) return null;
  return (
    <p className="mt-2 text-xs text-muted">
      The token can read <b className="text-fg">{n}</b> repos; <b className="text-fg">{using}</b> {using === 1 ? "is" : "are"} downloaded because clients use them.
      To add one, tick it under <b className="text-fg">Admin → Clients → Edit → Code the agent reads</b>.
    </p>
  );
}
