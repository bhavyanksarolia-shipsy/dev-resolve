"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * In-app replacements for the browser's confirm() / alert(), styled like the rest of Dev Resolve.
 *   if (await confirmDialog({ title, message, confirmLabel, danger })) …
 *   notify({ message, tone: "error" })
 * <DialogHost /> (in the root layout) renders them.
 */
interface ConfirmReq { id: number; title: string; message: string; confirmLabel: string; danger: boolean; requireText?: string; resolve: (ok: boolean) => void }
interface Toast { id: number; title?: string; message: string; tone: "error" | "ok" | "info" }

let seq = 0;
let state: { confirm: ConfirmReq | null; toasts: Toast[] } = { confirm: null, toasts: [] };
const listeners = new Set<() => void>();
const emit = (next: typeof state) => { state = next; listeners.forEach((l) => l()); };

/** requireText: the person must type exactly this (e.g. a username) before the confirm button unlocks. */
export function confirmDialog(o: { title: string; message: string; confirmLabel?: string; danger?: boolean; requireText?: string }): Promise<boolean> {
  state.confirm?.resolve(false);
  return new Promise((resolve) => emit({ ...state, confirm: { id: ++seq, confirmLabel: "Confirm", danger: false, ...o, resolve } }));
}

export function notify(o: { message: string; title?: string; tone?: Toast["tone"] }) {
  const t: Toast = { id: ++seq, tone: "info", ...o };
  emit({ ...state, toasts: [...state.toasts.slice(-3), t] });
  setTimeout(() => emit({ ...state, toasts: state.toasts.filter((x) => x.id !== t.id) }), t.tone === "error" ? 9000 : 5000);
}

const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
const TOAST = { error: "border-red-200 bg-red-50 text-bad", ok: "border-emerald-200 bg-emerald-50 text-ok", info: "border-line bg-panel text-fg" };

export function DialogHost() {
  const s = useSyncExternalStore(subscribe, () => state, () => state);
  const okRef = useRef<HTMLButtonElement>(null);
  const typeRef = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState({ id: 0, text: "" });
  const c = s.confirm;
  const text = typed.id === c?.id ? typed.text : "";
  const locked = !!c?.requireText && text.trim().toLowerCase() !== c.requireText.toLowerCase();
  const close = (ok: boolean) => { c?.resolve(ok); emit({ ...state, confirm: null }); };

  useEffect(() => {
    if (!c) return;
    (c.requireText ? typeRef.current : okRef.current)?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { c.resolve(false); emit({ ...state, confirm: null }); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [c]);

  return (
    <>
      {c && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4 backdrop-blur-[2px]" onMouseDown={(e) => e.target === e.currentTarget && close(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="dlg-title" className="w-full max-w-md rounded-2xl bg-panel p-6 shadow-xl ring-1 ring-line">
            <div className="flex gap-3">
              <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full text-base font-semibold ${c.danger ? "bg-red-50 text-bad" : "bg-accent-soft text-accent-strong"}`}>{c.danger ? "!" : "?"}</span>
              <div className="min-w-0">
                <h2 id="dlg-title" className="font-semibold">{c.title}</h2>
                <p className="mt-1 whitespace-pre-line text-sm text-muted">{c.message}</p>
                {c.requireText && (
                  <label className="mt-4 block text-sm">
                    <span className="text-muted">Type <b className="font-mono text-fg">{c.requireText}</b> to confirm</span>
                    <input ref={typeRef} value={text} autoComplete="off" spellCheck={false}
                      onChange={(e) => setTyped({ id: c.id, text: e.target.value })}
                      onKeyDown={(e) => { if (e.key === "Enter" && !locked) close(true); }}
                      className="mt-1.5 w-full rounded-md border border-line bg-bg px-2 py-1.5 font-mono text-sm outline-none focus:border-bad focus:ring-2 focus:ring-red-100" />
                  </label>
                )}
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button onClick={() => close(false)} className="rounded-lg border border-line px-4 py-2 text-sm font-medium hover:border-accent">Cancel</button>
              <button ref={okRef} onClick={() => close(true)} disabled={locked}
                className={`rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-40 ${c.danger ? "bg-bad hover:opacity-90" : "bg-accent hover:bg-accent-strong"}`}>{c.confirmLabel}</button>
            </div>
          </div>
        </div>
      )}
      <div className="pointer-events-none fixed right-4 top-16 z-50 flex w-full max-w-sm flex-col gap-2">
        {s.toasts.map((t) => (
          <div key={t.id} role="status" className={`pointer-events-auto rounded-xl border px-4 py-3 text-sm shadow-lg ${TOAST[t.tone]}`}>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">{t.title && <div className="font-semibold">{t.title}</div>}<div className="break-words">{t.message}</div></div>
              <button aria-label="Dismiss" className="text-muted hover:text-fg" onClick={() => emit({ ...state, toasts: state.toasts.filter((x) => x.id !== t.id) })}>✕</button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
