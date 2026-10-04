"use client";
import { ReactNode, useEffect, useId, useRef, useState } from "react";

/** Small shared pieces for the admin screens. */
export const btn = "rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:border-accent disabled:opacity-40";
export const btnPrimary = "rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-strong disabled:opacity-40";
export const input = "w-full rounded-md border border-line bg-panel px-2 py-1.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft";

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
    <button type="button" role="switch" aria-checked={on} disabled={disabled} title={title} onClick={() => onChange(!on)} className="inline-flex items-center gap-2 text-left text-sm disabled:opacity-60">
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

/** Dropdown in the app's style (replaces the browser's <select>): keyboard, click-outside, checkmark, optional hint line; a search box once the list is long. */
export function Select({ value, onChange, options, placeholder = "Choose…", disabled, up }: {
  value: string; onChange: (v: string) => void; options: Option[]; placeholder?: string; disabled?: boolean; up?: boolean; // up: list opens above
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  const current = options.find((o) => o.value === value);
  const searchable = options.length > 6;
  const needle = q.trim().toLowerCase();
  const list = needle ? options.filter((o) => `${o.label} ${o.hint ?? ""}`.toLowerCase().includes(needle)) : options;

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const show = () => { setQ(""); setActive(Math.max(0, options.findIndex((o) => o.value === value))); setOpen(true); };
  const pick = (o: Option) => { onChange(o.value); setOpen(false); };
  const onKey = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (!open && ["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) { e.preventDefault(); show(); return; }
    if (!open) return;
    const typing = (e.target as HTMLElement).tagName === "INPUT";
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setOpen(false); }
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(list.length - 1, i + 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    if (e.key === "Enter" || (e.key === " " && !typing)) { e.preventDefault(); if (list[active]) pick(list[active]); }
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
        <div className={`absolute left-0 right-0 z-50 ${up ? "bottom-full mb-1" : "mt-1"} overflow-hidden rounded-md border border-line bg-panel shadow-lg`}>
        {searchable && (
          <div className="border-b border-line p-2">
            <input autoFocus className={input} value={q} placeholder="Search…" onChange={(e) => { setQ(e.target.value); setActive(0); }} />
          </div>
        )}
        <ul id={id} role="listbox" className="max-h-64 overflow-auto py-1">
          {list.length === 0 && <li className="px-3 py-2 text-sm text-muted">{options.length ? "No matches" : "Nothing to choose yet"}</li>}
          {list.map((o, i) => {
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
        </div>
      )}
    </div>
  );
}

export interface MultiOption { value: string; label: string; hint?: string; mono?: boolean }
/**
 * Multi-select dropdown in the app's style: chips in the button; the panel has a search box on top and checkboxes.
 * Static options are filtered locally; pass `search` to look options up as you type (e.g. DevRev accounts).
 */
export function MultiSelect({ value, onChange, options, search, placeholder = "Choose…", searchPlaceholder = "Search…", emptyText = "Nothing to choose" }: {
  value: MultiOption[]; onChange: (v: MultiOption[]) => void; options?: MultiOption[];
  search?: (q: string) => Promise<MultiOption[]>; placeholder?: string; searchPlaceholder?: string; emptyText?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<MultiOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); setOpen(false); } };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  useEffect(() => {
    if (!search || q.trim().length < 2) return;
    let live = true;
    const t = setTimeout(() => { setLoading(true); search(q.trim()).then((r) => live && setFound(r)).finally(() => live && setLoading(false)); }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [q, search]);
  const needle = q.trim().toLowerCase();
  const picked = new Set(value.map((v) => v.value));
  const pool = search ? (needle.length >= 2 ? found ?? [] : []) : (options ?? []).filter((o) => !needle || o.label.toLowerCase().includes(needle));
  // Chosen ones first (always visible), then the rest of the matches.
  const rows = [...value.filter((v) => !needle || v.label.toLowerCase().includes(needle)), ...pool.filter((o) => !picked.has(o.value))];
  const toggle = (o: MultiOption) => onChange(picked.has(o.value) ? value.filter((v) => v.value !== o.value) : [...value, o]);
  return (
    <div ref={box} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}
        className={`${input} flex min-h-10 flex-wrap items-center gap-1.5 text-left ${open ? "border-accent ring-2 ring-accent-soft" : ""}`}>
        {value.length ? value.map((v) => (
          <span key={v.value} className={`rounded bg-accent-soft px-1.5 py-0.5 text-xs font-medium text-accent-strong ${v.mono ? "font-mono" : ""}`}>{v.label}</span>
        )) : <span className="text-muted">{placeholder}</span>}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="ml-auto shrink-0 text-muted" aria-hidden><path d={open ? "m6 15 6-6 6 6" : "m6 9 6 6 6-6"} /></svg>
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-md border border-line bg-panel text-sm shadow-lg">
          <div className="border-b border-line p-2">
            <input autoFocus className={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} />
          </div>
          <ul role="listbox" aria-multiselectable="true" className="max-h-64 overflow-auto py-1">
            {rows.map((o) => (
              <li key={o.value}>
                <label className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 hover:bg-accent-soft">
                  <input type="checkbox" checked={picked.has(o.value)} onChange={() => toggle(o)} className="h-4 w-4 shrink-0 accent-[var(--accent)]" />
                  <span className={`min-w-0 flex-1 truncate ${o.mono ? "font-mono text-xs" : ""}`}>{o.label}</span>
                  {o.hint && <span className="shrink-0 text-xs text-warn">{o.hint}</span>}
                </label>
              </li>
            ))}
            {loading && <li className="px-3 py-2 text-xs text-muted">Searching…</li>}
            {!loading && !rows.length && (
              <li className="px-3 py-2 text-xs text-muted">{search && needle.length < 2 ? "Type at least 2 letters to search" : needle ? `Nothing matches “${q}”` : emptyText}</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
