"use client";
import { useCallback, useEffect, useState } from "react";
import { btn, btnPrimary, input, Note, post, Switch } from "./ui";

interface U {
  name: string; email: string | null; display_name: string | null; is_admin: boolean; disabled_at: string | null; last_login_at: string | null;
  created_at: string; locked_until: string | null; has_password: boolean; sessions: number; investigations: number; connector_seen: string | null;
}
const when = (d: string | null) => (d ? new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");

/** User access control: everyone who can sign in, and what they may do. */
export function UsersTab() {
  const [data, setData] = useState<{ users: U[]; me: string } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [email, setEmail] = useState("");
  const [asAdmin, setAsAdmin] = useState(false);
  const [pw, setPw] = useState<{ name: string; value: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => fetch("/api/admin/users", { cache: "no-store" }).then((r) => r.json()).then(setData), []);
  useEffect(() => { load(); }, [load]);

  async function act(body: Record<string, unknown>, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    const r = await post("/api/admin/users", body);
    setBusy(false);
    setMsg({ ok: !r.error, text: r.error || r.message || "Done" });
    if (!r.error) { setPw(null); load(); }
  }

  if (!data) return <div className="skeleton h-48 w-full rounded-xl" />;
  const active = data.users.filter((u) => !u.disabled_at);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 text-sm">
        <span className="rounded-full bg-accent-soft px-3 py-1 text-accent-strong">{active.length} active</span>
        <span className="rounded-full bg-bg px-3 py-1 ring-1 ring-line">{active.filter((u) => u.is_admin).length} admins</span>
        <span className="rounded-full bg-bg px-3 py-1 text-muted ring-1 ring-line">{data.users.length - active.length} disabled</span>
      </div>
      {msg && <Note ok={msg.ok}>{msg.text}</Note>}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-head text-left text-xs font-semibold uppercase tracking-wide text-head-fg">
            <tr><th className="px-4 py-3">Person</th><th className="px-4 py-3">Sign-in</th><th className="px-4 py-3">Role</th><th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Last login</th><th className="px-4 py-3">Extension</th><th className="px-4 py-3 text-right">Investigations</th><th className="px-4 py-3">Actions</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.users.map((u) => {
              const me = u.name === data.me;
              const locked = u.locked_until && new Date(u.locked_until) > new Date();
              return (
                <tr key={u.name} className={u.disabled_at ? "bg-bg text-muted" : ""}>
                  <td className="px-4 py-3"><div className="font-medium">{u.display_name || u.name}{me && <span className="ml-2 text-xs text-muted">(you)</span>}</div>
                    <div className="text-xs text-muted">{u.email || u.name}</div></td>
                  <td className="px-4 py-3 text-xs">{[u.email && "Google", u.has_password && "password"].filter(Boolean).join(" + ") || "—"}</td>
                  <td className="px-4 py-3">
                    <Switch on={u.is_admin} disabled={busy || me || !!u.disabled_at} title={me ? "You can't change your own role" : ""}
                      onChange={(v) => act({ action: "role", name: u.name, admin: v }, v ? `Make ${u.name} an admin? Admins manage users, clients and connections.` : undefined)}
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
                        : <button className={`${btn} text-bad`} disabled={busy || me} onClick={() => act({ action: "disable", name: u.name }, `Disable ${u.name}? They're signed out everywhere and can't sign in until enabled again. Their history stays.`)}>Disable</button>}
                      <button className={btn} disabled={busy || !u.sessions} onClick={() => act({ action: "signout", name: u.name })}>Sign out</button>
                      <button className={btn} disabled={busy} onClick={() => setPw(pw?.name === u.name ? null : { name: u.name, value: "" })}>{u.has_password ? "Reset password" : "Set password"}</button>
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

      <div className="card space-y-3 p-4">
        <div className="font-medium">Add a person</div>
        <p className="text-xs text-muted">Anyone from the allowed Google domain gets a member login the first time they sign in. Add someone here to give them a role before that.</p>
        <div className="flex flex-wrap items-center gap-3">
          <input className={`${input} max-w-xs`} type="email" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Switch on={asAdmin} onChange={setAsAdmin} label={<span className="text-xs">Admin</span>} />
          <button className={btnPrimary} disabled={busy || !email.includes("@")} onClick={async () => { await act({ action: "add", email, admin: asAdmin }); setEmail(""); setAsAdmin(false); }}>Add</button>
        </div>
      </div>
    </div>
  );
}
