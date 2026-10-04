"use client";
import { SlideSheet } from "@/components/SlideSheet";
import { useState } from "react";
import type { AdminConfig, Conn } from "./types";
import { btn, btnPrimary, Field, input, Note, post, Rows, Switch } from "./ui";
import { SourceCodeCard } from "./SourceCodeCard";
import { ServiceCard } from "./ServiceCard";
import { TableCard, usePaged } from "@/components/TableTools";

type Kind = "opensearch" | "metabase";
type Auth = "none" | "password" | "api_key" | "google";
interface Form {
  originalName: string | null; name: string; kind: Kind; url: string; vpn: boolean; vpnSuffix: string | null; gateway: boolean;
  auth: Auth; username: string; password: string; apiKey: string;
  patterns: string[]; databases: [string, string][]; defaultDatabase: number | null;
  secretsSet: { username: boolean; password: boolean; apiKey: boolean };
}

function toForm(c: Conn | null, kind: Kind): Form {
  const os = c?.opensearch, mb = c?.metabase, x = kind === "opensearch" ? os : mb;
  return {
    originalName: c && x ? c.name : null, name: c?.name ?? "", kind, url: x?.url ?? "", vpn: x?.vpn ?? false, vpnSuffix: x?.vpnSuffix ?? null,
    gateway: !!c?.appLog && kind === "opensearch",
    auth: kind === "opensearch" ? (os?.auth ?? "password") : (mb?.auth ?? "password"),
    username: "", password: "", apiKey: "",
    patterns: os?.patterns ?? [],
    databases: Object.entries(mb?.databases ?? {}),
    defaultDatabase: mb?.defaultDatabase ?? null,
    secretsSet: { username: !!x?.usernameSet, password: !!x?.passwordSet, apiKey: !!mb?.apiKeySet },
  };
}

const AUTH_LABEL: Record<Auth, string> = { none: "No auth", password: "Username + password", api_key: "API key", google: "Google login" };

/** Index patterns as removable chips plus an input to add more (Enter or comma adds). */
function PatternList({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => { const v = draft.trim().replace(/,$/, ""); if (v && !value.includes(v)) onChange([...value, v]); setDraft(""); };
  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {value.map((p) => (
            <li key={p} className="inline-flex items-center gap-1 rounded bg-accent-soft py-0.5 pl-2 pr-1 font-mono text-xs text-accent-strong">
              {p}<button type="button" aria-label={`Remove ${p}`} onClick={() => onChange(value.filter((x) => x !== p))} className="grid h-4 w-4 place-items-center rounded hover:bg-white/70 hover:text-bad">✕</button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex gap-2">
        <input className={`${input} font-mono`} value={draft} placeholder="app-logs-acme-*" onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } }} />
        <button type="button" className={btn} disabled={!draft.trim()} onClick={add}>Add</button>
      </div>
    </div>
  );
}

