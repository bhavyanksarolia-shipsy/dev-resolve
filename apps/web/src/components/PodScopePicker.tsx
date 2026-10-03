"use client";
import { useEffect, useRef, useState } from "react";
import { setPodScope, usePodScope } from "./podScope";

/** Header: "My Pods" — what the dashboard and tickets show. Tickets with no Pod are always shown. */
export function PodScopePicker() {
  const scope = usePodScope();
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<string[] | null>(null);
  const [draft, setDraft] = useState<string[] | null>(null); // null = all Pods (every box ticked)
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || values) return;
    fetch("/api/me/pods").then((r) => (r.ok ? r.json() : null)).then((d) => setValues(d?.values ?? [])).catch(() => setValues([]));
  }, [open, values]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const label = !scope.length ? "All Pods" : scope.length === 1 ? scope[0] : `${scope.length} Pods`;
  const isOn = (v: string) => draft === null || draft.includes(v);
  const toggle = (v: string) => setDraft((d) => {
    const base = d ?? values ?? [];
    const next = base.includes(v) ? base.filter((x) => x !== v) : [...base, v];
    return values && next.length === values.length ? null : next;
  });
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => { setDraft(scope.length ? scope : null); setOpen((o) => !o); }} aria-haspopup="dialog" aria-expanded={open}
        title={scope.length ? `${scope.join(", ")} + tickets with no Pod` : "Showing every Pod"}
        className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 transition hover:ring-accent ${scope.length ? "bg-accent-soft text-accent-strong ring-emerald-200" : "bg-panel text-muted ring-line"}`}>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M3 5h18l-7 8v6l-4 2v-8Z" /></svg>
        <span className="max-w-40 truncate">{label}</span>
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden><path d={open ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} /></svg>
      </button>
      {open && (
        <div role="dialog" aria-label="My Pods" className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-xl border border-line bg-panel text-sm shadow-xl">
          <div className="border-b border-line px-3 py-2.5">
            <div className="font-semibold">My Pods</div>
            <p className="text-xs text-muted">Dashboard and tickets show only the ticked Pods. Tickets with <b>no Pod</b> are always shown, so new ones reach everyone.</p>
          </div>
          <ul className="max-h-72 overflow-auto py-1">
            {!values && [0, 1, 2, 3].map((i) => <li key={i} className="px-3 py-1.5"><div className="skeleton h-4 w-full" /></li>)}
            {values?.map((v) => (
              <li key={v}>
                <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 hover:bg-accent-soft">
                  <input type="checkbox" checked={isOn(v)} onChange={() => toggle(v)} className="h-4 w-4 accent-[var(--accent)]" />
                  <span className="flex-1 truncate">{v}</span>
                </label>
              </li>
            ))}
            <li className="flex items-center gap-2.5 px-3 py-1.5 text-muted" title="Always included">
              <input type="checkbox" checked disabled className="h-4 w-4 accent-[var(--accent)]" /><span className="flex-1 italic">No Pod (unassigned)</span><span className="text-[10px]">always</span>
            </li>
          </ul>
          <div className="flex items-center gap-2 border-t border-line px-3 py-2">
            <button type="button" onClick={() => setDraft(null)} className="text-xs text-accent-strong hover:underline">Select all</button>
            <button type="button" onClick={() => setDraft([])} className="text-xs text-muted hover:text-fg">Clear</button>
            <button type="button" onClick={() => setOpen(false)} className="ml-auto rounded-lg border border-line px-3 py-1 font-medium hover:border-accent">Cancel</button>
            <button type="button" disabled={draft !== null && !draft.length} title={draft !== null && !draft.length ? "Tick at least one Pod" : undefined}
              onClick={() => { setPodScope(draft ?? []); setOpen(false); }} className="rounded-lg bg-accent px-3 py-1 font-medium text-white hover:bg-accent-strong disabled:opacity-50">Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}
