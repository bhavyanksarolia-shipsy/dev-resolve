"use client";
import { useEffect, useState } from "react";
import type { Acc, AdminConfig } from "./types";
import { ClientActiveToggle } from "@/components/ClientActiveToggle";
import { btn, btnPrimary, Field, input, Note, post, Select, Switch } from "./ui";

const SLOTS = ["app", "audit", "integration"] as const;
interface Form {
  originalSlug: string | null; name: string; group: string; client_active: boolean; code_repos: string[];
  devrev: { id: string; name: string }[];
  logsKind: "none" | "opensearch" | "app_log"; osProject: string; logTypes: Record<string, string>;
  appProject: string; indices: Record<string, string>; company: string; warehouses: string;
  dbKind: "none" | "metabase"; mbProject: string; database: string; databases: Record<string, string>; shared: boolean;
}

function toForm(a: Acc | null, cfg: AdminConfig): Form {
  const osProject = a ? cfg.connections.find((c) => c.opensearch && Object.values(a.opensearch_log_types).some((lt) => lt in c.opensearch!.logTypes))?.name ?? "" : "";
  const comp = a?.app_log?.company;
  return {
    originalSlug: a?.slug ?? null, name: a?.name ?? "", group: a?.group ?? "", client_active: a?.client_active !== false,
    code_repos: a?.code_repos ?? ["stockone-neo"],
    devrev: (a?.devrev.account_ids ?? []).map((id, i) => ({ id, name: a!.devrev.names[i] ?? id.slice(-8) })),
    logsKind: a?.app_log ? "app_log" : Object.keys(a?.opensearch_log_types ?? {}).length ? "opensearch" : "none",
    osProject, logTypes: { ...(a?.opensearch_log_types ?? {}) },
    appProject: a?.app_log?.project ?? cfg.connections.find((c) => c.appLog)?.name ?? "",
    indices: { ...(a?.app_log?.indices ?? {}) },
    company: Array.isArray(comp) ? comp.join(", ") : comp ?? "", warehouses: (a?.app_log?.warehouses ?? []).join(", "),
    dbKind: a?.metabase_project ? "metabase" : "none", mbProject: a?.metabase_project ?? "",
    database: a?.metabase_database ? String(a.metabase_database) : "",
    databases: Object.fromEntries(Object.entries(a?.metabase_databases ?? {}).map(([k, v]) => [k, String(v)])), shared: !!a?._shared_db_note,
  };
}

