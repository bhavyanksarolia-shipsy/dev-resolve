"use client";
import { useEffect, useRef, useState } from "react";

/** Multi-select Pod filter (none ticked = all Pods). Values are Pod names; "-" = not set. */
export function PodPicker({ value, choices, onChange, allLabel = "All Pods" }: { value: string[] | null; choices: { value: string; count: number }[]; onChange: (v: string[] | null) => void; allLabel?: string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<string[] | null>(null); // null = all (every box ticked)
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const name = (v: string) => (v === "-" ? "Not set" : v);
  const label = !value?.length ? allLabel : value.length === 1 ? name(value[0]) : `${value.length} Pods`;
  const items = choices.map((c) => ({ v: c.value || "-", label: c.value || "Not set", count: c.count }));
  const isOn = (v: string) => draft === null || draft.includes(v);
  const toggle = (v: string) => setDraft((d) => {
    const base = d ?? items.map((i) => i.v);
    const next = base.includes(v) ? base.filter((x) => x !== v) : [...base, v];
    return next.length === items.length ? null : next;
  });
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => { setDraft(value?.length ? value : null); setOpen((o) => !o); }} aria-haspopup="listbox" aria-expanded={open}
        title={value?.length ? value.map(name).join(", ") : undefined}
        className={`flex items-center gap-2 rounded-lg border bg-panel px-3 py-2 text-sm shadow-sm transition hover:border-accent ${open ? "border-accent ring-2 ring-accent-soft" : value?.length ? "border-accent" : "border-line"}`}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted" aria-hidden><path d="M3 5h18l-7 8v6l-4 2v-8Z" /></svg>
        <span className={`max-w-48 truncate font-medium ${value?.length ? "text-accent-strong" : ""}`}>{label}</span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className="text-muted" aria-hidden><path d={open ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} /></svg>
      </button>
      {open && (
        <div className="absolute left-0 z-40 mt-1.5 w-64 overflow-hidden rounded-xl border border-line bg-panel text-sm shadow-xl">
          <div className="flex items-center justify-between border-b border-line px-3 py-2 text-xs">
            <span className="text-muted">{draft === null ? allLabel : `${draft.length} selected`}</span>
            <span className="flex gap-3">
              <button type="button" className="text-accent-strong hover:underline" onClick={() => setDraft(null)}>Select all</button>
              <button type="button" className="text-accent-strong hover:underline" onClick={() => setDraft([])}>Clear</button>
            </span>
          </div>
          <ul role="listbox" aria-multiselectable="true" className="max-h-72 overflow-auto py-1">
            {!items.length && <li className="px-3 py-2 text-muted">Loading…</li>}
            {items.map((it) => (
              <li key={it.v}>
                <label className={`flex cursor-pointer items-center gap-2.5 px-3 py-1.5 hover:bg-accent-soft ${it.v === "-" ? "text-muted" : ""}`}>
                  <input type="checkbox" checked={isOn(it.v)} onChange={() => toggle(it.v)} className="h-4 w-4 accent-[var(--accent)]" />
                  <span className="flex-1 truncate">{it.label}</span>
                  <span className="text-xs tabular-nums text-muted">{it.count}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2 border-t border-line px-3 py-2">
            <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-line px-3 py-1 font-medium hover:border-accent">Cancel</button>
            <button type="button" disabled={draft !== null && !draft.length} title={draft !== null && !draft.length ? "Tick at least one Pod" : undefined}
              onClick={() => { onChange(draft && draft.length ? draft : null); setOpen(false); }}
              className="rounded-lg bg-accent px-3 py-1 font-medium text-white hover:bg-accent-strong disabled:opacity-50">Apply</button>
          </div>
        </div>
      )}
    </div>
  );
}