/** Systems clients use: OpenSearch log clusters and Metabase instances (URL, sign-in, VPN). */
export function ConnectionsTab({ cfg, reload }: { cfg: AdminConfig; reload: () => void }) {
  const [form, setForm] = useState<Form | null>(null);
  const [test, setTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [checks, setChecks] = useState<Record<string, { ok: boolean; message: string } | "…">>({});
  async function checkRow(c: Conn, kind: Kind) {
    const key = `${c.name}-${kind}`;
    setChecks((m) => ({ ...m, [key]: "…" }));
    const r = await post<{ ok: boolean; message: string }>("/api/admin/connections/test", { ...payload(toForm(c, kind)), existing: c.name });
    setChecks((m) => ({ ...m, [key]: { ok: !r.error && r.ok, message: r.error || r.message } }));
  }
  type Sub = "github" | "opensearch" | "metabase" | "claude" | "devrev";
  const [sub, setSub] = useState<Sub>("github");
  const [connQ, setConnQ] = useState("");
  const usedBy = (c: Conn, kind: Kind) => cfg.accounts.filter((a) => kind === "metabase" ? a.metabase_project === c.name
    : a.app_log?.project === c.name || Object.values(a.opensearch_log_types).some((lt) => c.opensearch?.logTypes[lt] !== undefined)).map((a) => a.name);
  const set = (p: Partial<Form>) => form && setForm({ ...form, ...p });
  const payload = (f: Form) => ({
    name: f.name, kind: f.kind, url: f.url, vpn: f.vpn, auth: f.auth, username: f.username, password: f.password, apiKey: f.apiKey,
    ...(f.kind === "opensearch" ? { patterns: f.patterns } : {
      databases: Object.fromEntries(f.databases.filter(([k, v]) => k && v)),
      default_database: f.defaultDatabase && f.databases.some(([k]) => Number(k) === f.defaultDatabase) ? f.defaultDatabase : null,
    }),
  });

  async function save() {
    if (!form) return;
    setBusy(true);
    const r = await post("/api/admin/connections", { originalName: form.originalName, connection: payload(form) });
    setBusy(false);
    if (r.error) { setTest({ ok: false, message: r.error }); return; }
    setMsg({ ok: true, text: r.message || "Saved" });
    setForm(null); reload();
  }
  /** Check the connection; for Metabase it also brings back the database list, merged into the form. */
  async function runTest() {
    if (!form) return;
    setBusy(true); setTest(null);
    const r = await post<{ ok: boolean; message: string; databases?: { id: number; name: string }[] }>("/api/admin/connections/test", { ...payload(form), existing: form.originalName ?? undefined });
    setBusy(false);
    const found = r.databases ?? [];
    const added = found.filter((d) => !form.databases.some(([k]) => Number(k) === d.id));
    setTest({ ok: !r.error && r.ok, message: (r.error || r.message) + (form.kind === "metabase" && found.length ? ` · ${found.length} databases found${added.length ? `, ${added.length} new below` : ""}` : "") });
    if (form.kind === "metabase" && found.length) setForm({ ...form, databases: [...form.databases, ...added.map((d): [string, string] => [String(d.id), d.name])] });
  }

  const rows = cfg.connections.flatMap((c) => {
    const x = sub === "metabase" ? c.metabase : c.opensearch;
    return x ? [{ c, x, kind: sub as Kind, list: sub === "metabase" ? Object.entries(c.metabase!.databases).map(([id, n]) => `${id} · ${n}`) : c.opensearch!.patterns, clients: usedBy(c, sub as Kind) }] : [];
  });
  const paged = usePaged(rows.filter(({ c, x }) => !connQ || [c.name, x.host].some((v) => v?.toLowerCase().includes(connQ.toLowerCase()))), { noun: "connections", reset: `${sub}|${connQ}` });
  const TABS: [Sub, string, number | null][] = [
    ["github", "GitHub", null], ["opensearch", "OpenSearch", cfg.connections.filter((c) => c.opensearch).length],
    ["metabase", "Metabase", cfg.connections.filter((c) => c.metabase).length], ["claude", "Claude", null], ["devrev", "DevRev", null],
  ];
  const newHostNeedsExt = form && form.vpn && !form.vpnSuffix && (() => { try { const h = new URL(form.url).hostname; return !cfg.vpnSuffixes.some((s) => h.endsWith(s)); } catch { return false; } })();
  const authChoices: Auth[] = form?.kind === "metabase" ? ["password", "api_key", "google"] : ["none", "password", "google"];

  return (
    <div className="space-y-4">
      {msg && <Note ok={msg.ok}>{msg.text}</Note>}
      {(
        <div role="tablist" aria-label="Connection types" className="inline-flex flex-wrap rounded-xl border border-line bg-panel p-1 text-sm font-medium">
          {TABS.map(([k, l, n]) => (
            <button key={k} role="tab" aria-selected={sub === k} onClick={() => setSub(k)}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 transition ${sub === k ? "bg-accent text-white shadow-sm" : "text-muted hover:text-fg"}`}>
              {l}{n != null && <span className={`rounded-full px-1.5 text-[10px] tabular-nums ${sub === k ? "bg-white/25" : "bg-bg"}`}>{n}</span>}
            </button>
          ))}
        </div>
      )}
      {sub === "github" && <SourceCodeCard />}
      {(sub === "claude" || sub === "devrev") && <ServiceCard key={sub} which={sub} />}
      {(sub === "opensearch" || sub === "metabase") && (
        <>
          <TableCard title={sub === "metabase" ? "Metabase connections" : "OpenSearch connections"} pager={paged.pager}
            search={connQ} onSearch={setConnQ} searchPlaceholder="Search connections…"
            actions={<button className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-strong" onClick={() => { setForm(toForm(null, sub as Kind)); setTest(null); }}>{sub === "metabase" ? "+ Metabase" : "+ OpenSearch"}</button>}>
            <table className="w-full text-sm">
              <thead className="bg-head text-left text-xs font-semibold uppercase tracking-wide text-head-fg">
                <tr><th className="px-4 py-3">Name</th><th className="px-4 py-3">Link</th><th className="px-4 py-3">VPN</th><th className="px-4 py-3">Auth</th>
                  <th className="px-4 py-3 text-right">{sub === "metabase" ? "Databases" : "Index patterns"}</th><th className="px-4 py-3 text-right">Clients</th><th className="px-4 py-3">Connection</th><th className="px-4 py-3" /></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {paged.rows.map(({ c, x, kind, list, clients }) => (
                  <tr key={`${c.name}-${kind}`}>
                    <td className="px-4 py-3 font-medium">{c.name}</td>
                    <td className="max-w-72 truncate px-4 py-3 font-mono text-xs" title={x.url}>{x.host || <span className="text-bad">no link</span>}</td>
                    <td className="px-4 py-3 text-xs">{x.vpn ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-warn ring-1 ring-amber-200">VPN</span> : <span className="text-muted">—</span>}</td>
                    <td className="px-4 py-3 text-xs">{AUTH_LABEL[x.auth]}
                      {x.auth === "password" && !(x.usernameSet && x.passwordSet) && <span className="ml-1 text-bad">· not set</span>}
                      {x.auth === "api_key" && !(x as { apiKeySet?: boolean }).apiKeySet && <span className="ml-1 text-bad">· not set</span>}</td>
                    <td className="px-4 py-3 text-right tabular-nums" title={list.join("\n")}>{list.length}</td>
                    <td className="px-4 py-3 text-right tabular-nums" title={clients.length ? clients.join(", ") : "No client uses it"}>{clients.length}</td>
                    <td className="max-w-56 px-4 py-3 text-xs">
                      {(() => { const r = checks[`${c.name}-${kind}`];
                        return r === "…" ? <span className="text-muted">checking…</span>
                          : r ? <button type="button" onClick={() => checkRow(c, kind)} title={`${r.message} — click to check again`} className={`line-clamp-2 text-left ${r.ok ? "text-ok" : "text-bad"}`}>{r.ok ? "● connected" : `○ ${r.message}`}</button>
                          : <button className={btn} onClick={() => checkRow(c, kind)}>Check</button>; })()}
                    </td>
                    <td className="px-4 py-3"><button className={btn} onClick={() => { setForm(toForm(c, kind)); setTest(null); }}>Edit</button></td>
                  </tr>
                ))}
                {!paged.rows.length && <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-muted">{connQ ? `No connections match “${connQ}”.` : "No connections yet."}</td></tr>}
              </tbody>
            </table>
          </TableCard>
        </>
      )}

      {form && (
        <SlideSheet title={form.originalName ? `Edit ${form.originalName}` : `New ${form.kind === "metabase" ? "Metabase" : "OpenSearch"} connection`} onClose={() => setForm(null)}>
          <div className="flex flex-1 flex-col gap-3">
          <section className="card space-y-3 p-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Connection</h3>
            <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
              <Field label="Name"><input className={input} value={form.name} disabled={!!form.originalName} placeholder={form.kind === "metabase" ? "acme_metabase" : "acme_logs"} onChange={(e) => set({ name: e.target.value })} /></Field>
              <Field label="Link"><input className={input} value={form.url} placeholder="https://" onChange={(e) => set({ url: e.target.value })} /></Field>
            </div>
            <Switch on={form.vpn || !!form.vpnSuffix} disabled={!!form.vpnSuffix} onChange={(v) => set({ vpn: v })}
              label={<span>Reachable only on the VPN{form.vpnSuffix && <span className="ml-1 text-xs text-muted">(covered by {form.vpnSuffix})</span>}</span>} />
            {newHostNeedsExt && <p className="text-xs text-warn">New VPN domain: everyone&apos;s connector needs updating to reach it (Connector page → download again).</p>}
          </section>

          <section className="card space-y-3 p-4">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">Auth</h3>
            <div role="radiogroup" className="inline-flex flex-wrap rounded-lg border border-line bg-bg p-0.5 text-sm">
              {authChoices.map((k) => {
                const locked = form.kind === "opensearch" && (form.gateway ? k !== "google" : k === "google");
                return (
                  <button key={k} type="button" role="radio" aria-checked={form.auth === k} disabled={locked}
                    title={locked ? (form.gateway ? "This is the Google-login app-log gateway" : "Google login works through the Shipsy app-log gateway only") : undefined}
                    onClick={() => set({ auth: k })}
                    className={`rounded-md px-3 py-1.5 transition disabled:cursor-not-allowed disabled:opacity-40 ${form.auth === k ? "bg-panel font-medium text-accent-strong shadow-sm" : "text-muted hover:text-fg"}`}>{AUTH_LABEL[k]}</button>
                );
              })}
            </div>
            {form.auth === "password" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Username" hint={form.secretsSet.username ? "Saved — leave empty to keep it" : undefined}><input className={input} autoComplete="off" value={form.username} onChange={(e) => set({ username: e.target.value })} /></Field>
                <Field label="Password" hint={form.secretsSet.password ? "Saved — leave empty to keep it" : undefined}><input className={input} type="password" autoComplete="new-password" value={form.password} onChange={(e) => set({ password: e.target.value })} /></Field>
              </div>
            )}
            {form.auth === "api_key" && (
              <Field label="API key" hint={form.secretsSet.apiKey ? "Saved — leave empty to keep it" : undefined}>
                <input className={input} type="password" autoComplete="off" value={form.apiKey} onChange={(e) => set({ apiKey: e.target.value })} />
              </Field>
            )}
            {form.auth === "google" && <p className="text-xs text-muted">Each person signs in with their own Google account on the Connector page.</p>}
          </section>

          <section className="card space-y-3 p-4">
            <div className="flex items-center gap-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{form.kind === "metabase" ? `Databases · ${form.databases.length}` : `Index patterns · ${form.patterns.length}`}</h3>
              {form.kind === "metabase" && form.auth !== "google" && (
                <button type="button" className="ml-auto text-xs font-medium text-accent-strong hover:underline disabled:opacity-50" disabled={busy || !form.url} onClick={runTest}>Fetch from Metabase</button>
              )}
            </div>
            {form.kind === "metabase"
              ? <Rows rows={form.databases.length ? form.databases : [["", ""]]} onChange={(r) => set({ databases: r })} keyLabel="ID" valueLabel="Name" keyPlaceholder="7" valuePlaceholder="Production Postgres replica" />
              : <PatternList value={form.patterns} onChange={(v) => set({ patterns: v })} />}
          </section>

          {test && <Note ok={test.ok}>{test.message}</Note>}
          <div className="sticky bottom-0 -mx-4 mt-auto flex items-center gap-3 border-t border-line bg-panel px-4 py-3 sm:-mx-6 sm:px-6">
            <button className={btn} disabled={busy || !form.url} onClick={runTest}>{busy ? "Checking…" : "Check connection"}</button>
            <button className={`${btn} ml-auto`} onClick={() => setForm(null)}>Cancel</button>
            <button className={btnPrimary} disabled={busy || !form.url || (!form.originalName && !form.name)} onClick={save}>Save</button>
          </div>
          </div>
        </SlideSheet>
      )}
    </div>
  );
}
