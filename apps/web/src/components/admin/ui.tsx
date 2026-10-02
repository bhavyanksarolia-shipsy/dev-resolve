"use client";
import { ReactNode } from "react";

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