function DevrevPicker({ value, onChange }: { value: Form["devrev"]; onChange: (v: Form["devrev"]) => void }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<{ id: string; name: string; usedBy: string | null }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) return;
    const t = setTimeout(() => fetch(`/api/admin/devrev-accounts?q=${encodeURIComponent(q)}`).then((r) => r.json()).then((d) => setRes(d.results ?? [])), 300);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {value.map((d) => (
          <span key={d.id} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent-strong">
            {d.name}<button type="button" onClick={() => onChange(value.filter((x) => x.id !== d.id))} className="hover:text-bad">✕</button>
          </span>
        ))}
        {!value.length && <span className="text-xs text-muted">None yet — search below</span>}
      </div>
      <input className={input} placeholder="Search DevRev accounts by name…" value={q} onChange={(e) => setQ(e.target.value)} />
      {q.trim().length >= 2 && res.length > 0 && (
        <ul className="max-h-48 divide-y divide-line overflow-auto rounded-md border border-line bg-panel text-sm">
          {res.map((r) => {
            const picked = value.some((x) => x.id === r.id);
            return (
              <li key={r.id} className="flex items-center gap-2 px-3 py-1.5">
                <span className="flex-1">{r.name}</span>
                {r.usedBy && !picked && <span className="text-xs text-warn">used by {r.usedBy}</span>}
                <button type="button" className={btn} disabled={picked} onClick={() => onChange([...value, { id: r.id, name: r.name }])}>{picked ? "Added" : "Add"}</button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Clients: which DevRev accounts belong to them and which logs / database their investigations use. */
export function ClientsTab({ cfg, reload, openConnections }: { cfg: AdminConfig; reload: () => void; openConnections: () => void }) {
  const [form, setForm] = useState<Form | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<Form>) => form && setForm({ ...form, ...p });
  const osConns = cfg.connections.filter((c) => c.opensearch), mbConns = cfg.connections.filter((c) => c.metabase), appConns = cfg.connections.filter((c) => c.appLog);
  const conn = (name: string) => cfg.connections.find((c) => c.name === name);

  async function save() {
    if (!form) return;
    setBusy(true);
    const account = {
      name: form.name, group: form.group || null, client_active: form.client_active, code_repos: form.code_repos,
      devrev: { account_ids: form.devrev.map((d) => d.id), names: form.devrev.map((d) => d.name) },
      logs: form.logsKind === "opensearch" ? { kind: "opensearch", project: form.osProject, log_types: form.logTypes }
        : form.logsKind === "app_log" ? { kind: "app_log", project: form.appProject, indices: form.indices,
          company: form.company.split(",").map((s) => s.trim()).filter(Boolean), warehouses: form.warehouses.split(",").map((s) => s.trim()).filter(Boolean) }
        : { kind: "none" },
      db: form.dbKind === "metabase" ? { kind: "metabase", project: form.mbProject, database: Number(form.database), shared: form.shared,
        databases: Object.fromEntries(Object.entries(form.databases).filter(([k, v]) => k && v).map(([k, v]) => [k, Number(v)])) } : { kind: "none" },
    };
    const r = await post("/api/admin/accounts", { originalSlug: form.originalSlug, account });
    setBusy(false);
    setMsg({ ok: !r.error, text: r.error || r.message || "Saved" });
    if (!r.error) { setForm(null); reload(); }
  }

  const list = cfg.accounts.filter((a) => !filter || a.name.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="space-y-4">
      {msg && <Note ok={msg.ok}>{msg.text}</Note>}
      {!form && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <button className={btnPrimary} onClick={() => setForm(toForm(null, cfg))}>+ Add client</button>
            <input className={`${input} ml-auto max-w-xs`} placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-head text-left text-xs font-semibold uppercase tracking-wide text-head-fg">
                <tr><th className="px-4 py-3">Client</th><th className="px-4 py-3">Active with us</th><th className="px-4 py-3">DevRev accounts</th><th className="px-4 py-3">Logs</th><th className="px-4 py-3">Database</th><th className="px-4 py-3">Status</th><th className="px-4 py-3" /></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.map((a) => {
                  const osC = cfg.connections.find((c) => c.opensearch && Object.values(a.opensearch_log_types).some((lt) => lt in c.opensearch!.logTypes));
                  const vpn = (osC?.opensearch?.vpn) || conn(a.metabase_project || "")?.metabase?.vpn;
                  return (
                    <tr key={a.slug} className={a.client_active === false ? "bg-bg text-muted" : ""}>
                      <td className="px-4 py-3 font-medium">{a.name}{vpn && <span className="ml-2 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] text-warn ring-1 ring-amber-200">VPN</span>}</td>
                      <td className="px-4 py-3"><ClientActiveToggle slug={a.slug} name={a.name} initial={a.client_active !== false} changed={(a as Acc & { client_active_changed?: { by: string; at: string } }).client_active_changed} onChanged={reload} /></td>
                      <td className="px-4 py-3 text-xs text-muted">{a.devrev.names.slice(0, 2).join(", ")}{a.devrev.names.length > 2 && ` +${a.devrev.names.length - 2}`}</td>
                      <td className="px-4 py-3 text-xs">{a.app_log ? `app logs · ${[a.app_log.company].flat().filter(Boolean).join(", ") || "own indices"}` : osC ? `${osC.name} · ${Object.keys(a.opensearch_log_types).join("/")}` : <span className="text-muted">—</span>}</td>
                      <td className="px-4 py-3 text-xs">{a.metabase_project ? `${a.metabase_project} · db ${a.metabase_database}` : <span className="text-muted">—</span>}</td>
                      <td className="px-4 py-3 text-xs">{a.status === "active" ? <span className="text-ok">connected</span> : <span className="text-warn">{a.status.replace("_", " ")}</span>}</td>
                      <td className="px-4 py-3"><button className={btn} onClick={() => setForm(toForm(a, cfg))}>Edit</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {form && (
        <div className="card space-y-5 p-5">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold">{form.originalSlug ? `Edit ${form.name}` : "New client"}</h2>
            <button className={`${btn} ml-auto`} onClick={() => setForm(null)}>Cancel</button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Client name"><input className={input} value={form.name} placeholder="e.g. Acme Retail" onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="Group (optional)" hint="Clients sharing a group (e.g. one company's several products)"><input className={input} value={form.group} onChange={(e) => set({ group: e.target.value })} /></Field>
          </div>
          <Switch on={form.client_active} onChange={(v) => set({ client_active: v })} label="Client is active with us" />

          <Field label="DevRev accounts" hint="Tickets from these DevRev accounts are investigated as this client."><DevrevPicker value={form.devrev} onChange={(v) => set({ devrev: v })} /></Field>

          <Field label="Code the agent reads" hint="Repos are downloaded from GitHub (Connections → Source code) when you save.">
            <RepoPicker known={cfg.repos} value={form.code_repos} onChange={(v) => set({ code_repos: v })} />
          </Field>

          <div className="rounded-lg border border-line p-4">
            <div className="mb-3 font-medium">Logs</div>
            <div className="mb-3 flex flex-wrap gap-4 text-sm">
              {[["none", "No logs"], ["opensearch", "OpenSearch cluster"], ["app_log", "Shared app logs"]].map(([k, l]) => (
                <label key={k} className="inline-flex items-center gap-1.5"><input type="radio" checked={form.logsKind === k} onChange={() => set({ logsKind: k as Form["logsKind"] })} /> {l}</label>
              ))}
            </div>
            {form.logsKind === "opensearch" && (
              <div className="space-y-3">
                <Field label="Cluster" hint={<>Not listed? <button type="button" className="text-accent-strong underline" onClick={openConnections}>Add it under Connections</button>.</>}>
                  <Select value={form.osProject} onChange={(v) => set({ osProject: v, logTypes: {} })}
                    options={osConns.map((c) => ({ value: c.name, label: c.name, hint: [c.opensearch?.host, c.opensearch?.vpn && "needs VPN"].filter(Boolean).join(" · ") }))} />
                </Field>
                {form.osProject && (
                  <div className="grid gap-3 sm:grid-cols-3">
                    {SLOTS.map((slot) => (
                      <Field key={slot} label={`${slot[0].toUpperCase()}${slot.slice(1)} logs`}>
                        <Select value={form.logTypes[slot] ?? ""} placeholder="—" onChange={(v) => set({ logTypes: { ...form.logTypes, [slot]: v } })}
                          options={[{ value: "", label: "—", hint: "not used" }, ...Object.entries(conn(form.osProject)?.opensearch?.logTypes ?? {}).map(([lt, idx]) => ({ value: lt, label: lt, hint: idx }))]} />
                      </Field>
                    ))}
                  </div>
                )}
              </div>
            )}
            {form.logsKind === "app_log" && (
              <div className="space-y-3">
                {appConns.length > 1 && (
                  <Field label="App-logs connection"><Select value={form.appProject} onChange={(v) => set({ appProject: v })} options={appConns.map((c) => ({ value: c.name, label: c.name, hint: c.label }))} /></Field>
                )}
                <div className="grid gap-3 sm:grid-cols-3">
                  {SLOTS.map((slot) => (
                    <Field key={slot} label={`${slot[0].toUpperCase()}${slot.slice(1)} index pattern`}>
                      <input className={input} value={form.indices[slot] ?? ""} placeholder={slot === "app" ? "app-logs-neo-xyz-*" : ""} onChange={(e) => set({ indices: { ...form.indices, [slot]: e.target.value } })} />
                    </Field>
                  ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Company filter" hint="Required when the indices are shared by several clients (comma-separated company names)."><input className={input} value={form.company} onChange={(e) => set({ company: e.target.value })} /></Field>
                  <Field label="Warehouses (optional)" hint="Comma-separated warehouse codes, if the company name isn't enough"><input className={input} value={form.warehouses} onChange={(e) => set({ warehouses: e.target.value })} /></Field>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-line p-4">
            <div className="mb-3 font-medium">Database</div>
            <div className="mb-3 flex flex-wrap gap-4 text-sm">
              {[["none", "No database"], ["metabase", "Metabase"]].map(([k, l]) => (
                <label key={k} className="inline-flex items-center gap-1.5"><input type="radio" checked={form.dbKind === k} onChange={() => set({ dbKind: k as Form["dbKind"] })} /> {l}</label>
              ))}
            </div>
            {form.dbKind === "metabase" && (
              <div className="space-y-3">
                <Field label="Metabase instance" hint={<>Not listed? <button type="button" className="text-accent-strong underline" onClick={openConnections}>Add it under Connections</button>.</>}>
                  <Select value={form.mbProject} onChange={(v) => set({ mbProject: v, database: String(conn(v)?.metabase?.defaultDatabase ?? "") })}
                    options={mbConns.map((c) => ({ value: c.name, label: c.name, hint: [c.metabase?.host, c.metabase?.vpn && "needs VPN", c.metabase?.auth === "google" && "each person's Google sign-in"].filter(Boolean).join(" · ") }))} />
                </Field>
                {form.mbProject && (
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Main database">
                      <Select value={form.database} onChange={(v) => set({ database: v })}
                        options={Object.entries(conn(form.mbProject)?.metabase?.databases ?? {}).map(([id, l]) => ({ value: id, label: `Database ${id}`, hint: l }))} />
                    </Field>
                    <Field label="Postgres db id (optional)"><input className={input} value={form.databases.postgres ?? ""} onChange={(e) => set({ databases: { ...form.databases, postgres: e.target.value } })} /></Field>
                    <Field label="Mongo db id (optional)"><input className={input} value={form.databases.mongo ?? ""} onChange={(e) => set({ databases: { ...form.databases, mongo: e.target.value } })} /></Field>
                  </div>
                )}
                <Switch on={form.shared} onChange={(v) => set({ shared: v })} label="This database is shared by several clients (the agent must filter every query to this client)" />
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button className={btnPrimary} disabled={busy || !form.name || !form.devrev.length} onClick={save}>{busy ? "Saving…" : "Save client"}</button>
            {!form.devrev.length && <span className="self-center text-xs text-muted">Add at least one DevRev account to save.</span>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Pick the repos a client's investigations may read: those already used + every repo the GitHub token can see. */
function RepoPicker({ known, value, onChange }: { known: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const [remote, setRemote] = useState<string[] | null>(null);
  const [q, setQ] = useState("");
  useEffect(() => {
    fetch("/api/admin/code?repos=1").then((r) => (r.ok ? r.json() : { repos: [] })).then((d) => setRemote(d.repos ?? [])).catch(() => setRemote([]));
  }, []);
  const all = [...new Set([...value, ...known, ...(remote ?? [])])].sort((a, b) => Number(value.includes(b)) - Number(value.includes(a)) || a.localeCompare(b));
  const needle = q.trim().toLowerCase();
  const shown = all.filter((r) => value.includes(r) || !needle || r.toLowerCase().includes(needle)).slice(0, needle ? 60 : 24);
  return (
    <div className="space-y-2">
      <input className={input} placeholder={remote === null ? "Loading repos from GitHub…" : `Search ${all.length} repos…`} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="flex max-h-48 flex-wrap gap-x-4 gap-y-1.5 overflow-auto text-sm">
        {shown.map((r) => (
          <label key={r} className="inline-flex items-center gap-1.5"><input type="checkbox" checked={value.includes(r)}
            onChange={(e) => onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))} /> {r}</label>
        ))}
        {!shown.length && <span className="text-xs text-muted">No repo matches “{q}”.</span>}
      </div>
      {remote !== null && !remote.length && <p className="text-xs text-muted">Couldn&apos;t list repos from GitHub — set up Connections → Source code first.</p>}
    </div>
  );
}
