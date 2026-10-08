"use client";
import { useCallback, useEffect, useState } from "react";
import { Note, btn, Field, input, post, Select, Switch } from "./ui";
import { confirmDialog, toast } from "@/components/Dialog";
import { Paged, TableCard } from "@/components/TableTools";
import { Modal } from "@/components/Modal";

interface U {
  name: string; email: string | null; display_name: string | null; is_admin: boolean; disabled_at: string | null; last_login_at: string | null;
  created_at: string; locked_until: string | null; has_password: boolean; sessions: number; last_active_at: string | null; investigations: number; connector_seen: string | null; connector_online?: boolean; connector_kind?: string | null;
}
const when = (d: string | null) => (d ? new Date(d).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");

/** User access control: everyone who can sign in, and what they may do. */
export function UsersTab() {
  const [data, setData] = useState<{ users: U[]; me: string; mail_configured?: boolean } | null>(null);
  const setMsg = toast;
  const blank = { display_name: "", name: "", email: "", password: "", admin: false, welcome: true };
  const [nu, setNu] = useState(blank);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const load = useCallback(() => fetch("/api/admin/users", { cache: "no-store" }).then(async (r) => {
    const d = await r.json().catch(() => ({}));
    if (r.ok && Array.isArray(d.users)) { setData(d); setLoadError(null); } else setLoadError(d.error || `HTTP ${r.status}`);
  }).catch(() => setLoadError("Couldn't reach the backend")), []);
  useEffect(() => { load(); }, [load]);
  const [prefs, setPrefs] = useState<{ trail: boolean; autoAccept: boolean } | null>(null);
  useEffect(() => {
    fetch("/api/admin/settings", { cache: "no-store" }).then(async (r) => {
      if (!r.ok) return;
      const d = await r.json();
      setPrefs({ trail: d.TRAIL_FOR_MEMBERS?.value === "on", autoAccept: d.KNOWLEDGE_AUTO_ACCEPT?.value !== "off" });
    }).catch(() => {});
  }, []);
  async function savePref(key: "TRAIL_FOR_MEMBERS" | "KNOWLEDGE_AUTO_ACCEPT", on: boolean) {
    const r = await post("/api/admin/settings", { [key]: on ? "on" : "off" });
    if (r.error) return setMsg({ ok: false, text: r.error });
    setPrefs((p) => p && (key === "TRAIL_FOR_MEMBERS" ? { ...p, trail: on } : { ...p, autoAccept: on }));
  }
  const [adding, setAdding] = useState(false);
  // Edit window: the person being edited (orig) and the form.
  type Edit = { orig: U; display_name: string; name: string; email: string; password: string; active: boolean; admin: boolean };
  const [edit, setEdit] = useState<Edit | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const openEdit = (u: U) => { setEdit({ orig: u, display_name: u.display_name ?? "", name: u.name, email: u.email ?? "", password: "", active: !u.disabled_at, admin: u.is_admin }); setEditOpen(true); };
  const closeEdit = () => setEditOpen(false);
  async function saveEdit() {
    if (!edit) return;
    const o = edit.orig, steps: string[] = [];
    const call = async (body: Record<string, unknown>) => { const r = await post("/api/admin/users", body); if (r.error) throw new Error(r.error); };
    setBusy(true);
    try {
      let name = o.name;
      if (edit.display_name !== (o.display_name ?? "") || edit.name !== o.name || edit.email.trim().toLowerCase() !== (o.email ?? "")) {
        await call({ action: "update", name, new_name: edit.name, display_name: edit.display_name, email: edit.email });
        name = edit.name; steps.push(edit.name !== o.name ? `username is now "${edit.name}"` : "details saved");
      }
      if (edit.password) { await call({ action: "set_password", name, password: edit.password }); steps.push("password reset (signed out elsewhere)"); }
      if (edit.admin !== o.is_admin) { await call({ action: "role", name, admin: edit.admin }); steps.push(edit.admin ? "now an admin" : "now a member"); }
      if (edit.active !== !o.disabled_at) { await call({ action: edit.active ? "enable" : "disable", name }); steps.push(edit.active ? "active again" : "deactivated and signed out"); }
      setMsg({ ok: true, text: steps.length ? `${edit.display_name || name}: ${steps.join(" · ")}` : "Nothing changed" });
      setEditOpen(false); await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message }); await load();
    } finally { setBusy(false); }
  }
  async function deleteFromEdit() {
    if (!edit) return;
    const u = edit.orig;
    const ok = await act({ action: "delete", name: u.name, confirm: u.name }, { title: `Delete ${u.display_name || u.name}?`, danger: true, confirmLabel: "Delete permanently", requireText: u.name,
      message: "This removes their login, sessions, Chrome extension link and stored Google sign-ins. It can't be undone. Their past investigations stay (to just block them, switch Active off)." });
    if (ok) setEditOpen(false);
  }
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<"all" | "active" | "admins" | "disabled">("all");

  async function act(body: Record<string, unknown>, ask?: { title: string; message: string; confirmLabel: string; danger?: boolean; requireText?: string }) {
    if (ask && !(await confirmDialog(ask))) return;
    setBusy(true);
    const r = await post("/api/admin/users", body);
    setBusy(false);
    setMsg({ ok: !r.error && !/NOT sent/.test(r.message ?? ""), text: r.error || r.message || "Done" }); // added but the email failed → shown as a warning
    if (!r.error) await load();
    return !r.error;
  }

  if (!data) return loadError ? <Note ok={false}>{loadError === "Admins only" ? "Only admins can see this." : loadError}</Note> : <div className="skeleton h-48 w-full rounded-xl" />;
  const active = data.users.filter((u) => !u.disabled_at);
  const q = query.trim().toLowerCase();
  const shown = data.users.filter((u) =>
    (show === "all" || (show === "active" && !u.disabled_at) || (show === "admins" && u.is_admin && !u.disabled_at) || (show === "disabled" && !!u.disabled_at)) &&
    (!q || [u.name, u.display_name, u.email].some((v) => v?.toLowerCase().includes(q))));
  return (
    <div className="space-y-4">

      {prefs && (
        <div className="card flex flex-wrap gap-x-8 gap-y-3 px-4 py-3">
          <Switch on={prefs.trail} onChange={(v) => savePref("TRAIL_FOR_MEMBERS", v)}
            label={<span>Members can see the full investigation trail <span className="text-muted">— off: they see a progress card only</span></span>} />
          <Switch on={prefs.autoAccept} onChange={(v) => savePref("KNOWLEDGE_AUTO_ACCEPT", v)}
            label={<span>Auto-accept the agent&apos;s knowledge proposals <span className="text-muted">— only admins see proposals</span></span>} />
        </div>
      )}

      <Paged items={shown} noun="people" reset={`${query}|${show}`}>{(rows, pager) => (
      <TableCard title="People" pager={pager}
        toolbar={
      <div className="flex flex-wrap gap-1.5 text-xs">
        {([
          ["all", `All · ${data.users.length}`],
          ["active", `${active.length} active`],
          ["admins", `${active.filter((u) => u.is_admin).length} admins`],
          ["disabled", `${data.users.length - active.length} disabled`],
        ] as const).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={show === k} onClick={() => setShow(k)}
            className={`rounded-full px-2.5 py-1 ring-1 transition-colors ${show === k ? "bg-accent text-white ring-accent" : "bg-panel text-muted ring-line hover:text-fg"}`}>{l}</button>
        ))}
      </div>}
        search={query} onSearch={setQuery} searchPlaceholder="Search people…"
        actions={<button className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-strong" onClick={() => { setNu(blank); setAdding(true); }}>+ Add user</button>}>
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
            {rows.map((u) => {
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
                    <div className="text-muted" title="Sessions that still work: used in the last 12 h and under 7 days old">{u.sessions} open session{u.sessions === 1 ? "" : "s"}
                      {u.sessions > 0 && (
                        <> · <button type="button" disabled={busy} className="text-accent-strong underline-offset-2 hover:underline disabled:opacity-50"
                          title="Sign them out on every device and browser"
                          onClick={async () => { const ok = await act({ action: "signout", name: u.name }, {
                            title: me ? "Sign out everywhere?" : `End all of ${u.display_name || u.name}'s sessions?`,
                            message: me ? `Ends all ${u.sessions} of your sessions, including this one — you'll need to sign in again.`
                              : `They're signed out on every device (${u.sessions} session${u.sessions === 1 ? "" : "s"}). They can sign in again right away; to block them, use Disable.`,
                            confirmLabel: "End sessions" }); if (ok && me) window.location.assign("/login"); }}>End all</button></>
                      )}
                    </div></td>
                  <td className="px-4 py-3 text-xs text-muted">{when(u.last_login_at)}
                    {u.last_active_at && <div title="Last time they used Dev Resolve">active {when(u.last_active_at)}</div>}</td>
                  <td className="px-4 py-3 text-xs">{u.connector_online
                    ? <span className="inline-flex items-center gap-1.5 text-ok"><span className="h-2 w-2 rounded-full bg-ok" />running now{u.connector_kind === "terminal" ? " (terminal)" : ""}</span>
                    : <span className="text-muted">{u.connector_seen ? `last seen ${when(u.connector_seen)}` : "not set up on this server"}</span>}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{u.investigations}</td>
                  <td className="px-4 py-3">
                    <button className={btn} disabled={busy} onClick={() => openEdit(u)}>Edit</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableCard>)}</Paged>

      <Modal open={adding} onClose={() => setAdding(false)} labelledBy="add-user-title" locked={busy}>
          <form className="w-full space-y-4 rounded-2xl bg-panel p-6 shadow-xl ring-1 ring-line"
            onSubmit={async (e) => { e.preventDefault(); const ok = await act({ action: "add", ...nu, welcome: nu.welcome && !!data?.mail_configured && nu.email.includes("@"), appUrl: window.location.origin }); if (ok) { setNu(blank); setAdding(false); } }}>
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
            {(() => {
              const can = !!data?.mail_configured && nu.email.includes("@");
              return (
                <label className={`flex items-start gap-2.5 rounded-lg bg-bg px-3 py-2.5 text-sm ${can ? "cursor-pointer" : "text-muted"}`}>
                  <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--accent)]" disabled={!can} checked={can && nu.welcome} onChange={(e) => setNu({ ...nu, welcome: e.target.checked })} />
                  <span>Send a welcome email with the onboarding steps
                    <span className="block text-xs text-muted">{!data?.mail_configured ? "Set up email first: Admin → Connections → Email" : !nu.email.includes("@") ? "Needs their email above" : `To ${nu.email} — sign-in link, My Pods, Connector, VPN, how to investigate. Passwords are never emailed.`}</span>
                  </span>
                </label>
              );
            })()}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="rounded-lg border border-line px-4 py-2 text-sm font-medium hover:border-accent" onClick={() => setAdding(false)}>Cancel</button>
              <button type="submit" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong disabled:opacity-40"
                disabled={busy || !nu.name || (!nu.password && !nu.email.includes("@"))}>{busy ? "Adding…" : "Add user"}</button>
            </div>
          </form>
      </Modal>

      {/* Edit user: name, username, email, password reset, role, active — and delete. Esc or Cancel goes back. */}
      <Modal open={editOpen} onClose={closeEdit} labelledBy="edit-user-title" locked={busy}>
        {edit && (() => {
          const me = edit.orig.name === data.me;
          const changed = edit.display_name !== (edit.orig.display_name ?? "") || edit.name !== edit.orig.name || edit.email.trim().toLowerCase() !== (edit.orig.email ?? "")
            || !!edit.password || edit.admin !== edit.orig.is_admin || edit.active !== !edit.orig.disabled_at;
          return (
            <form className="w-full space-y-4 rounded-2xl bg-panel p-6 shadow-xl ring-1 ring-line" onSubmit={(e) => { e.preventDefault(); void saveEdit(); }}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <h2 id="edit-user-title" className="font-semibold">Edit {edit.orig.display_name || edit.orig.name}{me && <span className="ml-2 text-xs font-normal text-muted">(you)</span>}</h2>
                  <p className="mt-1 text-xs text-muted">{edit.orig.investigations} investigation{edit.orig.investigations === 1 ? "" : "s"} · last login {when(edit.orig.last_login_at)}</p>
                </div>
                <button type="button" onClick={closeEdit} aria-label="Close" className="-mr-1 -mt-1 h-8 w-8 rounded-md text-lg text-muted hover:bg-bg hover:text-fg">×</button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name"><input autoFocus className={input} value={edit.display_name} placeholder="Asha Rao" onChange={(e) => setEdit({ ...edit, display_name: e.target.value })} /></Field>
                <Field label="Username" hint={edit.name !== edit.orig.name ? "Their history moves to the new username" : "a-z 0-9 . _ -"}>
                  <input className={input} value={edit.name} autoComplete="off" onChange={(e) => setEdit({ ...edit, name: e.target.value.toLowerCase().replace(/\s+/g, ".") })} /></Field>
                <Field label="Google email" hint="Sign in with Google"><input className={input} type="email" value={edit.email} placeholder="asha@company.com" onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></Field>
                <Field label={edit.orig.has_password ? "Reset password" : "Set a password"} hint="12+ characters · leave empty to keep">
                  <input className={input} type="password" autoComplete="new-password" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} /></Field>
              </div>
              <div className="space-y-3 rounded-lg bg-bg px-3 py-3">
                <Switch on={edit.active} disabled={me} title={me ? "You can't deactivate yourself" : ""} onChange={(v) => setEdit({ ...edit, active: v })}
                  label={<span className="text-sm">{edit.active ? "Active" : "Inactive"} <span className="text-xs text-muted">{edit.active ? "— can sign in" : "— signed out everywhere and can't sign in"}</span></span>} />
                <Switch on={edit.admin} disabled={me} title={me ? "You can't change your own role" : ""} onChange={(v) => setEdit({ ...edit, admin: v })}
                  label={<span className="text-sm">{edit.admin ? "Admin" : "Member"} <span className="text-xs text-muted">{edit.admin ? "— also manages users, clients and connections" : "— investigates tickets"}</span></span>} />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <button type="button" className="rounded-lg border border-line px-3 py-2 text-sm font-medium text-bad hover:border-bad disabled:opacity-40" disabled={busy || me}
                  title={me ? "You can't delete yourself" : "Delete this user permanently"} onClick={deleteFromEdit}>Delete user</button>
                <span className="ml-auto hidden text-xs text-muted sm:inline">Esc to go back</span>
                <button type="button" className="rounded-lg border border-line px-4 py-2 text-sm font-medium hover:border-accent" onClick={closeEdit}>Cancel</button>
                <button type="submit" className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong disabled:opacity-40"
                  disabled={busy || !changed || !edit.name || (!!edit.password && edit.password.length < 12)}>{busy ? "Saving…" : "Save"}</button>
              </div>
            </form>
          );
        })()}
      </Modal>
    </div>
  );
}
