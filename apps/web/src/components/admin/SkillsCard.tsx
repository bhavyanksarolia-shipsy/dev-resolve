"use client";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { confirmDialog, toast } from "@/components/Dialog";
import { Markdown } from "@/components/Markdown";
import { SlideSheet } from "@/components/SlideSheet";
import { btn, btnPrimary, MultiSelect, post, Select } from "./ui";

interface Skill { name: string; description: string; bytes: number; updatedAt: string; builtIn: boolean; all: boolean; clients: string[] }
interface Client { slug: string; name: string; active: boolean }
type Viewing = { kind: "skill"; name: string } | { kind: "prompt"; slug: string };

const size = (b: number) => (b >= 1024 ? `${(b / 1024).toFixed(b >= 10240 ? 0 : 1)} KB` : `${b} B`);
const when = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

/**
 * Admin → Connections → Claude → Skills: the playbooks the agent can open (read_skill), who they're for, and the
 * agent's built-in instructions — all readable as markdown. Upload a SKILL.md to add or replace one.
 */
export function SkillsCard() {
  const [d, setD] = useState<{ skills: Skill[]; clients: Client[] } | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<Viewing | null>(null);
  const [assign, setAssign] = useState<{ name: string; all: boolean; clients: string[] } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const replacing = useRef<string | null>(null);
  const load = useCallback(() => fetch("/api/admin/skills", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then(setD).catch(() => setD(null)), []);
  useEffect(() => { load(); }, [load]);

  const pick = (replace: string | null) => { replacing.current = replace; if (file.current) { file.current.value = ""; file.current.click(); } };
  const upload = async (f: File) => {
    if (f.size > 200 * 1024) return toast({ ok: false, text: "A skill can be up to 200 KB" });
    const replace = replacing.current;
    const markdown = await f.text();
    const name = markdown.match(/^﻿?---\r?\n[\s\S]*?^name:\s*["']?([^"'\r\n]+)/m)?.[1]?.trim().toLowerCase();
    if (!replace && name && d?.skills.some((s) => s.name === name)) {
      const ok = await confirmDialog({ title: `Replace ${name}?`, message: `A skill named "${name}" exists. Its text is replaced with this file; the clients using it stay the same.`, confirmLabel: "Replace" });
      if (!ok) return;
    }
    setBusy(true);
    const r = await post<{ name?: string; existed?: boolean; message?: string }>("/api/admin/skills", { action: "upload", markdown, replace });
    setBusy(false);
    toast({ ok: !r.error, text: r.error || r.message || "Saved" });
    if (r.error) return;
    await load();
    if (r.name && !r.existed) setAssign({ name: r.name, all: false, clients: [] }); // new skill: choose its clients right away
  };
  const saveAssign = async () => {
    if (!assign) return;
    setBusy(true);
    const r = await post("/api/admin/skills", { action: "assign", ...assign });
    setBusy(false);
    toast({ ok: !r.error, text: r.error || r.message || "Saved" });
    if (!r.error) { setAssign(null); load(); }
  };
  const remove = async (s: Skill) => {
    const ok = await confirmDialog({ title: `Delete ${s.name}?`, message: "The agent stops using it for every client. Download it first if you may want it back.", confirmLabel: "Delete", danger: true });
    if (!ok) return;
    const r = await post("/api/admin/skills", { action: "delete", name: s.name });
    toast({ ok: !r.error, text: r.error || r.message || "Deleted" });
    load();
  };
  const download = async (name: string) => {
    const r = await fetch(`/api/admin/skills?name=${encodeURIComponent(name)}`, { cache: "no-store" }).then((x) => x.json()).catch(() => null);
    if (!r?.markdown) return toast({ ok: false, text: "Couldn't download it" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([r.markdown], { type: "text/markdown" }));
    a.download = `${name}.SKILL.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (d === undefined) return <div className="skeleton h-40 w-full rounded-2xl" />;
  if (!d) return <div className="card p-5 text-sm text-bad">Couldn&apos;t load the skills.</div>;
  const nameOf = (slug: string) => d.clients.find((c) => c.slug === slug)?.name ?? slug;
  const usedBy = (s: Skill) => s.builtIn ? <span className="text-muted">Used inside the metabase_query tool</span>
    : s.all ? <span className="font-medium">All clients</span>
    : s.clients.length ? <span title={s.clients.map(nameOf).join(", ")}>{s.clients.slice(0, 3).map(nameOf).join(", ")}{s.clients.length > 3 && ` +${s.clients.length - 3}`}</span>
    : <span className="text-warn">No client yet — not used</span>;
  const link = "text-accent-strong underline-offset-2 hover:underline disabled:opacity-40";
  const options = d.clients.map((c) => ({ value: c.slug, label: c.name, hint: c.active ? undefined : "inactive" }));

  return (
    <section className="card mt-4 p-5">
      <input ref={file} type="file" accept=".md,.markdown,text/markdown,text/plain" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <h3 className="font-semibold">Skills</h3>
        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent-strong">{d.skills.filter((s) => !s.builtIn).length} uploaded</span>
        <button className={`${btn} ml-auto`} onClick={() => { const c = d.clients.find((x) => x.active) ?? d.clients[0]; if (c) setViewing({ kind: "prompt", slug: c.slug }); }}>View built-in instructions</button>
        <button className={btnPrimary} disabled={busy} onClick={() => pick(null)}>{busy ? "Uploading…" : "Upload skill"}</button>
      </div>
      <p className="mb-3 text-xs text-muted">
        A skill is a <code>SKILL.md</code>: a <code>---</code> block with <code>name:</code> and <code>description:</code> (when to use it), then the instructions in markdown.
        The agent sees each skill&apos;s description and opens the full text when a ticket matches. Stored in Dev Resolve&apos;s database, never in the code repository.
      </p>
      <div className="overflow-hidden rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead className="bg-bg text-left text-xs text-muted">
            <tr><th className="px-3 py-2 font-medium">Skill</th><th className="px-3 py-2 font-medium">Used for</th><th className="px-3 py-2 text-right font-medium">Size</th><th className="px-3 py-2 font-medium">Updated</th><th className="px-3 py-2" /></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {!d.skills.length && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted">No skills yet — upload a SKILL.md</td></tr>}
            {d.skills.map((s) => (
              <tr key={s.name} className="align-top">
                <td className="max-w-md px-3 py-2.5">
                  <div className="flex items-center gap-2"><code className="text-[13px] font-medium">{s.name}</code>{s.builtIn && <span className="rounded bg-bg px-1.5 text-[10px] text-muted">built in</span>}</div>
                  <div className="line-clamp-2 text-muted" title={s.description}>{s.description}</div>
                </td>
                <td className="px-3 py-2.5">
                  {assign?.name === s.name ? (
                    <div className="flex min-w-72 flex-col gap-2">
                      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[var(--accent)]" checked={assign.all} onChange={(e) => setAssign({ ...assign, all: e.target.checked })} />All clients (including ones added later)</label>
                      {!assign.all && <MultiSelect value={options.filter((o) => assign.clients.includes(o.value))} onChange={(v) => setAssign({ ...assign, clients: v.map((o) => o.value) })} options={options} placeholder="Choose clients…" searchPlaceholder="Search clients…" />}
                      <div className="flex gap-2"><button className={btnPrimary} disabled={busy} onClick={saveAssign}>Save</button><button className={btn} onClick={() => setAssign(null)}>Cancel</button></div>
                    </div>
                  ) : <>{usedBy(s)}{!s.builtIn && <button className={`${link} ml-2 text-xs`} onClick={() => setAssign({ name: s.name, all: s.all, clients: s.clients })}>Change</button>}</>}
                </td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-muted">{size(s.bytes)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-muted">{when(s.updatedAt)}</td>
                <td className="whitespace-nowrap px-3 py-2.5 text-right text-xs">
                  <button className={link} onClick={() => setViewing({ kind: "skill", name: s.name })}>View</button>
                  <span className="text-line"> · </span><button className={link} onClick={() => download(s.name)}>Download</button>
                  {!s.builtIn && <><span className="text-line"> · </span><button className={link} disabled={busy} onClick={() => pick(s.name)}>Replace</button>
                    <span className="text-line"> · </span><button className="text-bad underline-offset-2 hover:underline" onClick={() => remove(s)}>Delete</button></>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {viewing && <Viewer v={viewing} clients={d.clients} onClient={(slug) => setViewing({ kind: "prompt", slug })} onClose={() => setViewing(null)} />}
    </section>
  );
}

/** A skill, or the built-in instructions for one client, as rendered markdown (or the raw source). */
function Viewer({ v, clients, onClient, onClose }: { v: Viewing; clients: Client[]; onClient: (slug: string) => void; onClose: () => void }) {
  const [md, setMd] = useState<string | null | undefined>(undefined);
  const [raw, setRaw] = useState(false);
  const key = v.kind === "skill" ? `name=${encodeURIComponent(v.name)}` : `prompt=${encodeURIComponent(v.slug)}`;
  useEffect(() => {
    let live = true;
    fetch(`/api/admin/skills?${key}`, { cache: "no-store" }).then((r) => r.json()).then((r) => live && setMd(r.markdown ?? null)).catch(() => live && setMd(null));
    return () => { live = false; };
  }, [key]);
  // A skill's --- header is shown as a small table instead of raw YAML.
  const fm = v.kind === "skill" && md ? md.match(/^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/) : null;
  const body = fm ? fm[2] : md ?? "";
  return (
    <SlideSheet title={v.kind === "skill" ? v.name : "Built-in instructions"}
      subtitle={v.kind === "skill" ? "Skill — what the agent reads when it opens it" : "The system prompt the agent gets for this client's tickets (skills, knowledge and connections included)"}
      onClose={onClose}>
      <div className="flex flex-wrap items-center gap-3">
        {v.kind === "prompt" && <div className="w-72"><Select value={v.slug} onChange={onClient} options={clients.map((c) => ({ value: c.slug, label: c.name }))} /></div>}
        <div className="ml-auto flex rounded-lg border border-line p-0.5 text-xs">
          {(["Rendered", "Markdown"] as const).map((l) => (
            <button key={l} className={`rounded-md px-2.5 py-1 ${(l === "Markdown") === raw ? "bg-accent text-white" : "text-muted"}`} onClick={() => setRaw(l === "Markdown")}>{l}</button>
          ))}
        </div>
      </div>
      {md === undefined ? <div className="skeleton mt-4 h-64 w-full rounded-xl" />
        : md === null ? <p className="mt-4 text-sm text-bad">Couldn&apos;t load it.</p>
        : raw ? <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded-xl border border-line bg-bg p-4 font-mono text-xs leading-relaxed">{md}</pre>
        : <div className="mt-4">
            {fm && <dl className="mb-4 grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 rounded-xl border border-line bg-bg p-3 text-sm">
              {fm[1].split(/\r?\n/).map((l) => l.match(/^([A-Za-z_-]+):\s*(.*)$/)).filter(Boolean).map((m) => <Fragment key={m![1]}><dt className="text-muted">{m![1]}</dt><dd>{m![2].replace(/^(["'])(.*)\1$/, "$2")}</dd></Fragment>)}
            </dl>}
            <Markdown>{body}</Markdown>
          </div>}
    </SlideSheet>
  );
}
