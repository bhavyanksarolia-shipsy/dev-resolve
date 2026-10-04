"use client";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Select } from "./admin/ui";

/**
 * Column header menu: sort A→Z / Z→A, filter by typing, and pick values (with counts). Rendered as a fixed-position
 * panel so the table's horizontal scroll container doesn't clip it.
 */
export function ColumnMenu({ label, values, selected, text, sort, onSort, onSelected, onText, onClear, format = (v) => v }: {
  label: string; values: { value: string; count: number }[]; selected: string[] | null; text: string; sort: "asc" | "desc" | null;
  onSort: (d: "asc" | "desc" | null) => void; onSelected: (v: string[] | null) => void; onText: (v: string) => void;
  /** Clears this column's sort and typed filter and unticks every value, in one go. */
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
    // Page scroll closes the menu (it would drift off its column); scrolling the menu's own list doesn't.
    const move = (e: Event) => { if (!(e.target instanceof Node && panel.current?.contains(e.target))) setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", key); window.addEventListener("scroll", move, true);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", key); window.removeEventListener("scroll", move, true); };
  }, [open]);
  // Typing filters as you go (short pause), without a URL update per keystroke.
  useEffect(() => { if (!open) return; const t = setTimeout(() => draft !== text && onText(draft), 250); return () => clearTimeout(t); }, [draft, open, text, onText]);

  const shown = values.filter((v) => !draft || (v.value ? format(v.value) : "not set").toLowerCase().includes(draft.toLowerCase()));
  // selected: null = every value ticked (no filter) · [] = nothing ticked (no rows) · list = only those values.
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
        className={`-mx-1 inline-flex items-center gap-1 whitespace-nowrap rounded-md px-1 py-0.5 uppercase tracking-wide hover:bg-white/60 ${active ? "text-accent-strong" : ""}`}>
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
                  <span title={v.value ? format(v.value) : "not set"} className={`flex-1 break-words [overflow-wrap:anywhere] ${v.value ? "" : "italic text-muted"}`}>{v.value ? format(v.value) : "not set"}</span>
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

/** Footer pager, right-aligned and small: "Rows 25 ▾ · 51–75 of 129 · ‹ ›". */
export function Pager({ where, from, to, total, all, page, pages, onPage, disabled, size, onSize, noun = "tickets" }: {
  where: "top" | "bottom"; from: number; to: number; total: number; all: number; page: number; pages: number; onPage: (n: number) => void; disabled?: boolean;
  size?: number; onSize?: (n: number) => void; noun?: string;
}) {
  const go = (n: number, from: HTMLElement) => {
    onPage(n);
    if (where !== "bottom") return;
    // Back to the top of this table (its own scroll box when it has one, else the page).
    const box = from.closest("section")?.querySelector("[data-scroll-table]");
    if (box) box.scrollTo({ top: 0, behavior: "smooth" }); else window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const arrow = (dir: -1 | 1) => (
    <button type="button" aria-label={dir < 0 ? "Previous page" : "Next page"} title={dir < 0 ? "Previous page" : "Next page"}
      disabled={disabled || (dir < 0 ? page <= 1 : page >= pages)} onClick={(e) => go(page + dir, e.currentTarget)}
      className="grid h-7 w-7 place-items-center rounded-md text-muted transition hover:bg-accent-soft hover:text-accent-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-30">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={dir < 0 ? "m15 18-6-6 6-6" : "m9 18 6-6-6-6"} /></svg>
    </button>
  );
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-4 gap-y-2 text-xs text-muted">
      {onSize && size && total > 0 && (
        <label className="flex items-center gap-1.5">Rows
          <span className="w-20 [&_button]:py-1 [&_button]:text-xs [&_ul]:min-w-24"><Select up value={String(size)} onChange={(v) => onSize(Number(v))} options={[10, 25, 50, 100].map((n) => ({ value: String(n), label: String(n) }))} /></span>
        </label>
      )}
      <span>
        {total ? <><b className="font-semibold text-fg tabular-nums">{from}–{to}</b> of <b className="font-semibold text-fg tabular-nums">{total}</b></> : `No ${noun}`}
        {total !== all && <> · filtered from {all}</>}
      </span>
      {pages > 1 && <nav aria-label="Pages" className="flex items-center">{arrow(-1)}{arrow(1)}</nav>}
    </div>
  );
}

/**
 * Client-side paging for any list: returns the rows for the current page and the pager to render under it.
 * The pager stays hidden while everything fits on the smallest page (10), and the page resets when `reset` changes
 * (e.g. the filter text) or the list shrinks below it.
 */
export function usePaged<T>(items: T[], { size: initial = 25, noun = "rows", reset = "" }: { size?: number; noun?: string; reset?: string } = {}): { rows: T[]; pager: ReactNode } {
  const [size, setSize] = useState(initial);
  const [state, setState] = useState({ page: 1, reset });
  const pages = Math.max(1, Math.ceil(items.length / size));
  const page = state.reset !== reset ? 1 : Math.min(state.page, pages);
  const rows = items.slice((page - 1) * size, page * size);
  const pager = items.length > 10 ? (
    <Pager where="bottom" noun={noun} from={(page - 1) * size + 1} to={Math.min(page * size, items.length)} total={items.length} all={items.length}
      page={page} pages={pages} onPage={(n) => setState({ page: n, reset })} size={size} onSize={(n) => { setSize(n); setState({ page: 1, reset }); }} />
  ) : null;
  return { rows, pager };
}

/** usePaged as a component, for places that return early before their list (hooks can't sit after those returns). */
export function Paged<T>({ items, noun, size, reset, children }: { items: T[]; noun?: string; size?: number; reset?: string; children: (rows: T[], pager: ReactNode) => ReactNode }) {
  const { rows, pager } = usePaged(items, { noun, size, reset });
  return <>{children(rows, pager)}</>;
}

/** Search box styled like the Tickets toolbar. */
export function SearchBox({ value, onChange, placeholder = "Search…" }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative w-full sm:w-64">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} aria-label={placeholder}
        className="w-full rounded-lg border border-line bg-panel py-2 pl-9 pr-8 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent-soft" />
      {value && <button type="button" aria-label="Clear search" onClick={() => onChange("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-muted hover:text-fg">✕</button>}
    </div>
  );
}

/**
 * The Tickets-table frame for any table: title row (search + actions on the right), a fixed-height body whose header
 * row stays put while the rows scroll, and the pager in the footer.
 */
export function TableCard({ title, subtitle, toolbar, search, onSearch, searchPlaceholder, actions, pager, children }: {
  title: ReactNode; subtitle?: ReactNode; toolbar?: ReactNode; search?: string; onSearch?: (v: string) => void; searchPlaceholder?: string;
  actions?: ReactNode; pager?: ReactNode; children: ReactNode;
}) {
  return (
    <section className="card flex max-h-[calc(100dvh-12rem)] min-h-0 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        <div className="min-w-0">
          <h2 className="font-semibold">{title}</h2>
          {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
        </div>
        {toolbar}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {onSearch && <SearchBox value={search ?? ""} onChange={onSearch} placeholder={searchPlaceholder} />}
          {actions}
        </div>
      </div>
      <div data-scroll-table className="min-h-0 flex-1 overflow-auto">{children}</div>
      {pager && <div className="border-t border-line px-5 py-2">{pager}</div>}
    </section>
  );
}
