"use client";
import { useEffect, useMemo, useRef, useState } from "react";

export interface PickerAccount { name: string; slug: string; status: string; devrev_names?: string[]; open_tickets?: number | null; wms_tickets?: number | null }

/** Searchable account dropdown: type to filter (matches name, slug or any mapped DevRev account name), ↑/↓ + Enter, Esc to close. */
export function AccountPicker({ accounts, value, onChange }: { accounts: PickerAccount[]; value: string; onChange: (slug: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const current = accounts.find((a) => a.slug === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (a: PickerAccount) =>
      !q || a.name.toLowerCase().includes(q) || a.slug.includes(q) || (a.devrev_names || []).some((n) => n.toLowerCase().includes(q));
    const byCount = (a: PickerAccount, b: PickerAccount) => (b.wms_tickets ?? -1) - (a.wms_tickets ?? -1) || (b.open_tickets ?? -1) - (a.open_tickets ?? -1) || a.name.localeCompare(b.name);
    const active = accounts.filter((a) => a.status === "active" && match(a)).sort(byCount);
    const waiting = accounts.filter((a) => a.status !== "active" && match(a)).sort(byCount);
    return { active, waiting, flat: [...active, ...waiting] };
  }, [accounts, query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const choose = (slug: string) => { onChange(slug); setOpen(false); setQuery(""); };
  const openPicker = () => { setOpen(true); setHi(0); setTimeout(() => input.current?.focus(), 0); };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return setOpen(false);
    if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, filtered.flat.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
    if (e.key === "Enter" && filtered.flat[hi]) { e.preventDefault(); choose(filtered.flat[hi].slug); }
  };

  const row = (a: PickerAccount) => {
    const i = filtered.flat.indexOf(a);
    return (
      <li key={a.slug}>
        <button type="button" onMouseEnter={() => setHi(i)} onClick={() => choose(a.slug)}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${i === hi ? "bg-accent-soft text-accent-strong" : ""} ${a.slug === value ? "font-semibold" : ""}`}>
          <span className="truncate">{a.name}</span>
          <span className="ml-auto shrink-0 tabular-nums text-xs text-muted" title="WMS view count · all open">{a.wms_tickets ?? "…"} WMS · {a.open_tickets ?? "…"}</span>
        </button>
      </li>
    );
  };

  return (
    <div ref={box} className="relative text-sm">
      <div className="mb-1 text-muted">Account</div>
      <button type="button" onClick={() => (open ? setOpen(false) : openPicker())}
        className="flex w-full min-w-0 items-center sm:w-auto sm:min-w-72 gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-left shadow-sm hover:border-accent">
        {current ? <span className="truncate">{current.name}</span> : <span className="skeleton h-4 w-40" />}
        {current?.open_tickets != null && <span className="text-xs text-muted">{current.wms_tickets} WMS · {current.open_tickets} open</span>}
        <span className="ml-auto text-muted">▾</span>
      </button>
      {open && (
        <div className="absolute z-40 mt-1 w-80 overflow-hidden rounded-xl border border-line bg-panel shadow-xl">
          <input ref={input} value={query} onChange={(e) => { setQuery(e.target.value); setHi(0); }} onKeyDown={onKey}
            placeholder="Search accounts…" className="w-full rounded-t-md border-b border-line bg-bg px-3 py-2 outline-none" />
          <ul className="max-h-96 overflow-y-auto py-1">
            {filtered.active.length > 0 && <li className="px-3 pb-1 pt-2 text-xs uppercase tracking-wide text-muted">Connected</li>}
            {filtered.active.map(row)}
            {filtered.waiting.length > 0 && <li className="px-3 pb-1 pt-2 text-xs uppercase tracking-wide text-muted">Awaiting logs / DB credentials</li>}
            {filtered.waiting.map(row)}
            {!filtered.flat.length && <li className="px-3 py-3 text-muted">No account matches “{query}”.</li>}
          </ul>
          <div className="border-t border-line px-3 py-1.5 text-xs text-muted">WMS = DevRev WMS view · second number = all open Support tickets</div>
        </div>
      )}
    </div>
  );
}
