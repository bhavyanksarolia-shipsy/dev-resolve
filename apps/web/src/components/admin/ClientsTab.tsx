"use client";
import { SlideSheet } from "@/components/SlideSheet";
import { useCallback, useEffect, useState } from "react";
import type { Acc, AdminConfig } from "./types";
import { ClientActiveToggle } from "@/components/ClientActiveToggle";
import { TableCard, usePaged } from "@/components/TableTools";
import { btn, btnPrimary, Field, input, MultiSelect, Note, post, Select, Switch } from "./ui";

const SLOTS = ["app", "audit", "integration"] as const;
interface Form {
  originalSlug: string | null; name: string; group: string; client_active: boolean; code_repos: string[];
  extra: { name: string; url: string; notes: string }[];
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
    extra: (a?.extra_sources ?? []).map((x) => ({ name: x.name, url: x.url ?? "", notes: x.notes ?? "" })),
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
  const search = useCallback((q: string) => fetch(`/api/admin/devrev-accounts?q=${encodeURIComponent(q)}`).then((r) => r.json())
    .then((d: { results?: { id: string; name: string; usedBy: string | null }[] }) => (d.results ?? []).map((r) => ({ value: r.id, label: r.name, hint: r.usedBy ? `used by ${r.usedBy}` : undefined })))
    .catch(() => []), []);
  return (
    <MultiSelect value={value.map((d) => ({ value: d.id, label: d.name }))} onChange={(v) => onChange(v.map((o) => ({ id: o.value, name: o.label })))}
      search={search} placeholder="Choose DevRev accounts…" searchPlaceholder="Search DevRev accounts by name…" />
  );
}

