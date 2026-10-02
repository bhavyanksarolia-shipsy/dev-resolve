"use client";
import { ReactNode, useEffect, useId, useRef, useState } from "react";

/** Small shared pieces for the admin screens. */
export const btn = "rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:border-accent disabled:opacity-40";
export const btnPrimary = "rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-strong disabled:opacity-40";
export const input = "w-full rounded-md border border-line bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft";

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <div className="mb-1 font-medium">{label}</div>
      {children}
      {hint && <div className="mt-1 text-xs text-muted">{hint}</div>}
    </label>
  );
}

export function Switch({ on, onChange, label, disabled, title }: { on: boolean; onChange: (v: boolean) => void; label: ReactNode; disabled?: boolean; title?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} disabled={disabled} title={title} onClick={() => onChange(!on)} className="inline-flex items-center gap-2 text-sm disabled:opacity-60">
      <span className={`relative inline-block h-5 w-9 shrink-0 rounded-full transition-colors ${on ? "bg-accent" : "bg-line"}`}>
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${on ? "left-[18px]" : "left-0.5"}`} />
      </span>
      <span>{label}</span>
    </button>
  );
}

export function Note({ ok, children }: { ok: boolean; children: ReactNode }) {
  return <div className={`rounded-md px-3 py-2 text-xs ring-1 ${ok ? "bg-emerald-50 text-ok ring-emerald-200" : "bg-red-50 text-bad ring-red-200"}`}>{children}</div>;
}

export async function post<T = { ok?: boolean; message?: string; error?: string }>(url: string, body: unknown): Promise<T & { error?: string }> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  return r.ok ? d : { ...d, error: d.error || `HTTP ${r.status}` };
}

/** Editable key → value rows (log types → index patterns, database ids → labels). */
export function Rows({ rows, onChange, keyLabel, valueLabel, keyPlaceholder, valuePlaceholder }: {
  rows: [string, string][]; onChange: (r: [string, string][]) => void; keyLabel: string; valueLabel: string; keyPlaceholder?: string; valuePlaceholder?: string;
}) {
  const set = (i: number, j: 0 | 1, v: string) => onChange(rows.map((r, k) => (k === i ? (j === 0 ? [v, r[1]] : [r[0], v]) : r)));
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-[1fr_2fr_auto] gap-2 text-xs text-muted"><span>{keyLabel}</span><span>{valueLabel}</span><span /></div>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-[1fr_2fr_auto] gap-2">
          <input className={input} value={r[0]} placeholder={keyPlaceholder} onChange={(e) => set(i, 0, e.target.value)} />
          <input className={input} value={r[1]} placeholder={valuePlaceholder} onChange={(e) => set(i, 1, e.target.value)} />
          <button type="button" className="px-2 text-muted hover:text-bad" onClick={() => onChange(rows.filter((_, k) => k !== i))} aria-label="Remove">✕</button>
        </div>
      ))}
      <button type="button" className="text-xs text-accent-strong hover:underline" onClick={() => onChange([...rows, ["", ""]])}>+ Add row</button>
    </div>
  );
}

export interface Option { value: string; label: string; hint?: string }

/** Dropdown in the app's style (replaces the browser's <select>): keyboard, click-outside, checkmark, optional hint line. */
export function Select({ value, onChange, options, placeholder = "Choose…", disabled, up }: {
  value: string; onChange: (v: string) => void; options: Option[]; placeholder?: string; disabled?: boolean; up?: boolean; // up: list opens above
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const show = () => { setActive(Math.max(0, options.findIndex((o) => o.value === value))); setOpen(true); };
  const pick = (o: Option) => { onChange(o.value); setOpen(false); };
  const onKey = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open && ["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); show(); return; }
    if (!open) return;
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(options.length - 1, i + 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); if (options[active]) pick(options[active]); }
    if (e.key === "Tab") setOpen(false);
  };

  return (
    <div ref={box} className="relative" onKeyDown={onKey}>
      <button type="button" disabled={disabled} aria-haspopup="listbox" aria-expanded={open} aria-controls={id}
        onClick={(e) => { e.preventDefault(); if (open) setOpen(false); else show(); }}
        className={`${input} flex items-center gap-2 text-left disabled:opacity-50 ${open ? "border-accent ring-2 ring-accent-soft" : ""}`}>
        <span className={`min-w-0 flex-1 truncate ${current ? "" : "text-muted"}`}>{current?.label ?? placeholder}</span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted" aria-hidden>
          <path d={open ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} />
        </svg>
      </button>
      {open && (
        <ul id={id} role="listbox" className={`absolute left-0 right-0 z-50 max-h-64 ${up ? "bottom-full mb-1" : "mt-1"} overflow-auto rounded-lg border border-line bg-panel py-1 shadow-lg`}>
          {options.length === 0 && <li className="px-3 py-2 text-sm text-muted">Nothing to choose yet</li>}
          {options.map((o, i) => {
            const sel = o.value === value;
            return (
              <li key={o.value} role="option" aria-selected={sel} onMouseEnter={() => setActive(i)} onMouseDown={(e) => { e.preventDefault(); pick(o); }}
                className={`flex cursor-pointer items-start gap-2 px-3 py-2 text-sm ${i === active ? "bg-accent-soft" : ""}`}>
                <span className={`mt-0.5 w-4 shrink-0 text-accent-strong ${sel ? "" : "invisible"}`}>✓</span>
                <span className="min-w-0"><span className={`block truncate ${sel ? "font-medium text-accent-strong" : ""}`}>{o.label}</span>
                  {o.hint && <span className="block text-xs text-muted">{o.hint}</span>}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
