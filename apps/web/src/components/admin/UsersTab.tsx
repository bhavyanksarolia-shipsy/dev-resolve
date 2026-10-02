"use client";
import { useCallback, useEffect, useState } from "react";
import { btn, btnPrimary, Field, input, Note, post, Select, Switch } from "./ui";
import { confirmDialog } from "@/components/Dialog";

interface U {
  name: string; email: string | null; display_name: string | null; is_admin: boolean; disabled_at: string | null; last_login_at: string | null;
  created_at: string; locked_until: string | null; has_password: boolean; sessions: number; investigations: number; connector_seen: string | null;
}
const when = (d: string | null) => (d ? new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");

/** User access control: everyone who can sign in, and what they may do. */
export function UsersTab() {
  const [data, setData] = useState<{ users: U[]; me: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const blank = { display_name: "", name: "", email: "", password: "", admin: false };
  const [nu, setNu] = useState(blank);
  const [pw, setPw] = useState<{ name: string; value: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => fetch("/api/admin/users", { cache: "no-store" }).then((r) => r.json()).then(setData), []);
  useEffect(() => { load(); }, [load]);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<"all" | "active" | "admins" | "disabled">("all");

  async function act(body: Record<string, unknown>, ask?: { title: string; message: string; confirmLabel: string; danger?: boolean; requireText?: string }) {
    if (ask && !(await confirmDialog(ask))) return;
    setBusy(true);
    const r = await post("/api/admin/users", body);
    setBusy(false);
    setMsg({ ok: !r.error, text: r.error || r.message || "Done" });
    if (!r.error) { setPw(null); await load(); }
    return !r.error;
  }

  if (!data) return <div className="skeleton h-48 w-full rounded-xl" />;
  const active = data.users.filter((u) => !u.disabled_at);
  const q = query.trim().toLowerCase();
  const shown = data.users.filter((u) =>
    (show === "all" || (show === "active" && !u.disabled_at) || (show === "admins" && u.is_admin && !u.disabled_at) || (show === "disabled" && !!u.disabled_at)) &&
    (!q || [u.name, u.display_name, u.email].some((v) => v?.toLowerCase().includes(q))));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-sm">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          <input className={`${input} pl-9`} placeholder="Search name, username or email…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search users" />
          {query && <button type="button" aria-label="Clear search" onClick={() => setQuery("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-fg">✕</button>}
        </div>
        <button className={`${btnPrimary} ml-auto`} onClick={() => { setNu(blank); setAdding(true); }}>+ Add user</button>
      </div>
      <div className="flex flex-wrap gap-2 text-sm">
        {([
          ["all", `All · ${data.users.length}`],
          ["active", `${active.length} active`],
          ["admins", `${active.filter((u) => u.is_admin).length} admins`],
          ["disabled", `${data.users.length - active.length} disabled`],
        ] as const).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)}
            className={`rounded-full px-3 py-1 ring-1 transition-colors ${show === k ? "bg-accent text-white ring-accent" : "bg-panel text-muted ring-line hover:text-fg"}`}>{l}</button>
        ))}
      </div>
      {msg && !adding && <Note ok={msg.ok}>{msg.text}</Note>}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-head text-left text-xs font-semibold uppercase tracking-wide text-head-fg">
            <tr><th className="px-4 py-3">Person</th><th className="px-4 py-3">Sign-in</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Last login</th><th className="px-4 py-3">Extension</th><th className="px-4 py-3 text-right">Investigations</th><th className="px-4 py-3">Actions</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {shown.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-sm text-muted">No users match{query ? ` “${query}”` : ""}.
                {(query || show !== "all") && <button className="ml-2 text-accent-strong underline" onClick={() => { setQuery(""); setShow("all"); }}>Show everyone</button>}</td></tr>
            )}
            {shown.map((u) => {
              const me = u.name === data.me;
              const locked = u.locked_until && new Date(u.locked_until) > new Date();
              return (
                <tr key={u.name} className={u.disabled_at ? "bg-bg text-muted" : ""}>
                  <td className="px-4 py-3"><div className="font-medium">{u.display_name || u.name}{me && <span className="ml-2 text-xs text-muted">(you)</span>}</div>
                    <div className="text-xs text-muted">{u.email || u.name}</div></td>
                  <td className="px-4 py-3 text-xs">{[u.email && "Google", u.has_password && "password"].filter(Boolean).join(" + ") || "—"}</td>
                  <td className="px-4 py-3">
                    <Switch on={u.is_admin} disabled={busy || me || !!u.disabled_at} title={me ? "You can't change your own role" : ""}
                      onChange={(v) => act({ action: "role", name: u.name, admin: v }, v
                        ? { title: `Make ${u.display_name || u.name} an admin?`, message: "Admins manage people, clients, connections and private files.", confirmLabel: "Make admin" }
                        : { title: `Remove ${u.display_name || u.name}'s admin role?`, message: "They keep investigating as a member.", confirmLabel: "Make member" })}
                      label={<span className="text-xs">{u.is_admin ? "Admin" : "Member"}</span>} />
                  </td>
                  <td className="px-4 py-3 text-xs">{u.disabled_at ? <span className="text-bad">Disabled</span> : locked ? <span className="text-warn">Locked (wrong passwords)</span> : <span className="text-ok">Active</span>}
                    <div className="text-muted">{u.sessions} open session{u.sessions === 1 ? "" : "s"}</div></td>
                  <td className="px-4 py-3 text-xs text-muted">{when(u.last_login_at)}</td>
                  <td className="px-4 py-3 text-xs text-muted">{u.connector_seen ? `seen ${when(u.connector_seen)}` : "not set up"}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{u.investigations}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {u.disabled_at
                        ? <button className={btn} disabled={busy} onClick={() => act({ action: "enable", name: u.name })}>Enable</button>
                        : <button className={`${btn} text-bad`} disabled={busy || me} onClick={() => act({ action: "disable", name: u.name }, { title: `Disable ${u.display_name || u.name}?`, message: "They're signed out everywhere and can't sign in until enabled again. Their investigations and history stay.", confirmLabel: "Disable", danger: true })}>Disable</button>}
                      <button className={btn} disabled={busy} onClick={() => setPw(pw?.name === u.name ? null : { name: u.name, value: "" })}>{u.has_password ? "Reset password" : "Set password"}</button>
                      <button className={`${btn} text-bad`} disabled={busy || me} title={me ? "You can't delete yourself" : ""}
                        onClick={() => act({ action: "delete", name: u.name, confirm: u.name }, { title: `Delete ${u.display_name || u.name}?`, danger: true, confirmLabel: "Delete permanently", requireText: u.name,
                          message: "This removes their login, sessions, Chrome extension link and stored Google sign-ins. It can't be undone. Their past investigations stay (to just block them, use Disable)." })}>Delete</button>
                    </div>
                    {pw?.name === u.name && (
                      <div className="mt-2 flex gap-2">
                        <input type="password" autoComplete="new-password" className={input} placeholder="12+ characters" value={pw.value} onChange={(e) => setPw({ ...pw, value: e.target.value })} />
                        <button className={btnPrimary} disabled={busy || pw.value.length < 12} onClick={() => act({ action: "set_password", name: u.name, password: pw.value })}>Save</button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {adding && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && setAdding(false)}>
          <form role="dialog" aria-modal="true" aria-labelledby="add-user-title" className="w-full max-w-lg space-y-4 rounded-2xl bg-panel p-6 shadow-xl ring-1 ring-line"
            onSubmit={async (e) => { e.preventDefault(); const ok = await act({ action: "add", ...nu }); if (ok) { setNu(blank); setAdding(false); } }}>
            <div>
              <h2 id="add-user-title" className="font-semibold">Add user</h2>
              <p className="mt-1 text-xs text-muted">They can sign in with a password, their Google account, or both.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Name"><input autoFocus className={input} value={nu.display_name} placeholder="Asha Rao" onChange={(e) => setNu({ ...nu, display_name: e.target.value })} /></Field>
              <Field label="Username" hint="a-z 0-9 . _ -"><input className={input} value={nu.name} placeholder="asha.rao" autoComplete="off"
                onChange={(e) => setNu({ ...nu, name: e.target.value.toLowerCase().replace(/\s+/g, ".") })} /></Field>
              <Field label="Password" hint="12+ characters · optional if they use Google"><input className={input} type="password" autoComplete="new-password" value={nu.password} onChange={(e) => setNu({ ...nu, password: e.target.value })} /></Field>
              <Field label="Google email" hint="optional · enables Sign in with Google"><input className={input} type="email" value={nu.email} placeholder="asha@company.com" onChange={(e) => setNu({ ...nu, email: e.target.value })} /></Field>
            </div>
            <Field label="Role">
              <Select value={nu.admin ? "admin" : "member"} onChange={(v) => setNu({ ...nu, admin: v === "admin" })} options={[
                { value: "member", label: "Member", hint: "Investigates tickets" },
                { value: "admin", label: "Admin", hint: "Also manages users, clients and connections" },
              ]} />
            </Field>
            {msg && !msg.ok && <Note ok={false}>{msg.text}</Note>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="rounded-lg border border-line px-4 py-2 text-sm font-medium hover:border-accent" onClick={() => setAdding(false)}>Cancel</button>
              <button type="submit" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong disabled:opacity-40"
                disabled={busy || !nu.name || (!nu.password && !nu.email.includes("@"))}>{busy ? "Adding…" : "Add user"}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
