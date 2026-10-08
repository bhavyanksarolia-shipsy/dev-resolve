"use client";
import { useEffect, useMemo, useRef, useState } from "react";

export interface PickerAccount { name: string; slug: string; status: string; devrev_names?: string[]; open_tickets?: number | null; wms_tickets?: number | null; client_active?: boolean; note?: string }

/** A DevRev account that isn't a client (not routed / not set up) — its picker value is "acct:<id>". */
export const isAccountEntry = (slug: string) => slug.startsWith("acct:");

/** Accounts from /api/accounts: the clients, then the non-client accounts that have open tickets. */
export function pickerAccounts(d: { accounts?: PickerAccount[]; other_accounts?: { slug: string; name: string; open: number; kind: string }[] }): PickerAccount[] {
  return [...(d.accounts ?? []), ...(d.other_accounts ?? []).map((o) => ({
    name: o.name, slug: o.slug, status: "account", client_active: true, devrev_names: [o.name], open_tickets: o.open,
    note: o.kind === "ambiguous" ? "not routed — could be several clients"
      : o.kind === "ignored" ? "default / internal account — move tickets to the right client" : "not set up on a client",
  }))];
}

/** Searchable account dropdown: type to filter (matches name, slug or any mapped DevRev account name), ↑/↓ + Enter, Esc to close. */
/**
 * The picker's "All clients" entry: every Support ticket in DevRev's view. `allOpen` comes from the server — it also
 * counts accounts that aren't (or can't be) mapped to one client, so it can be more than the sum of the clients.
 */
export function withAllClients(accounts: PickerAccount[], allOpen?: number | null): PickerAccount[] {
  if (!accounts.length) return accounts;
  const sum = (k: "open_tickets" | "wms_tickets") => (accounts.some((a) => a[k] != null) ? accounts.reduce((n, a) => n + (a[k] ?? 0), 0) : null); // incl. non-client accounts
  return [{ name: "All clients", slug: "all", status: "active", client_active: true, devrev_names: [], open_tickets: allOpen ?? sum("open_tickets"), wms_tickets: sum("wms_tickets") }, ...accounts];
}

export function AccountPicker({ accounts, value, onChange, label = true }: { accounts: PickerAccount[]; value: string; onChange: (slug: string) => void; label?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const current = accounts.find((a) => a.slug === value)
    ?? (isAccountEntry(value) && accounts.length ? { name: "DevRev account", slug: value, status: "account" } as PickerAccount : undefined);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const match = (a: PickerAccount) =>
      !q || a.name.toLowerCase().includes(q) || a.slug.includes(q) || (a.devrev_names || []).some((n) => n.toLowerCase().includes(q));
    const byCount = (a: PickerAccount, b: PickerAccount) => (b.wms_tickets ?? -1) - (a.wms_tickets ?? -1) || (b.open_tickets ?? -1) - (a.open_tickets ?? -1) || a.name.localeCompare(b.name);
    const live = (a: PickerAccount) => a.client_active !== false;
    const client = (a: PickerAccount) => !isAccountEntry(a.slug);
    const active = accounts.filter((a) => client(a) && live(a) && a.status === "active" && match(a)).sort(byCount);
    const waiting = accounts.filter((a) => client(a) && live(a) && a.status !== "active" && match(a)).sort(byCount);
    const others = accounts.filter((a) => !client(a) && match(a)).sort(byCount);
    // Inactive clients are listed last, under their own heading.
    const inactive = accounts.filter((a) => !live(a) && match(a)).sort(byCount);
    return { active, waiting, others, inactive, flat: [...active, ...waiting, ...others, ...inactive] };
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

  const row = (a: PickerAccount, dim = false) => {
    const i = filtered.flat.indexOf(a);
    return (
      <li key={a.slug} className={dim ? "opacity-60" : ""}>
        <button type="button" onMouseEnter={() => setHi(i)} onClick={() => choose(a.slug)}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm ${i === hi ? "bg-accent-soft text-accent-strong" : ""} ${a.slug === value ? "font-semibold" : ""}`}>
          <span title={a.note ? `${a.name} — ${a.note}` : a.name} className="break-words [overflow-wrap:anywhere]">{a.name}</span>
          {a.note && <span title={a.note} className="h-1.5 w-1.5 shrink-0 rounded-full bg-bad" aria-label={a.note} />}
          <span className="ml-auto shrink-0 tabular-nums text-xs text-muted" title="Open Support tickets">{a.open_tickets ?? "…"} open</span>
        </button>
      </li>
    );
  };

  return (
    <div ref={box} className="relative text-sm">
      {label && <div className="mb-1 text-muted">Account</div>}
      <button type="button" onClick={() => (open ? setOpen(false) : openPicker())}
        className="flex w-full min-w-0 items-center sm:w-auto sm:min-w-72 gap-2 rounded-lg border border-line bg-panel px-3 py-2 text-left shadow-sm hover:border-accent">
        {current ? <span title={current.name} className="truncate">{current.name}</span> : <span className="skeleton h-4 w-40" />}
        {current?.open_tickets != null && <span className="text-xs text-muted">{current.open_tickets} open</span>}
        <span className="ml-auto text-muted">▾</span>
      </button>
      {open && (
        <div className="absolute z-40 mt-1 w-80 overflow-hidden rounded-xl border border-line bg-panel shadow-xl">
          <input ref={input} value={query} onChange={(e) => { setQuery(e.target.value); setHi(0); }} onKeyDown={onKey}
            placeholder="Search accounts…" className="w-full rounded-t-md border-b border-line bg-bg px-3 py-2 outline-none" />
          <ul className="max-h-96 overflow-y-auto py-1">
            {filtered.active.length > 0 && <li className="px-3 pb-1 pt-2 text-xs uppercase tracking-wide text-muted">Connected</li>}
            {filtered.active.map((a) => row(a))}
            {filtered.waiting.length > 0 && <li className="px-3 pb-1 pt-2 text-xs uppercase tracking-wide text-muted">Awaiting logs / DB credentials</li>}
            {filtered.waiting.map((a) => row(a))}
            {filtered.others.length > 0 && <li className="px-3 pb-1 pt-2 text-xs uppercase tracking-wide text-muted">Other DevRev accounts</li>}
            {filtered.others.map((a) => row(a))}
            {filtered.inactive.length > 0 && <li className="px-3 pb-1 pt-2 text-xs uppercase tracking-wide text-muted">Inactive clients</li>}
            {filtered.inactive.map((a) => row(a, true))}
            {!filtered.flat.length && <li className="px-3 py-3 text-muted">No account matches “{query}”.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
