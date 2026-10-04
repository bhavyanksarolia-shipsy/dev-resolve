"use client";
import { useState } from "react";
import type { AdminConfig, Conn } from "./types";
import { btn, btnPrimary, Field, input, Note, post, Rows, Switch } from "./ui";
import { SourceCodeCard } from "./SourceCodeCard";
import { ServiceCard } from "./ServiceCard";

type Kind = "opensearch" | "metabase";
interface Form {
  originalName: string | null; name: string; label: string; kind: Kind; url: string; vpn: boolean;
  auth: "none" | "password" | "api_key" | "google"; username: string; password: string; apiKey: string;
  logTypes: [string, string][]; databases: [string, string][]; defaultDatabase: string;
  secretsSet: { username: boolean; password: boolean; apiKey: boolean }; vpnSuffix: string | null;
}

function toForm(c: Conn | null, kind: Kind): Form {
  const os = c?.opensearch, mb = c?.metabase, x = kind === "opensearch" ? os : mb;
  return {
    originalName: c && x ? c.name : null, name: c?.name ?? "", label: c?.label ?? "", kind, url: x?.url ?? "", vpn: x?.vpn ?? false,
    auth: kind === "opensearch" ? (os?.auth ?? "password") : (mb?.auth ?? "password"),
    username: "", password: "", apiKey: "",
    logTypes: Object.entries(os?.logTypes ?? {}).length ? Object.entries(os!.logTypes) : [["", ""]],
    databases: Object.entries(mb?.databases ?? {}).length ? Object.entries(mb!.databases) : [["", ""]],
    defaultDatabase: mb?.defaultDatabase != null ? String(mb.defaultDatabase) : "",
    secretsSet: { username: !!x?.usernameSet, password: !!x?.passwordSet, apiKey: !!mb?.apiKeySet }, vpnSuffix: x?.vpnSuffix ?? null,
  };
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
  const usedBy = (name: string) => cfg.accounts.filter((a) => a.metabase_project === name || a.app_log?.project === name ||
    Object.values(a.opensearch_log_types).some((lt) => cfg.connections.find((c) => c.name === name)?.opensearch?.logTypes[lt] !== undefined)).length;
  const set = (p: Partial<Form>) => form && setForm({ ...form, ...p });
  const payload = (f: Form) => ({
    name: f.name, label: f.label, kind: f.kind, url: f.url, vpn: f.vpn, auth: f.auth, username: f.username, password: f.password, apiKey: f.apiKey,
    log_types: Object.fromEntries(f.logTypes.filter(([k, v]) => k && v)),
    databases: Object.fromEntries(f.databases.filter(([k, v]) => k && v)), default_database: f.defaultDatabase ? Number(f.defaultDatabase) : null,
  });

  async function save() {
    if (!form) return;
    setBusy(true);
    const r = await post("/api/admin/connections", { originalName: form.originalName, connection: payload(form) });
    setBusy(false);
    setMsg({ ok: !r.error, text: r.error || r.message || "Saved" });
    if (!r.error) { setForm(null); reload(); }
  }
  async function runTest() {
    if (!form) return;
    setBusy(true); setTest(null);
    setTest(await post<{ ok: boolean; message: string }>("/api/admin/connections/test", { ...payload(form), existing: form.originalName ?? undefined }));
    setBusy(false);
  }

  const allRows = cfg.connections.flatMap((c) => [
    ...(c.opensearch ? [{ c, kind: "opensearch" as Kind, x: c.opensearch, what: "OpenSearch logs", detail: `${Object.keys(c.opensearch.logTypes).length} log types` }] : []),
    ...(c.metabase ? [{ c, kind: "metabase" as Kind, x: c.metabase, what: "Metabase", detail: `${Object.keys(c.metabase.databases).length} databases · ${c.metabase.auth === "google" ? "each person's Google" : c.metabase.auth === "api_key" ? "API key" : "username/password"}` }] : []),
  ]);
  const rows = allRows.filter((r) => r.kind === sub);
  const appLogs = sub === "opensearch" ? cfg.connections.filter((c) => c.appLog) : [];
  const TABS: [Sub, string, number | null][] = [
    ["github", "GitHub", null], ["opensearch", "OpenSearch", allRows.filter((r) => r.kind === "opensearch").length + cfg.connections.filter((c) => c.appLog).length],
    ["metabase", "Metabase", allRows.filter((r) => r.kind === "metabase").length], ["claude", "Claude", null], ["devrev", "DevRev", null],
  ];
  const newHostNeedsExt = form && form.vpn && !form.vpnSuffix && (() => { try { const h = new URL(form.url).hostname; return !cfg.vpnSuffixes.some((s) => h.endsWith(s)); } catch { return false; } })();

  return (
    <div className="space-y-4">
      {msg && <Note ok={msg.ok}>{msg.text}</Note>}
      {!form && (
        <div role="tablist" aria-label="Connection types" className="inline-flex flex-wrap rounded-xl border border-line bg-panel p-1 text-sm font-medium">
          {TABS.map(([k, l, n]) => (
            <button key={k} role="tab" aria-selected={sub === k} onClick={() => setSub(k)}
              className={`flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 transition ${sub === k ? "bg-accent text-white shadow-sm" : "text-muted hover:text-fg"}`}>
              {l}{n != null && <span className={`rounded-full px-1.5 text-[10px] tabular-nums ${sub === k ? "bg-white/25" : "bg-bg"}`}>{n}</span>}
            </button>
          ))}
        </div>
      )}
      {!form && sub === "github" && <SourceCodeCard />}
      {!form && (sub === "claude" || sub === "devrev") && <ServiceCard key={sub} which={sub} />}
      {!form && (sub === "opensearch" || sub === "metabase") && (
        <>
          <div className="flex gap-2">
            <button className={btnPrimary} onClick={() => { setForm(toForm(null, sub)); setTest(null); }}>{sub === "metabase" ? "+ Metabase" : "+ OpenSearch logs"}</button>
          </div>
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-head text-left text-xs font-semibold uppercase tracking-wide text-head-fg">
                <tr><th className="px-4 py-3">Connection</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Host</th><th className="px-4 py-3">VPN</th><th className="px-4 py-3">Sign-in</th><th className="px-4 py-3 text-right">Clients</th><th className="px-4 py-3">Connection</th><th className="px-4 py-3" /></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map(({ c, kind, x, what, detail }) => (
                  <tr key={`${c.name}-${kind}`}>
                    <td className="px-4 py-3"><div className="font-medium">{c.name}</div><div className="max-w-xs truncate text-xs text-muted">{c.label}</div></td>
                    <td className="px-4 py-3 text-xs">{what}<div className="text-muted">{detail}</div></td>
                    <td className="px-4 py-3 font-mono text-xs">{x.host || <span className="text-bad">no URL</span>}</td>
                    <td className="px-4 py-3 text-xs">{x.vpn ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-warn ring-1 ring-amber-200">VPN</span> : "—"}</td>
                    <td className="px-4 py-3 text-xs">{x.auth === "google" ? "Google (per person)" : x.auth === "api_key" ? "API key ✓" : x.auth === "none" ? "none" : `${x.usernameSet ? "user ✓" : "user ✗"} · ${x.passwordSet ? "password ✓" : "password ✗"}`}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{usedBy(c.name)}</td>
                    <td className="max-w-56 px-4 py-3 text-xs">
                      {(() => { const r = checks[`${c.name}-${kind}`];
                        return r === "…" ? <span className="text-muted">checking…</span>
                          : r ? <span title={r.message} className={`line-clamp-2 ${r.ok ? "text-ok" : "text-bad"}`}>{r.ok ? "● connected" : `○ ${r.message}`}</span>
                          : <button className={btn} onClick={() => checkRow(c, kind)}>Check</button>; })()}
                    </td>
                    <td className="px-4 py-3"><button className={btn} onClick={() => { setForm(toForm(c, kind)); setTest(null); }}>Edit</button></td>
                  </tr>
                ))}
                {appLogs.map((c) => (
                  <tr key={`${c.name}-applog`} className="text-muted">
                    <td className="px-4 py-3"><div className="font-medium text-fg">{c.name}</div><div className="text-xs">{c.label}</div></td>
                    <td className="px-4 py-3 text-xs">Shared app logs</td><td className="px-4 py-3 text-xs" colSpan={3}>Each person signs in with Google (Connector page)</td>
                    <td className="px-4 py-3 text-right tabular-nums">{cfg.accounts.filter((a) => a.app_log?.project === c.name).length}</td><td className="px-4 py-3 text-xs">per person</td><td />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {form && (
        <div className="card space-y-4 p-5">
          <div className="flex items-center gap-3">
            <h2 className="font-semibold">{form.originalName ? `Edit ${form.originalName}` : `New ${form.kind === "metabase" ? "Metabase" : "OpenSearch logs"} connection`}</h2>
            <button className={`${btn} ml-auto`} onClick={() => setForm(null)}>Cancel</button>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" hint={form.originalName ? "Can't be renamed (clients point to it)" : "Short id, e.g. acme_metabase"}>
              <input className={input} value={form.name} disabled={!!form.originalName} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field label="Description"><input className={input} value={form.label} placeholder="e.g. Acme production Metabase" onChange={(e) => set({ label: e.target.value })} /></Field>
            <Field label={form.kind === "metabase" ? "Metabase URL" : "OpenSearch Dashboards search URL"}
              hint={form.kind === "opensearch" ? "…/internal/search/opensearch-with-long-numerals (same as the existing clusters)" : undefined}>
              <input className={input} value={form.url} placeholder="https://" onChange={(e) => set({ url: e.target.value })} />
            </Field>
            <div className="pt-6">
              <Switch on={form.vpn || !!form.vpnSuffix} disabled={!!form.vpnSuffix} onChange={(v) => set({ vpn: v })}
                label={<span>Needs the company VPN{form.vpnSuffix && <span className="ml-1 text-xs text-muted">— covered by {form.vpnSuffix}</span>}</span>} />
              <div className="mt-1 text-xs text-muted">VPN-only hosts are reached through each person&apos;s Chrome extension.</div>
              {newHostNeedsExt && <div className="mt-1 text-xs text-warn">New VPN domain: everyone&apos;s extension needs updating to reach it (Connector page → download again, or a new Web Store version).</div>}
            </div>
          </div>

          <Field label="Sign-in">
            <div className="flex flex-wrap gap-4 text-sm">
              {(form.kind === "metabase" ? [["password", "Username + password"], ["api_key", "API key"], ["google", "Each person's Google sign-in"]] : [["password", "Username + password"], ["none", "No sign-in (network only)"]]).map(([k, l]) => (
                <label key={k} className="inline-flex items-center gap-1.5"><input type="radio" checked={form.auth === k} onChange={() => set({ auth: k as Form["auth"] })} /> {l}</label>
              ))}
            </div>
          </Field>
          {form.auth === "password" && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Username" hint={form.secretsSet.username ? "Stored ✓ — leave empty to keep it" : undefined}><input className={input} autoComplete="off" value={form.username} onChange={(e) => set({ username: e.target.value })} /></Field>
              <Field label="Password" hint={form.secretsSet.password ? "Stored ✓ — leave empty to keep it" : "Stored on the server only; never shown again"}><input className={input} type="password" autoComplete="new-password" value={form.password} onChange={(e) => set({ password: e.target.value })} /></Field>
            </div>
          )}
          {form.auth === "api_key" && (
            <Field label="API key" hint={form.secretsSet.apiKey ? "Stored ✓ — leave empty to keep it" : "Metabase → Admin → Settings → Authentication → API keys"}>
              <input className={input} type="password" autoComplete="off" value={form.apiKey} onChange={(e) => set({ apiKey: e.target.value })} />
            </Field>
          )}
          {form.auth === "google" && <p className="text-xs text-muted">Nothing to store — each person signs in with Google in their own Chrome; the extension brings their session.</p>}

          {form.kind === "opensearch"
            ? <Field label="Log types" hint="Name each log type and its index pattern; clients pick from these."><Rows rows={form.logTypes} onChange={(r) => set({ logTypes: r })} keyLabel="Log type" valueLabel="Index pattern" keyPlaceholder="acme_app" valuePlaceholder="app-logs-acme-*" /></Field>
            : <>
                <Field label="Databases" hint="The database ids from Metabase (Admin → Databases → the number in the URL)."><Rows rows={form.databases} onChange={(r) => set({ databases: r })} keyLabel="Database id" valueLabel="What it is" keyPlaceholder="7" valuePlaceholder="Production Postgres replica" /></Field>
                <Field label="Default database id"><input className={`${input} max-w-[8rem]`} value={form.defaultDatabase} onChange={(e) => set({ defaultDatabase: e.target.value })} /></Field>
              </>}

          {test && <Note ok={test.ok}>{test.message}</Note>}
          <div className="flex gap-2">
            <button className={btn} disabled={busy || !form.url} onClick={runTest}>{busy ? "…" : "Test connection"}</button>
            <button className={btnPrimary} disabled={busy || !form.url || (!form.originalName && !form.name)} onClick={save}>Save</button>
          </div>
        </div>
      )}
    </div>
  );
}
