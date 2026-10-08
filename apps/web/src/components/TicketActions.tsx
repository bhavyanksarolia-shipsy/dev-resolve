"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { confirmDialog, notify } from "./Dialog";
import { usePresence } from "@/components/Motion";

export interface StageOption { id: string; name: string; final: boolean }
interface Options {
  stage: { id: string | null; name: string | null }; pod: string | null; stages: StageOption[]; pods: string[];
  part: { id: string; name: string } | null; parts: { id: string; name: string; type?: string; product?: string }[];
  account: { id: string; name: string } | null;
  owner: { id: string; name: string } | null;
}
interface UpdateResult { ok: boolean; updated: number; failed: { ticket: string; error?: string }[]; warnings?: { ticket: string; warning: string }[]; error?: string }

export const stageLabel = (s: string | null | undefined) => {
  const t = (s || "").replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const CLEAR_POD = "__none__";

/** Stages a ticket can move to and the Pod values, from DevRev (via the backend). */
export function useTicketOptions(ticket: string | null, reload = 0) {
  const [opts, setOpts] = useState<Options | null>(null);
  useEffect(() => {
    if (!ticket) return;
    let live = true;
    fetch(`/api/tickets/options?ticket=${encodeURIComponent(ticket)}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null)).then((d) => { if (live) setOpts(d); }).catch(() => {});
    return () => { live = false; };
  }, [ticket, reload]);
  return opts;
}

/** Changes Stage and/or Pod on DevRev tickets after a confirm, and reports what DevRev accepted. */
export async function updateTickets(tickets: string[], change: { stage?: string; pod?: string | null; account?: { id: string; name: string }; part?: { id: string; name: string }; owner?: { id: string; name: string } }) {
  const what = [change.stage && `stage → ${stageLabel(change.stage)}`, change.pod !== undefined && `Pod → ${change.pod ?? "none"}`,
    change.account && `account → ${change.account.name}`, change.part && `part → ${change.part.name}`, change.owner && `owner → ${change.owner.name}`].filter(Boolean).join(" and ");
  const many = tickets.length > 1;
  // Resolve is one click (empty resolve fields get the defaults on the server); other changes are confirmed first.
  const ok = change.stage === "resolved" || await confirmDialog({
    title: many ? `Update ${tickets.length} tickets in DevRev?` : `Update ${tickets[0]} in DevRev?`,
    message: `Set ${what}${many ? ` on: ${tickets.slice(0, 12).join(", ")}${tickets.length > 12 ? ` and ${tickets.length - 12} more` : ""}` : ""}. This changes the ticket${many ? "s" : ""} in DevRev for everyone.` ,
    confirmLabel: change.stage === "resolved" ? (many ? `Resolve ${tickets.length} tickets` : "Mark resolved") : "Update",
  });
  if (!ok) return null;
  const r = await fetch("/api/tickets/update", { method: "POST", body: JSON.stringify({ tickets, ...change, account: change.account?.id, part: change.part?.id, owner: change.owner?.id }) });
  const d: UpdateResult = await r.json().catch(() => ({ ok: false, updated: 0, failed: [], error: `HTTP ${r.status}` }));
  if (d.warnings?.length) notify({ title: "Check in DevRev", message: d.warnings.slice(0, 4).map((w) => `${w.ticket}: ${w.warning}`).join(" · "), tone: "error" });
  if (d.error) notify({ title: "Not updated", message: d.error, tone: "error" });
  else if (d.failed.length) notify({
    title: `${d.updated} updated, ${d.failed.length} not`,
    message: d.failed.slice(0, 4).map((f) => `${f.ticket}: ${f.error}`).join(" · ") + (d.failed.length > 4 ? " …" : ""), tone: "error",
  });
  else notify({ message: change.stage === "resolved" ? (many ? `${d.updated} tickets resolved` : `${tickets[0]} resolved`) : many ? `${d.updated} tickets updated in DevRev` : `${tickets[0]} updated in DevRev`, tone: "ok" });
  return d;
}

/** Small pill that opens a short menu — used for Stage / Pod on the ticket page. */
function PillMenu({ label, value, tone = "plain", items, disabled, onPick }: {
  label: string; value: string; tone?: "plain" | "accent" | "muted"; disabled?: boolean;
  items: { value: string; label: string; hint?: string }[]; onPick: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const pres = usePresence(open); // opens and closes smoothly
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const colors = tone === "accent" ? "bg-accent-soft text-accent-strong ring-emerald-200" : tone === "muted" ? "bg-bg text-muted ring-line" : "bg-panel text-fg ring-line";
  return (
    <div ref={box} className="relative">
      <button type="button" disabled={disabled} onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 transition hover:ring-accent disabled:opacity-50 ${colors}`}>
        <span className="text-muted">{label}</span>{value}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {pres.show && (
        <ul role="menu" className={`absolute left-0 z-40 mt-1.5 max-h-72 min-w-[13rem] overflow-auto rounded-xl border border-line bg-panel py-1 text-sm shadow-lg ${pres.cls}`}>
          {items.length === 0 && <li className="px-3 py-2 text-muted">Nothing to change to</li>}
          {items.map((it) => (
            <li key={it.value} role="menuitem" onClick={() => { setOpen(false); onPick(it.value); }}
              className="cursor-pointer px-3 py-1.5 hover:bg-accent-soft">
              {it.label}{it.hint && <span className="block text-xs text-muted">{it.hint}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Where a pill's pop-up goes: fixed under the pill, kept inside the window. (Inside the ticket column it would be cut off
 * by the column's scroll area and scroll the column sideways.)
 */
function usePopover(open: boolean, width = 320) {
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useEffect(() => {
    if (!open || !btn.current) return;
    const place = () => { const r = btn.current!.getBoundingClientRect(); setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - width - 8)) }); };
    place();
    window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open, width]);
  return { btn, style: pos ? { position: "fixed" as const, top: pos.top, left: pos.left, width } : { display: "none" } };
}

/** Account pill: search DevRev accounts (2+ letters) and move the ticket to one; shows which client each belongs to. */
function AccountPill({ current, disabled, onPick }: { current: { id: string; name: string } | null; disabled?: boolean; onPick: (a: { id: string; name: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<{ id: string; name: string; client: string | null }[] | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null); // the pop-up is drawn at the page level (portal), outside `box`
  const { btn: popBtn, style: popStyle } = usePopover(open);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node) && !popRef.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc, true); };
  }, [open]);
  useEffect(() => {
    const needle = q.trim();
    if (!open || needle.length < 2) return;
    let live = true;
    const t = setTimeout(() => fetch(`/api/devrev-accounts?q=${encodeURIComponent(needle)}`).then((r) => r.json())
      .then((d) => { if (live) setFound(d.results ?? []); }).catch(() => live && setFound([])), 250);
    return () => { live = false; clearTimeout(t); };
  }, [q, open]);
  const rows = q.trim().length >= 2 ? (found ?? []).filter((a) => a.id !== current?.id) : [];
  return (
    <div ref={box} className="relative">
      <button ref={popBtn} type="button" disabled={disabled} onClick={() => { setOpen((o) => !o); setQ(""); setFound(null); }} aria-haspopup="dialog" aria-expanded={open}
        title={current?.name} className="inline-flex max-w-72 items-center gap-1.5 rounded-full bg-panel px-3 py-1 text-xs font-medium ring-1 ring-line transition hover:ring-accent disabled:opacity-50">
        <span className="text-muted">Account</span><span className="truncate">{current?.name ?? "not set"}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && createPortal(
        <div ref={popRef} role="dialog" aria-label="Change account" style={popStyle} className="z-50 overflow-hidden rounded-xl border border-line bg-panel text-sm shadow-lg">
          <div className="border-b border-line p-2">
            <input ref={(el) => el?.focus({ preventScroll: true })} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search DevRev accounts…"
              className="w-full rounded-md border border-line bg-panel px-2 py-1.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft" />
          </div>
          <ul className="max-h-72 overflow-auto py-1">
            {q.trim().length < 2 && <li className="px-3 py-2 text-xs text-muted">Type at least 2 letters</li>}
            {q.trim().length >= 2 && found === null && <li className="px-3 py-2 text-xs text-muted">Searching…</li>}
            {q.trim().length >= 2 && found !== null && !rows.length && <li className="px-3 py-2 text-xs text-muted">No account matches “{q.trim()}”</li>}
            {rows.map((a) => (
              <li key={a.id} role="menuitem" onClick={() => { setOpen(false); onPick({ id: a.id, name: a.name }); }} className="cursor-pointer px-3 py-1.5 hover:bg-accent-soft">
                <span className="break-words [overflow-wrap:anywhere]">{a.name}</span>
                <span className={`block text-xs ${a.client ? "text-muted" : "text-warn"}`}>{a.client ? `Client: ${a.client}` : "Not set up on a client"}</span>
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </div>
  );
}

/** Part pill: every DevRev product and the parts under it, searchable (the list is long); shows the product under each. */
function PartPill({ current, parts, disabled, onPick }: {
  current: { id: string; name: string } | null; parts: { id: string; name: string; type?: string; product?: string }[];
  disabled?: boolean; onPick: (p: { id: string; name: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null); // the pop-up is drawn at the page level (portal), outside `box`
  const { btn: popBtn, style: popStyle } = usePopover(open);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node) && !popRef.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc, true); };
  }, [open]);
  const needle = q.trim().toLowerCase();
  const rows = parts.filter((p) => p.id !== current?.id && (!needle || `${p.name} ${p.product ?? ""}`.toLowerCase().includes(needle))).slice(0, 200);
  return (
    <div ref={box} className="relative">
      <button ref={popBtn} type="button" disabled={disabled} onClick={() => { setOpen((o) => !o); setQ(""); }} aria-haspopup="dialog" aria-expanded={open}
        title={current?.name} className="inline-flex max-w-72 items-center gap-1.5 rounded-full bg-panel px-3 py-1 text-xs font-medium ring-1 ring-line transition hover:ring-accent disabled:opacity-50">
        <span className="text-muted">Part</span><span className="truncate">{current?.name ?? "not set"}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && createPortal(
        <div ref={popRef} role="dialog" aria-label="Change part" style={popStyle} className="z-50 overflow-hidden rounded-xl border border-line bg-panel text-sm shadow-lg">
          <div className="border-b border-line p-2">
            <input ref={(el) => el?.focus({ preventScroll: true })} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search parts…"
              className="w-full rounded-md border border-line bg-panel px-2 py-1.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft" />
          </div>
          <ul className="max-h-72 overflow-auto py-1">
            {!rows.length && <li className="px-3 py-2 text-xs text-muted">{parts.length ? `No part matches “${q.trim()}”` : "No parts to choose from"}</li>}
            {rows.map((p) => (
              <li key={p.id} role="menuitem" onClick={() => { setOpen(false); onPick({ id: p.id, name: p.name }); }} className="cursor-pointer px-3 py-1.5 hover:bg-accent-soft">
                <span className="break-words [overflow-wrap:anywhere]">{p.name}</span>
                {p.product && p.product !== p.name && <span className="block text-xs text-muted">{p.product}</span>}
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </div>
  );
}

/** Owner pill: DevRev users, searchable by name or email, with "Assign to me" first. */
function OwnerPill({ current, disabled, onPick }: { current: { id: string; name: string } | null; disabled?: boolean; onPick: (u: { id: string; name: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null); // the pop-up is drawn at the page level (portal), outside `box`
  const { btn: popBtn, style: popStyle } = usePopover(open);
  const people = useDevrevUsers(open);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node) && !popRef.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc, true);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc, true); };
  }, [open]);
  const needle = q.trim().toLowerCase();
  const me = people?.users.find((u) => u.id === people.me);
  const rows = (people?.users ?? []).filter((u) => u.id !== current?.id && (!needle || `${u.name} ${u.email ?? ""}`.toLowerCase().includes(needle))).slice(0, 100);
  return (
    <div ref={box} className="relative">
      <button ref={popBtn} type="button" disabled={disabled} onClick={() => { setOpen((o) => !o); setQ(""); }} aria-haspopup="dialog" aria-expanded={open}
        title={current?.name} className={`inline-flex max-w-72 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 transition hover:ring-accent disabled:opacity-50 ${current ? "bg-panel ring-line" : "bg-bg text-muted ring-line"}`}>
        <span className="text-muted">Owner</span><span className="truncate">{current?.name ?? "unassigned"}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && createPortal(
        <div ref={popRef} role="dialog" aria-label="Change owner" style={popStyle} className="z-50 overflow-hidden rounded-xl border border-line bg-panel text-sm shadow-lg">
          <div className="border-b border-line p-2">
            <input ref={(el) => el?.focus({ preventScroll: true })} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people…"
              className="w-full rounded-md border border-line bg-panel px-2 py-1.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft" />
          </div>
          <ul className="max-h-72 overflow-auto py-1">
            {!people && <li className="px-3 py-2 text-xs text-muted">Loading people…</li>}
            {me && me.id !== current?.id && !needle && (
              <li role="menuitem" onClick={() => { setOpen(false); onPick({ id: me.id, name: me.name }); }} className="cursor-pointer border-b border-line px-3 py-1.5 font-medium text-accent-strong hover:bg-accent-soft">
                Assign to me<span className="block text-xs font-normal text-muted">{me.name}</span>
              </li>
            )}
            {people && !rows.length && <li className="px-3 py-2 text-xs text-muted">No one matches “{q.trim()}”</li>}
            {rows.map((u) => (
              <li key={u.id} role="menuitem" onClick={() => { setOpen(false); onPick({ id: u.id, name: u.name }); }} className="cursor-pointer px-3 py-1.5 hover:bg-accent-soft">
                <span className="break-words [overflow-wrap:anywhere]">{u.name}</span>
                {u.email && <span className="block text-xs text-muted">{u.email}</span>}
              </li>
            ))}
          </ul>
        </div>,
        document.body,
      )}
    </div>
  );
}

/** Ticket page: Stage and Pod as small pills, plus Resolve. */
export function TicketControls({ ticket, onChanged }: { ticket: string; onChanged: () => void }) {
  const [reload, setReload] = useState(0);
  const opts = useTicketOptions(ticket, reload);
  const [busy, setBusy] = useState(false);
  async function apply(change: { stage?: string; pod?: string | null; account?: { id: string; name: string }; part?: { id: string; name: string }; owner?: { id: string; name: string } }) {
    setBusy(true);
    const d = await updateTickets([ticket], change);
    setBusy(false);
    if (d?.updated) {
      setReload((n) => n + 1); onChanged();
      // Tell the Tickets table (still open behind the ticket sheet) so it updates / drops the row.
      const final = !!change.stage && !!opts?.stages.find((x) => x.name === change.stage)?.final;
      window.dispatchEvent(new CustomEvent<{ id: string; change: SavedChange }>("ticket-changed", {
        detail: { id: ticket, change: { ...(change.stage && { stage: change.stage, closed: final }), ...(change.pod !== undefined && { pod: change.pod }), ...(change.part && { part: change.part.name }), ...(change.owner && { owner: change.owner.name }) } },
      }));
    }
  }
  if (!opts) return <div className="flex gap-2"><div className="skeleton h-7 w-28 rounded-full" /><div className="skeleton h-7 w-28 rounded-full" /></div>;
  const canResolve = opts.stages.some((s) => s.name === "resolved");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <AccountPill current={opts.account} disabled={busy} onPick={(a) => apply({ account: a })} />
      <PillMenu label="Pod" value={opts.pod ?? "not set"} tone={opts.pod ? "accent" : "muted"} disabled={busy}
        items={[...opts.pods.filter((p) => p !== opts.pod).map((p) => ({ value: p, label: p })), ...(opts.pod ? [{ value: CLEAR_POD, label: "Clear Pod" }] : [])]}
        onPick={(v) => apply({ pod: v === CLEAR_POD ? null : v })} />
      <PartPill current={opts.part} parts={opts.parts} disabled={busy} onPick={(p) => apply({ part: p })} />
      <PillMenu label="Stage" value={stageLabel(opts.stage.name)} disabled={busy}
        items={opts.stages.filter((s) => s.name !== "resolved").map((s) => ({ value: s.name, label: stageLabel(s.name), hint: s.final ? "Closes the ticket" : undefined }))}
        onPick={(v) => apply({ stage: v })} />
      <OwnerPill current={opts.owner} disabled={busy} onPick={(u) => apply({ owner: u })} />
      {canResolve && (
        <button onClick={() => apply({ stage: "resolved" })} disabled={busy}
          className="inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium text-ok ring-1 ring-ok/40 transition hover:bg-ok hover:text-white disabled:opacity-50">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
          Resolve
        </button>
      )}
    </div>
  );
}

/** What changed on a ticket, so the inbox can update the row (or drop it, once closed) without waiting for DevRev. */
export interface SavedChange { stage?: string; closed?: boolean; pod?: string | null; part?: string; owner?: string }

/** DevRev users for "Assigned to" — loaded once per page. */
let usersPromise: Promise<{ users: { id: string; name: string; email?: string }[]; me: string | null }> | null = null;
function useDevrevUsers(active: boolean) {
  const [data, setData] = useState<Awaited<NonNullable<typeof usersPromise>> | null>(null);
  useEffect(() => {
    if (!active) return;
    usersPromise ??= fetch("/api/devrev-users").then((r) => (r.ok ? r.json() : { users: [], me: null })).catch(() => { usersPromise = null; return { users: [], me: null }; });
    let live = true;
    usersPromise.then((d) => { if (live) setData(d); });
    return () => { live = false; };
  }, [active]);
  return data;
}

/** Inbox: resolve the ticked tickets in one click — a pill floating at the bottom of the screen (fixed, z-100). */
export function BulkBar({ selected, onDone, onClear }: { selected: string[]; onDone: (resolved: string[]) => void; onClear: () => void }) {
  const [busy, setBusy] = useState(false);
  async function resolve() {
    setBusy(true);
    const d = await updateTickets(selected, { stage: "resolved" });
    setBusy(false);
    if (d?.updated) {
      const failed = new Set(d.failed.map((f) => f.ticket));
      onDone(selected.filter((t) => !failed.has(t)));
    }
  }
  return (
    <div className="chat-pop fixed bottom-6 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-4 rounded-full border border-line bg-panel py-2 pl-5 pr-2 shadow-xl">
      <span className="text-sm font-semibold"><span className="tabular-nums">{selected.length}</span> selected</span>
      <button onClick={onClear} disabled={busy} className="text-sm text-muted hover:text-fg">Clear</button>
      <button onClick={resolve} disabled={busy}
        className="flex items-center gap-1.5 rounded-full bg-ok px-4 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
        {busy ? "Resolving…" : `Resolve ${selected.length}`}
      </button>
    </div>
  );
}

/**
 * Inbox cell you can click to change the value (Stage, Pod or Part) — picks save straight to DevRev.
 * The menu is fixed-positioned so the table's scroll box doesn't clip it; options load when it opens.
 */
export function InlineEdit({ ticket, kind, current, children, onSaved }: {
  ticket: string; kind: "stage" | "pod" | "part" | "owner"; current?: string | null; children: React.ReactNode; onSaved: (s: SavedChange) => void;
}) {
  const [open, setOpen] = useState(false);
  const pres = usePresence(open); // opens and closes smoothly
  // Where the fixed menu goes: below the cell, or above it when there isn't room — and never past the screen edge.
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; listMax: number } | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const opts = useTicketOptions(open && kind !== "owner" ? ticket : null);
  const people = useDevrevUsers(open && kind === "owner");
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!panel.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false); };
    // Page scroll moves the cell away from the fixed menu, so close — but scrolling the menu's own list is fine.
    const close = (e: Event) => { if (!(e.target instanceof Node && panel.current?.contains(e.target))) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    window.addEventListener("scroll", close, true); window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc);
      window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close);
    };
  }, [open]);

  function toggle() {
    if (open) return setOpen(false);
    const r = btn.current!.getBoundingClientRect();
    const gap = 8, chrome = 90; // menu header + search box above the list
    const below = window.innerHeight - r.bottom - gap * 2, above = r.top - 64 - gap * 2; // 64 ≈ the sticky app header
    const up = below < 320 && above > below;
    const room = up ? above : below;
    setPos({
      left: Math.max(gap, Math.min(r.left, window.innerWidth - 256 - gap)),
      ...(up ? { bottom: window.innerHeight - r.top + 6 } : { top: r.bottom + 6 }),
      listMax: Math.max(120, Math.min(256, room - chrome)),
    });
    setQ(""); setOpen(true);
  }
  async function pick(change: { stage?: string; pod?: string | null; part?: string; owner?: string }, shown: SavedChange) {
    setBusy(true);
    const r = await fetch("/api/tickets/update", { method: "POST", body: JSON.stringify({ tickets: [ticket], ...change }) });
    const d = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    setBusy(false); setOpen(false);
    if (d.error || d.failed?.length) return notify({ title: `${ticket} not updated`, message: d.error || d.failed[0].error, tone: "error" });
    if (d.warnings?.length) notify({ title: "Check in DevRev", message: `${ticket}: ${d.warnings[0].warning}`, tone: "error" });
    notify({ message: shown.closed ? `${ticket} ${change.stage === "resolved" ? "resolved" : "closed"}` : kind === "owner" ? `${ticket} assigned to ${shown.owner}` : `${ticket}: ${kind} updated`, tone: "ok" });
    onSaved(shown);
  }

  const items: { key: string; label: string; hint?: string; on: () => void }[] = kind === "owner" ? (!people ? [] : [
      ...(people.me && people.users.find((u) => u.id === people.me)?.name !== current
        ? [{ key: "__me", label: "Assign to me", hint: people.users.find((u) => u.id === people.me)?.name, on: () => { const u = people.users.find((x) => x.id === people.me)!; pick({ owner: u.id }, { owner: u.name }); } }] : []),
      ...people.users.filter((u) => u.name !== current).map((u) => ({ key: u.id, label: u.name, hint: u.email, on: () => pick({ owner: u.id }, { owner: u.name }) })),
    ]) : !opts ? [] :
    kind === "stage" ? opts.stages.map((s) => ({ key: s.name, label: stageLabel(s.name), hint: s.final ? "Closes the ticket" : undefined, on: () => pick({ stage: s.name }, { stage: s.name, closed: s.final }) }))
    : kind === "pod" ? [...opts.pods.filter((p) => p !== opts.pod).map((p) => ({ key: p, label: p, on: () => pick({ pod: p }, { pod: p }) })),
        ...(opts.pod ? [{ key: CLEAR_POD, label: "Clear Pod", on: () => pick({ pod: null }, { pod: null }) }] : [])]
    : opts.parts.filter((p) => p.id !== opts.part?.id).map((p) => ({ key: p.id, label: p.name, hint: [p.product, p.type].filter(Boolean).join(" · "), on: () => pick({ part: p.id }, { part: p.name }) }));
  const needle = q.trim().toLowerCase();
  const matched = needle ? items.filter((i) => i.key !== "__me" && (i.label.toLowerCase().includes(needle) || i.hint?.toLowerCase().includes(needle))) : items;
  // Long lists (≈450 people, hundreds of parts): show the first matches; typing narrows it (also by product name).
  const shown = kind === "owner" || kind === "part" ? matched.slice(0, 80) : matched;

  return (
    <>
      <button ref={btn} type="button" onClick={toggle} disabled={busy} title={`Change ${kind}`}
        className={`group inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1 py-0.5 text-left -mx-1 hover:bg-accent-soft/70 ${open ? "bg-accent-soft/70" : ""} disabled:opacity-60`}>
        <span>{children}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className={`shrink-0 text-muted transition-opacity ${open ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`} aria-hidden><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {pres.show && pos && (
        <div ref={panel} style={{ left: pos.left, top: pos.top, bottom: pos.bottom }} className={`fixed z-50 w-64 overflow-hidden rounded-xl border border-line bg-panel text-sm shadow-xl ${pres.cls}`}>
          <div className="whitespace-normal break-words border-b border-line px-3 py-2 text-xs text-muted">
            {kind === "stage" ? "Move" : kind === "pod" ? "Set Pod for" : kind === "owner" ? "Assign" : "Move part of"} <b className="font-mono text-fg">{ticket}</b>{current ? <> · now <b className="text-fg">{kind === "stage" ? stageLabel(current) : current}</b></> : kind === "owner" ? " · now unassigned" : null}
          </div>
          {(items.length > 8 || kind === "owner") && (
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…"
              className="block w-full border-b border-line bg-bg px-3 py-2 text-sm outline-none" />
          )}
          <ul className="overflow-auto py-1" style={{ maxHeight: pos.listMax }}>
            {(kind === "owner" ? !people : !opts) && [0, 1, 2, 3].map((i) => <li key={i} className="px-3 py-1.5"><div className="skeleton h-4 w-full" /></li>)}
            {(kind === "owner" ? people : opts) && !shown.length && <li className="px-3 py-2 text-muted">{needle ? "No match" : "Nothing to change to"}</li>}
            {shown.map((it) => (
              <li key={it.key} onClick={busy ? undefined : it.on} className={`cursor-pointer px-3 py-1.5 hover:bg-accent-soft ${busy ? "opacity-50" : ""}`}>
                {it.label}{it.hint && <span className="block text-xs text-muted">{it.hint}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
