"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Column header menu: sort A→Z / Z→A, filter by typing, and pick values (with counts). Rendered as a fixed-position
 * panel so the table's horizontal scroll container doesn't clip it.
 */
export function ColumnMenu({ label, values, selected, text, sort, onSort, onSelected, onText, onClear, format = (v) => v }: {
  label: string; values: { value: string; count: number }[]; selected: string[] | null; text: string; sort: "asc" | "desc" | null;
  onSort: (d: "asc" | "desc" | null) => void; onSelected: (v: string[] | null) => void; onText: (v: string) => void;
  /** Clears this column's sort, typed filter and ticked values in one go. */
  onClear: () => void;
  /** How a raw value is shown (e.g. "awaiting_development" → "awaiting development"). */
  format?: (v: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [draft, setDraft] = useState(text);
  const btn = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const active = !!(selected || text || sort);

  useLayoutEffect(() => {
    if (!open || !btn.current) return;
    const r = btn.current.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - 280) });
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!panel.current?.contains(e.target as Node) && !btn.current?.contains(e.target as Node)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const move = () => setOpen(false);
    document.addEventListener("mousedown", away); document.addEventListener("keydown", key); window.addEventListener("scroll", move, true);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", key); window.removeEventListener("scroll", move, true); };
  }, [open]);
  // Typing filters as you go (short pause), without a URL update per keystroke.
  useEffect(() => { if (!open) return; const t = setTimeout(() => draft !== text && onText(draft), 250); return () => clearTimeout(t); }, [draft, open, text, onText]);

  const shown = values.filter((v) => !draft || (v.value ? format(v.value) : "not set").toLowerCase().includes(draft.toLowerCase()));
  const isOn = (v: string) => !selected || selected.includes(v);
  const toggle = (v: string) => {
    const base = selected ?? values.map((x) => x.value);
    const next = base.includes(v) ? base.filter((x) => x !== v) : [...base, v];
    onSelected(next.length === values.length ? null : next);
  };
  const sortBtn = (d: "asc" | "desc", l: string) => (
    <button type="button" onClick={() => { onSort(sort === d ? null : d); setOpen(false); }}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm ${sort === d ? "bg-accent-soft font-medium text-accent-strong" : "hover:bg-bg"}`}>
      <span className="w-4 text-center">{d === "asc" ? "↑" : "↓"}</span>{l}{sort === d && <span className="ml-auto text-xs">✓</span>}
    </button>
  );

  return (
    <>
      <button ref={btn} type="button" onClick={() => { setDraft(text); setOpen((o) => !o); }} aria-haspopup="dialog" aria-expanded={open}
        className={`inline-flex items-center gap-1 rounded-md px-1 py-0.5 uppercase tracking-wide hover:bg-white/60 ${active ? "text-accent-strong" : ""}`}>
        {label}
        {sort && <span aria-label={sort === "asc" ? "sorted ascending" : "sorted descending"}>{sort === "asc" ? "↑" : "↓"}</span>}
        <svg width="12" height="12" viewBox="0 0 24 24" fill={selected || text ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" aria-hidden><path d="M3 5h18l-7 8v6l-4 2v-8z" /></svg>
      </button>
      {open && pos && (
        <div ref={panel} role="dialog" aria-label={`${label} sort and filter`} style={{ top: pos.top, left: pos.left }}
          className="fixed z-50 w-64 rounded-xl border border-line bg-panel p-2 text-sm font-normal normal-case tracking-normal text-fg shadow-xl">
          {sortBtn("asc", "Sort ascending (A → Z)")}
          {sortBtn("desc", "Sort descending (Z → A)")}
          <div className="my-2 border-t border-line" />
          <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={`Type to filter ${label.toLowerCase()}…`}
            className="w-full rounded-md border border-line bg-bg px-2 py-1.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft" />
          <div className="mt-2 flex justify-between px-1 text-xs">
            <button type="button" className="text-accent-strong hover:underline" onClick={() => onSelected(null)}>Select all</button>
            <button type="button" className="text-muted hover:text-fg" onClick={() => { setDraft(""); onClear(); }}>Clear</button>
          </div>
          <ul className="mt-1 max-h-56 overflow-auto">
            {shown.map((v) => (
              <li key={v.value || "_none"}>
                <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-bg">
                  <input type="checkbox" checked={isOn(v.value)} onChange={() => toggle(v.value)} className="accent-[var(--accent)]" />
                  <span className={`flex-1 truncate ${v.value ? "" : "italic text-muted"}`}>{v.value ? format(v.value) : "not set"}</span>
                  <span className={`text-xs tabular-nums ${v.count ? "text-muted" : "text-line"}`}>{v.count}</span>
                </label>
              </li>
            ))}
            {!shown.length && <li className="px-2 py-2 text-xs text-muted">No values match “{draft}”</li>}
          </ul>
        </div>
      )}
    </>
  );
}

/** "Showing 26–50 of 52" + page buttons — used above and below the table. */
export function Pager({ where, from, to, total, all, page, pages, onPage, disabled }: {
  where: "top" | "bottom"; from: number; to: number; total: number; all: number; page: number; pages: number; onPage: (n: number) => void; disabled?: boolean;
}) {
  const nums: (number | "…")[] = [];
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 1) nums.push(i);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }
  const go = (n: number) => { onPage(n); if (where === "bottom") window.scrollTo({ top: 0, behavior: "smooth" }); };
  const b = "min-w-8 rounded-lg border px-2.5 py-1.5 text-sm disabled:opacity-40";
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-xs text-muted">{total ? `Showing ${from}–${to} of ${total}` : "No tickets"}{total !== all ? ` (filtered from ${all})` : ""}</span>
      {pages > 1 && (
        <div className="ml-auto flex items-center gap-1">
          <button className={`${b} border-line bg-panel hover:border-accent`} disabled={disabled || page <= 1} onClick={() => go(page - 1)}>← Prev</button>
          {nums.map((n, i) => n === "…"
            ? <span key={`e${i}`} className="px-1 text-muted">…</span>
            : <button key={n} className={`${b} ${n === page ? "border-accent bg-accent text-white" : "border-line bg-panel hover:border-accent"}`} disabled={disabled} onClick={() => go(n)} aria-current={n === page ? "page" : undefined}>{n}</button>)}
          <button className={`${b} border-line bg-panel hover:border-accent`} disabled={disabled || page >= pages} onClick={() => go(page + 1)}>Next →</button>
        </div>
      )}
    </div>
  );
}
