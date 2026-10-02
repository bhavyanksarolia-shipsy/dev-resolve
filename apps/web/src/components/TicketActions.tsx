"use client";
import { useEffect, useRef, useState } from "react";
import { Select } from "./admin/ui";
import { confirmDialog, notify } from "./Dialog";

export interface StageOption { id: string; name: string; final: boolean }
interface Options {
  stage: { id: string | null; name: string | null }; pod: string | null; stages: StageOption[]; pods: string[];
  part: { id: string; name: string } | null; parts: { id: string; name: string }[];
}
interface UpdateResult { ok: boolean; updated: number; failed: { ticket: string; error?: string }[]; error?: string }

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
export async function updateTickets(tickets: string[], change: { stage?: string; pod?: string | null }) {
  const what = [change.stage && `stage → ${stageLabel(change.stage)}`, change.pod !== undefined && `Pod → ${change.pod ?? "none"}`].filter(Boolean).join(" and ");
  const many = tickets.length > 1;
  // Resolve is one click (empty resolve fields get the defaults on the server); other changes are confirmed first.
  const ok = change.stage === "resolved" || await confirmDialog({
    title: many ? `Update ${tickets.length} tickets in DevRev?` : `Update ${tickets[0]} in DevRev?`,
    message: `Set ${what}${many ? ` on: ${tickets.slice(0, 12).join(", ")}${tickets.length > 12 ? ` and ${tickets.length - 12} more` : ""}` : ""}. This changes the ticket${many ? "s" : ""} in DevRev for everyone.` ,
    confirmLabel: change.stage === "resolved" ? (many ? `Resolve ${tickets.length} tickets` : "Mark resolved") : "Update",
  });
  if (!ok) return null;
  const r = await fetch("/api/tickets/update", { method: "POST", body: JSON.stringify({ tickets, ...change }) });
  const d: UpdateResult = await r.json().catch(() => ({ ok: false, updated: 0, failed: [], error: `HTTP ${r.status}` }));
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
      {open && (
        <ul role="menu" className="absolute left-0 z-40 mt-1.5 max-h-72 min-w-[13rem] overflow-auto rounded-xl border border-line bg-panel py-1 text-sm shadow-lg">
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

/** Ticket page: Stage and Pod as small pills, plus Resolve. */
export function TicketControls({ ticket, onChanged }: { ticket: string; onChanged: () => void }) {
  const [reload, setReload] = useState(0);
  const opts = useTicketOptions(ticket, reload);
  const [busy, setBusy] = useState(false);
  async function apply(change: { stage?: string; pod?: string | null }) {
    setBusy(true);
    const d = await updateTickets([ticket], change);
    setBusy(false);
    if (d?.updated) { setReload((n) => n + 1); onChanged(); }
  }
  if (!opts) return <div className="flex gap-2"><div className="skeleton h-7 w-28 rounded-full" /><div className="skeleton h-7 w-28 rounded-full" /></div>;
  const canResolve = opts.stages.some((s) => s.name === "resolved");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <PillMenu label="Stage" value={stageLabel(opts.stage.name)} disabled={busy}
        items={opts.stages.filter((s) => s.name !== "resolved").map((s) => ({ value: s.name, label: stageLabel(s.name), hint: s.final ? "Closes the ticket" : undefined }))}
        onPick={(v) => apply({ stage: v })} />
      <PillMenu label="Pod" value={opts.pod ?? "not set"} tone={opts.pod ? "accent" : "muted"} disabled={busy}
        items={[...opts.pods.filter((p) => p !== opts.pod).map((p) => ({ value: p, label: p })), ...(opts.pod ? [{ value: CLEAR_POD, label: "Clear Pod" }] : [])]}
        onPick={(v) => apply({ pod: v === CLEAR_POD ? null : v })} />
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

/** Inbox: resolve the ticked tickets in one click (sticky at the bottom of the screen). */
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
    <div className="sticky bottom-4 z-30 mx-auto mt-4 flex w-fit items-center gap-4 rounded-full border border-line bg-panel py-2 pl-5 pr-2 shadow-xl">
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

/** Inbox row action: change Stage, Pod and Part of one ticket together. */
export function EditTicketDialog({ ticket, onClose, onSaved }: { ticket: string; onClose: () => void; onSaved: () => void }) {
  const opts = useTicketOptions(ticket);
  const [stage, setStage] = useState("");
  const [pod, setPod] = useState<string | null>(null);
  const [part, setPart] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [busy, onClose]);

  const podNow = pod ?? opts?.pod ?? "";
  const partNow = part || opts?.part?.id || "";
  const change = opts && {
    ...(stage && stage !== opts.stage.name && { stage }),
    ...(podNow !== (opts.pod ?? "") && { pod: podNow === CLEAR_POD || !podNow ? null : podNow }),
    ...(partNow && partNow !== opts.part?.id && { part: partNow }),
  };
  const changed = !!change && Object.keys(change).length > 0;

  async function save() {
    if (!change || !changed) return;
    setBusy(true);
    const r = await fetch("/api/tickets/update", { method: "POST", body: JSON.stringify({ tickets: [ticket], ...change }) });
    const d = await r.json().catch(() => ({ error: `HTTP ${r.status}` }));
    setBusy(false);
    if (d.error || d.failed?.length) return notify({ title: `${ticket} not updated`, message: d.error || d.failed[0].error, tone: "error" });
    notify({ message: `${ticket} updated in DevRev`, tone: "ok" });
    onSaved();
  }

  const partOptions = (opts?.parts ?? []).map((p) => ({ value: p.id, label: p.name }));
  if (opts?.part && !partOptions.some((p) => p.value === opts.part!.id)) partOptions.unshift({ value: opts.part.id, label: `${opts.part.name} (current, not under WMS)` });
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/30 p-4 backdrop-blur-sm" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={`Edit ${ticket}`} className="w-full max-w-md rounded-2xl bg-panel shadow-2xl">
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <h2 className="font-semibold">Edit <span className="font-mono text-accent-strong">{ticket}</span></h2>
          <button onClick={onClose} disabled={busy} aria-label="Close" className="ml-auto rounded-md px-2 text-lg text-muted hover:text-fg">✕</button>
        </div>
        <div className="space-y-4 px-5 py-5 text-sm">
          {!opts ? [0, 1, 2].map((i) => <div key={i} className="skeleton h-10 w-full rounded-lg" />) : (
            <>
              <label className="block"><span className="mb-1 block font-medium">Stage</span>
                <Select value={stage || opts.stage.name || ""} onChange={setStage}
                  options={[{ value: opts.stage.name || "", label: `${stageLabel(opts.stage.name)} (current)` },
                    ...opts.stages.map((s) => ({ value: s.name, label: stageLabel(s.name), hint: s.final ? "Closes the ticket" : undefined }))]} />
              </label>
              <label className="block"><span className="mb-1 block font-medium">Pod</span>
                <Select value={podNow} onChange={setPod} placeholder="Not set"
                  options={[...opts.pods.map((p) => ({ value: p, label: p })), ...(opts.pod ? [{ value: CLEAR_POD, label: "Clear Pod" }] : [])]} />
              </label>
              <label className="block"><span className="mb-1 block font-medium">Part</span>
                <Select value={partNow} onChange={setPart} placeholder="Choose a part" options={partOptions} />
              </label>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-line bg-bg/50 px-5 py-3">
          <button onClick={onClose} disabled={busy} className="rounded-lg border border-line px-4 py-2 text-sm font-medium hover:border-accent">Cancel</button>
          <button onClick={save} disabled={!changed || busy} className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-strong disabled:opacity-50">
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