/** Clients: which DevRev accounts belong to them and which logs / database their investigations use. */
export function ClientsTab({ cfg, reload }: { cfg: AdminConfig; reload: () => void }) {
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
      name: form.name, group: form.group || null, client_active: form.client_active, code_repos: form.code_repos, extra_sources: form.extra.filter((x) => x.name.trim()),
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
  const paged = usePaged(list, { noun: "clients", reset: filter });
  return (
    <div className="space-y-4">
      {msg && <Note ok={msg.ok}>{msg.text}</Note>}
      <TableCard title="Clients" subtitle={`${cfg.accounts.filter((a) => a.client_active !== false).length} active · ${cfg.accounts.filter((a) => a.client_active === false).length} inactive`}
        search={filter} onSearch={setFilter} searchPlaceholder="Search clients…" pager={paged.pager}
        actions={<button className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-strong" onClick={() => setForm(toForm(null, cfg))}>+ Add client</button>}>
            <table className="w-full text-sm">
              <thead className="bg-head text-left text-xs font-semibold uppercase tracking-wide text-head-fg">
                <tr><th className="px-4 py-3">Client</th><th className="px-4 py-3">Active with us</th><th className="px-4 py-3">DevRev accounts</th><th className="px-4 py-3">Logs</th><th className="px-4 py-3">Database</th><th className="px-4 py-3">Status</th><th className="px-4 py-3" /></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {paged.rows.map((a) => {
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
      </TableCard>

      {form && (
        <SlideSheet title={form.originalSlug ? `Edit ${form.name}` : "New client"} onClose={() => setForm(null)}>
          <div className="space-y-3">

          <Section title="Client">
          <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr_10rem]">
            <Field label="Name"><input className={input} value={form.name} placeholder="e.g. Acme Retail" onChange={(e) => set({ name: e.target.value })} /></Field>
            <Field label="Group (optional)"><input className={input} value={form.group} placeholder="e.g. acme" onChange={(e) => set({ group: e.target.value })} /></Field>
            <Field label="Status">
              <Select value={form.client_active ? "active" : "inactive"} onChange={(v) => set({ client_active: v === "active" })}
                options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} />
            </Field>
          </div>
          </Section>

          <Section title="DevRev accounts">
            <DevrevPicker value={form.devrev} onChange={(v) => set({ devrev: v })} />
          </Section>

          <Section title="Code">
            <RepoPicker known={cfg.repos} value={form.code_repos} onChange={(v) => set({ code_repos: v })} />
          </Section>

          <Section title="Logs">
            <div className="mb-3 flex flex-wrap gap-4 text-sm">
              {[["none", "No logs"], ["opensearch", "OpenSearch cluster"], ["app_log", "Shared app logs"]].map(([k, l]) => (
                <label key={k} className="inline-flex items-center gap-1.5"><input type="radio" checked={form.logsKind === k} onChange={() => set({ logsKind: k as Form["logsKind"] })} /> {l}</label>
              ))}
            </div>
            {form.logsKind === "opensearch" && (
              <div className="space-y-3">
                <Field label="Cluster">
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
          </Section>

          <Section title="Database">
            <div className="mb-3 flex flex-wrap gap-4 text-sm">
              {[["none", "No database"], ["metabase", "Metabase"]].map(([k, l]) => (
                <label key={k} className="inline-flex items-center gap-1.5"><input type="radio" checked={form.dbKind === k} onChange={() => set({ dbKind: k as Form["dbKind"] })} /> {l}</label>
              ))}
            </div>
            {form.dbKind === "metabase" && (
              <div className="space-y-3">
                <Field label="Metabase instance">
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
          </Section>

          <Section title="Other sources">
            {!form.extra.length && <p className="text-sm text-muted">None yet.</p>}
            <div className="space-y-3">
              {form.extra.map((x, i) => {
                const upd = (p: Partial<typeof x>) => set({ extra: form.extra.map((y, j) => (j === i ? { ...y, ...p } : y)) });
                return (
                  <div key={i} className="grid gap-2 border-b border-dashed border-line pb-3 sm:grid-cols-[1fr_1.5fr_auto]">
                    <input className={input} placeholder="Name, e.g. SAP IDoc monitor" value={x.name} onChange={(e) => upd({ name: e.target.value })} />
                    <input className={input} placeholder="Link (optional)" value={x.url} onChange={(e) => upd({ url: e.target.value })} />
                    <button type="button" aria-label="Remove source" className={`${btn} text-bad`} onClick={() => set({ extra: form.extra.filter((_, j) => j !== i) })}>Remove</button>
                    <textarea className={`${input} sm:col-span-3`} rows={2} placeholder="Notes for the agent: what's there, when to check it, who owns it" value={x.notes} onChange={(e) => upd({ notes: e.target.value })} />
                  </div>
                );
              })}
            </div>
            <button type="button" className="mt-3 text-xs font-medium text-accent-strong hover:underline" onClick={() => set({ extra: [...form.extra, { name: "", url: "", notes: "" }] })}>+ Add source</button>
          </Section>

          <div className="sticky bottom-0 -mx-4 flex items-center gap-3 border-t border-line bg-panel px-4 py-3 sm:-mx-6 sm:px-6">
            {!form.devrev.length && <span className="text-xs text-muted">Add at least one DevRev account to save.</span>}
            <button className={`${btn} ml-auto`} onClick={() => setForm(null)}>Cancel</button>
            <button className={btnPrimary} disabled={busy || !form.name || !form.devrev.length} onClick={save}>{busy ? "Saving…" : "Save client"}</button>
          </div>
          </div>
        </SlideSheet>
      )}
    </div>
  );
}

/** Repos a client's investigations may read: a multi-select over the repos connected under Connections → GitHub. */
function RepoPicker({ known, value, onChange }: { known: string[]; value: string[]; onChange: (v: string[]) => void }) {
  const [remote, setRemote] = useState<string[] | null>(null);
  useEffect(() => {
    fetch("/api/admin/code?connected=1").then((r) => (r.ok ? r.json() : { repos: [] })).then((d) => setRemote(d.repos ?? [])).catch(() => setRemote([]));
  }, []);
  const all = [...new Set([...(remote ?? known), ...value])].sort((a, b) => a.localeCompare(b));
  return (
    <MultiSelect value={value.map((r) => ({ value: r, label: r, mono: true }))} onChange={(v) => onChange(v.map((o) => o.value))}
      options={all.map((r) => ({ value: r, label: r, mono: true }))} placeholder="Choose repos…" searchPlaceholder="Search connected repos…"
      emptyText="No repos connected yet (Connections → GitHub)" />
  );
}

/** One card of the client form: a small header, then its fields. */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card space-y-3 p-4">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</h3>
      {children}
    </section>
  );
}
