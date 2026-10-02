"use client";
import { useEffect, useState } from "react";
import { Select } from "./admin/ui";
import { confirmDialog, notify } from "./Dialog";

export interface StageOption { id: string; name: string; final: boolean }
interface Options { stage: { id: string | null; name: string | null }; pod: string | null; stages: StageOption[]; pods: string[] }
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
  const ok = await confirmDialog({
    title: many ? `Update ${tickets.length} tickets in DevRev?` : `Update ${tickets[0]} in DevRev?`,
    message: `Set ${what}${many ? ` on: ${tickets.slice(0, 12).join(", ")}${tickets.length > 12 ? ` and ${tickets.length - 12} more` : ""}` : ""}. This changes the ticket${many ? "s" : ""} in DevRev for everyone.`,
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
  else notify({ message: many ? `${d.updated} tickets updated in DevRev` : `${tickets[0]} updated in DevRev`, tone: "ok" });
  return d;
}

/** Ticket page: Stage and Pod pickers plus "Mark resolved". */
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
  if (!opts) return <div className="skeleton h-9 w-full max-w-md rounded-lg" />;
  const canResolve = opts.stages.some((s) => s.name === "resolved");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="w-56">
        <Select value="" disabled={busy} placeholder={`Stage: ${stageLabel(opts.stage.name)}`}
          options={opts.stages.map((s) => ({ value: s.name, label: `Move to ${stageLabel(s.name)}`, hint: s.final ? "Closes the ticket" : undefined }))}
          onChange={(v) => apply({ stage: v })} />
      </div>
      <div className="w-48">
        <Select value="" disabled={busy} placeholder={`Pod: ${opts.pod ?? "not set"}`}
          options={[...opts.pods.filter((p) => p !== opts.pod).map((p) => ({ value: p, label: p })), ...(opts.pod ? [{ value: CLEAR_POD, label: "Clear Pod" }] : [])]}
          onChange={(v) => apply({ pod: v === CLEAR_POD ? null : v })} />
      </div>
      {canResolve && (
        <button onClick={() => apply({ stage: "resolved" })} disabled={busy}
          className="flex items-center gap-1.5 rounded-md bg-ok px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
          Mark resolved
        </button>
      )}
    </div>
  );
}

/** Inbox: actions for the selected tickets (sticky at the bottom of the screen). */
export function BulkBar({ selected, onDone, onClear }: { selected: string[]; onDone: (resolved: string[]) => void; onClear: () => void }) {
  const opts = useTicketOptions(selected[0] ?? null);
  const [busy, setBusy] = useState(false);
  async function apply(change: { stage?: string; pod?: string | null }) {
    setBusy(true);
    const d = await updateTickets(selected, change);
    setBusy(false);
    if (d?.updated) {
      const failed = new Set(d.failed.map((f) => f.ticket));
      onDone(selected.filter((t) => !failed.has(t)));
    }
  }
  // Moves offered for the first selected ticket; DevRev checks each ticket's own allowed moves and the result says which failed.
  const stages = (opts?.stages ?? []).filter((s) => s.name !== "resolved");
  return (
    <div className="sticky bottom-4 z-30 mx-auto mt-4 flex w-fit max-w-full flex-wrap items-center gap-3 rounded-2xl border border-line bg-panel px-4 py-3 shadow-xl">
      <span className="text-sm font-semibold"><span className="tabular-nums">{selected.length}</span> selected</span>
      <div className="w-52">
        <Select up value="" disabled={busy || !opts} placeholder="Change stage…"
          options={stages.map((s) => ({ value: s.name, label: stageLabel(s.name), hint: s.final ? "Closes the tickets" : undefined }))}
          onChange={(v) => apply({ stage: v })} />
      </div>
      <div className="w-44">
        <Select up value="" disabled={busy || !opts} placeholder="Set Pod…"
          options={[...(opts?.pods ?? []).map((p) => ({ value: p, label: p })), { value: CLEAR_POD, label: "Clear Pod" }]}
          onChange={(v) => apply({ pod: v === CLEAR_POD ? null : v })} />
      </div>
      <button onClick={() => apply({ stage: "resolved" })} disabled={busy}
        className="flex items-center gap-1.5 rounded-md bg-ok px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
        {busy ? "Updating…" : `Mark ${selected.length} resolved`}
      </button>
      <button onClick={onClear} disabled={busy} className="text-sm text-muted hover:text-fg">Clear</button>
    </div>
  );
}
