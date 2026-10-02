"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Select } from "./admin/ui";
import { notify } from "./Dialog";

interface Field { key: string; label: string; type: "user" | "enum" | "text"; options?: string[] }
interface User { id: string; name: string; email?: string }
interface Form {
  fields: Field[]; users: User[]; me: string | null;
  prefill: Record<string, { title: string; from_rca: boolean; values: Record<string, unknown> }>;
}
type Values = Record<string, string>;

const str = (v: unknown) => (v == null ? "" : String(v));
const filled = (v: string) => !!v.trim() && !/^\s*(\.|-|na|n\/a)\s*$/i.test(v);

/**
 * Resolve one or more tickets with the fields DevRev requires on resolve (CX Lead, FRIDAY Review, Root cause and
 * resolution details, Resolution RCA, Resolved By). Values come pre-filled from the ticket or Dev Resolve's RCA.
 */
export function ResolveDialog({ tickets, onClose, onDone }: { tickets: string[]; onClose: () => void; onDone: (resolved: string[]) => void }) {
  const [form, setForm] = useState<Form | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shared, setShared] = useState<Values>({});
  const [perTicket, setPerTicket] = useState<Record<string, string>>({}); // root cause text per ticket
  const [busy, setBusy] = useState(false);
  const many = tickets.length > 1;

  useEffect(() => {
    fetch(`/api/tickets/resolve-form?tickets=${tickets.join(",")}`, { cache: "no-store" }).then(async (r) => {
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setError(d.error || `HTTP ${r.status}`);
      const f = d as Form;
      const text = f.fields.find((x) => x.type === "text");
      const s: Values = {};
      for (const fld of f.fields) {
        if (fld === text) continue;
        // Shared fields: the value every ticket already agrees on, else empty for the reviewer to choose.
        const vals = new Set(tickets.map((t) => str(f.prefill[t]?.values[fld.key])));
        s[fld.key] = vals.size === 1 ? [...vals][0] : "";
      }
      setShared(s);
      if (text) setPerTicket(Object.fromEntries(tickets.map((t) => [t, str(f.prefill[t]?.values[text.key])])));
      setForm(f);
    }).catch(() => setError("Couldn't reach the backend"));
  }, [tickets]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [busy, onClose]);

  const textField = form?.fields.find((x) => x.type === "text");
  const missing = useMemo(() => {
    if (!form) return [];
    const m = form.fields.filter((f) => f.type !== "text" && !filled(shared[f.key] ?? "")).map((f) => f.label);
    if (textField && tickets.some((t) => !filled(perTicket[t] ?? ""))) m.push(textField.label);
    return m;
  }, [form, shared, perTicket, textField, tickets]);

  async function submit() {
    if (!form || missing.length) return;
    setBusy(true);
    const body = {
      tickets, stage: "resolved",
      fields: Object.fromEntries(Object.entries(shared).filter(([, v]) => filled(v))),
      ...(textField && { perTicket: Object.fromEntries(tickets.map((t) => [t, { [textField.key]: perTicket[t].trim() }])) }),
    };
    const r = await fetch("/api/tickets/update", { method: "POST", body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    setBusy(false);
    if (d.error) return notify({ title: "Not resolved", message: d.error, tone: "error" });
    const failed: { ticket: string; error?: string }[] = d.failed ?? [];
    if (failed.length) notify({ title: `${d.updated} resolved, ${failed.length} not`, message: failed.slice(0, 4).map((f) => `${f.ticket}: ${f.error}`).join(" · "), tone: "error" });
    else notify({ message: many ? `${d.updated} tickets resolved in DevRev` : `${tickets[0]} resolved in DevRev`, tone: "ok" });
    const bad = new Set(failed.map((f) => f.ticket));
    if (d.updated) onDone(tickets.filter((t) => !bad.has(t)));
    if (!failed.length) onClose();
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/30 p-4 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label="Resolve tickets" className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-panel shadow-2xl">
        <div className="flex items-start gap-3 border-b border-line px-6 py-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-strong">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
          </span>
          <div className="min-w-0">
            <h2 className="font-semibold">{many ? `Resolve ${tickets.length} tickets` : `Resolve ${tickets[0]}`}</h2>
            <p className="text-xs text-muted">DevRev needs these filled to resolve. Pre-filled from the ticket and Dev Resolve&apos;s RCA — check them.</p>
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Close" className="ml-auto rounded-md px-2 text-lg text-muted hover:text-fg">✕</button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {error && <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-bad ring-1 ring-red-200">{error}</div>}
          {!form && !error && <div className="space-y-3">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-10 w-full rounded-lg" />)}</div>}
          {form && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                {form.fields.filter((f) => f.type !== "text").map((f) => (
                  <label key={f.key} className="block text-sm">
                    <span className="mb-1 flex items-center gap-1 font-medium">{f.label}{!filled(shared[f.key] ?? "") && <span className="text-bad" title="Required">*</span>}</span>
                    {f.type === "user"
                      ? <UserPicker users={form.users} me={form.me} value={shared[f.key] ?? ""} onChange={(v) => setShared({ ...shared, [f.key]: v })} />
                      : <Select value={shared[f.key] ?? ""} placeholder={many ? "Choose (applies to all)" : "Choose…"}
                          options={(f.options ?? []).map((o) => ({ value: o, label: o }))} onChange={(v) => setShared({ ...shared, [f.key]: v })} />}
                  </label>
                ))}
              </div>
              {textField && (
                <div className="text-sm">
                  <div className="mb-1 flex items-center gap-1 font-medium">{textField.label}
                    {tickets.some((t) => !filled(perTicket[t] ?? "")) && <span className="text-bad" title="Required">*</span>}</div>
                  <div className="space-y-3">
                    {tickets.map((t) => (
                      <div key={t}>
                        {many && (
                          <div className="mb-1 flex items-center gap-2 text-xs">
                            <span className="font-mono font-semibold text-accent-strong">{t}</span>
                            <span className="truncate text-muted">{form.prefill[t]?.title}</span>
                            {form.prefill[t]?.from_rca && <span className="ml-auto shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent-strong">from RCA</span>}
                          </div>
                        )}
                        <textarea value={perTicket[t] ?? ""} onChange={(e) => setPerTicket({ ...perTicket, [t]: e.target.value })} rows={many ? 3 : 6}
                          placeholder="What was the problem and how was it fixed?"
                          className={`w-full rounded-lg border bg-bg px-3 py-2 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft ${filled(perTicket[t] ?? "") ? "border-line" : "border-red-300"}`} />
                      </div>
                    ))}
                  </div>
                  {!many && form.prefill[tickets[0]]?.from_rca && <p className="mt-1 text-xs text-muted">Drafted from Dev Resolve&apos;s RCA.</p>}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-line bg-bg/50 px-6 py-3">
          <span className="min-w-0 truncate text-xs text-muted">{form && (missing.length ? `Still needed: ${missing.join(", ")}` : "Everything DevRev needs is filled")}</span>
          <button onClick={onClose} disabled={busy} className="ml-auto rounded-lg border border-line px-4 py-2 text-sm font-medium hover:border-accent">Cancel</button>
          <button onClick={submit} disabled={!form || busy || missing.length > 0}
            className="rounded-lg bg-ok px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
            {busy ? "Resolving…" : many ? `Resolve ${tickets.length} tickets` : "Resolve ticket"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Type-to-search DevRev user picker (with a "Me" shortcut). */
function UserPicker({ users, me, value, onChange }: { users: User[]; me: string | null; value: string; onChange: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const current = users.find((u) => u.id === value);
  const matches = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (s ? users.filter((u) => u.name.toLowerCase().includes(s) || u.email?.toLowerCase().includes(s)) : users).slice(0, 8);
  }, [q, users]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);
  return (
    <div ref={box} className="relative">
      <input value={open ? q : current ? current.name : ""} onFocus={() => { setQ(""); setOpen(true); }} onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        placeholder="Search a person…" className={`w-full rounded-md border bg-bg px-2 py-1.5 pr-12 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft ${value ? "border-line" : "border-red-300"}`} />
      {me && value !== me && (
        <button type="button" onClick={() => { onChange(me); setOpen(false); }} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1.5 py-0.5 text-xs font-medium text-accent-strong hover:bg-accent-soft">Me</button>
      )}
      {open && (
        <ul className="absolute left-0 right-0 z-50 mt-1 max-h-60 overflow-auto rounded-lg border border-line bg-panel py-1 shadow-lg">
          {matches.length === 0 && <li className="px-3 py-2 text-sm text-muted">No one matches</li>}
          {matches.map((u) => (
            <li key={u.id} onMouseDown={(e) => { e.preventDefault(); onChange(u.id); setOpen(false); }}
              className={`cursor-pointer px-3 py-1.5 text-sm hover:bg-accent-soft ${u.id === value ? "font-medium text-accent-strong" : ""}`}>
              {u.name}{u.email && <span className="block text-xs text-muted">{u.email}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
