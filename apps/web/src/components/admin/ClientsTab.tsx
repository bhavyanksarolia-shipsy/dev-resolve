"use client";
import { SlideSheet } from "@/components/SlideSheet";
import { toast } from "@/components/Dialog";
import { useCallback, useEffect, useState } from "react";
import type { Acc, AdminConfig } from "./types";
import { ClientActiveToggle } from "@/components/ClientActiveToggle";
import { TableCard, usePaged } from "@/components/TableTools";
import { btn, btnPrimary, Field, input, MultiSelect, post, Select, Switch } from "./ui";

const SLOTS = ["app", "audit", "integration"] as const;
interface Form {
  originalSlug: string | null; name: string; group: string; client_active: boolean; code_repos: string[];
  extra: { name: string; url: string; notes: string }[];
  devrev: { id: string; name: string }[];
  /** Logs: the OpenSearch connection ("" = none) and the index pattern picked for each slot. */
  logConn: string; patterns: Record<string, string>; company: string; warehouses: string;
  /** Database: the Metabase connection ("" = none), its main database id and optional extra ones (postgres / mongo). */
  dbConn: string; database: string; databases: Record<string, string>; shared: boolean;
}

function toForm(a: Acc | null, cfg: AdminConfig): Form {
  // A client's logs are either on the Google-login gateway (app_log: patterns stored directly) or on a cluster
  // (log type names, which map to that cluster's patterns).
  const osConn = a ? cfg.connections.find((c) => c.opensearch && Object.values(a.opensearch_log_types).some((lt) => lt in c.opensearch!.logTypes)) : undefined;
  const patterns: Record<string, string> = a?.app_log ? { ...a.app_log.indices }
    : Object.fromEntries(Object.entries(a?.opensearch_log_types ?? {}).map(([slot, lt]) => [slot, osConn?.opensearch?.logTypes[lt] ?? ""]).filter(([, v]) => v));
  const comp = a?.app_log?.company;
  return {
    originalSlug: a?.slug ?? null, name: a?.name ?? "", group: a?.group ?? "", client_active: a?.client_active !== false,
    code_repos: a?.code_repos ?? ["stockone-neo"],
    extra: (a?.extra_sources ?? []).map((x) => ({ name: x.name, url: x.url ?? "", notes: x.notes ?? "" })),
    devrev: (a?.devrev.account_ids ?? []).map((id, i) => ({ id, name: a!.devrev.names[i] ?? id.slice(-8) })),
    logConn: a?.app_log?.project ?? osConn?.name ?? "", patterns,
    company: Array.isArray(comp) ? comp.join(", ") : comp ?? "", warehouses: (a?.app_log?.warehouses ?? []).join(", "),
    dbConn: a?.metabase_project ?? "", database: a?.metabase_database ? String(a.metabase_database) : "",
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
  const setMsg = toast;
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<Form>) => form && setForm({ ...form, ...p });
  const osConns = cfg.connections.filter((c) => c.opensearch), mbConns = cfg.connections.filter((c) => c.metabase);
  const conn = (name: string) => cfg.connections.find((c) => c.name === name);

  /** Gateway (Google login) clients keep their patterns directly; cluster clients point at the pattern's log type name. */
  function logsPayload() {
    if (!form?.logConn) return { kind: "none" };
    const c = conn(form.logConn), picked = Object.fromEntries(Object.entries(form.patterns).filter(([, v]) => v));
    if (c?.appLog) return { kind: "app_log", project: c.name, indices: picked,
      company: form.company.split(",").map((s) => s.trim()).filter(Boolean), warehouses: form.warehouses.split(",").map((s) => s.trim()).filter(Boolean) };
    const keyOf = (pat: string) => Object.entries(c?.opensearch?.logTypes ?? {}).find(([, v]) => v === pat)?.[0] ?? "";
    return { kind: "opensearch", project: form.logConn, log_types: Object.fromEntries(Object.entries(picked).map(([slot, pat]) => [slot, keyOf(pat)]).filter(([, k]) => k)) };
  }

  async function save() {
    if (!form) return;
    setBusy(true);
    const account = {
      name: form.name, group: form.group || null, client_active: form.client_active, code_repos: form.code_repos, extra_sources: form.extra.filter((x) => x.name.trim()),
      devrev: { account_ids: form.devrev.map((d) => d.id), names: form.devrev.map((d) => d.name) },
      logs: logsPayload(),
      db: form.dbConn ? { kind: "metabase", project: form.dbConn, database: Number(form.database), shared: form.shared,
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
          <div className="flex flex-1 flex-col gap-3">

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
            <Field label="Connection">
              <Select value={form.logConn} onChange={(v) => set({ logConn: v, patterns: v === form.logConn ? form.patterns : {} })}
                options={[{ value: "", label: "No logs" }, ...osConns.map((c) => ({ value: c.name, label: c.opensearch!.displayName, hint: [c.opensearch?.host, c.opensearch?.auth === "google" && "Google login", c.opensearch?.vpn && "VPN"].filter(Boolean).join(" · ") }))]} />
            </Field>
            {form.logConn && (
              <div className="grid gap-3 sm:grid-cols-3">
                {SLOTS.map((slot) => (
                  <Field key={slot} label={`${slot[0].toUpperCase()}${slot.slice(1)} logs`}>
                    <Select value={form.patterns[slot] ?? ""} placeholder="—" onChange={(v) => set({ patterns: { ...form.patterns, [slot]: v } })}
                      options={[{ value: "", label: "—", hint: "not used" }, ...(conn(form.logConn)?.opensearch?.patterns ?? []).map((p) => ({ value: p, label: p }))]} />
                  </Field>
                ))}
              </div>
            )}
            {conn(form.logConn)?.appLog && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Company filter"><input className={input} value={form.company} placeholder="Company names, comma-separated" onChange={(e) => set({ company: e.target.value })} /></Field>
                <Field label="Warehouses (optional)"><input className={input} value={form.warehouses} placeholder="Warehouse codes, comma-separated" onChange={(e) => set({ warehouses: e.target.value })} /></Field>
              </div>
            )}
          </Section>

          <Section title="Database">
            <Field label="Connection">
              <Select value={form.dbConn} onChange={(v) => set({ dbConn: v, database: v === form.dbConn ? form.database : String(conn(v)?.metabase?.defaultDatabase ?? ""), databases: v === form.dbConn ? form.databases : {} })}
                options={[{ value: "", label: "No database" }, ...mbConns.map((c) => ({ value: c.name, label: c.metabase!.displayName, hint: [c.metabase?.host, c.metabase?.auth === "google" && "Google login", c.metabase?.vpn && "VPN"].filter(Boolean).join(" · ") }))]} />
            </Field>
            {form.dbConn && (() => {
              const dbs = Object.entries(conn(form.dbConn)?.metabase?.databases ?? {}).map(([id, n]) => ({ value: id, label: n || `Database ${id}`, hint: `id ${id}` }));
              return (
                <>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field label="Main database"><Select value={form.database} onChange={(v) => set({ database: v })} options={dbs} /></Field>
                    <Field label="Postgres (optional)"><Select value={form.databases.postgres ?? ""} placeholder="—" onChange={(v) => set({ databases: { ...form.databases, postgres: v } })} options={[{ value: "", label: "—", hint: "not used" }, ...dbs]} /></Field>
                    <Field label="Mongo (optional)"><Select value={form.databases.mongo ?? ""} placeholder="—" onChange={(v) => set({ databases: { ...form.databases, mongo: v } })} options={[{ value: "", label: "—", hint: "not used" }, ...dbs]} /></Field>
                  </div>
                  <Switch on={form.shared} onChange={(v) => set({ shared: v })} label="Shared by several clients (the agent filters every query to this client)" />
                </>
              );
            })()}
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

          <div className="sticky bottom-0 -mx-4 mt-auto flex items-center gap-3 border-t border-line bg-panel px-4 py-3 sm:-mx-6 sm:px-6">
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
