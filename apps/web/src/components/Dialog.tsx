"use client";
import Link from "next/link";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { chime } from "@/lib/sound";
import { Modal } from "@/components/Modal";

/**
 * In-app replacements for the browser's confirm() / alert(), styled like the rest of Dev Resolve.
 *   if (await confirmDialog({ title, message, confirmLabel, danger })) …
 *   notify({ message, tone: "error" })
 * <DialogHost /> (in the root layout) renders them.
 */
interface ConfirmReq { id: number; title: string; message: string; confirmLabel: string; danger: boolean; requireText?: string; resolve: (ok: boolean) => void }
type Tone = "error" | "ok" | "info" | "warn";
interface Toast { id: number; title?: string; message: string; tone: Tone; action?: { label: string; href: string }; ms: number; leaving?: boolean }

let seq = 0;
// closing: the dialog that's animating out (shown until its exit animation ends).
let state: { confirm: ConfirmReq | null; closing: ConfirmReq | null; toasts: Toast[] } = { confirm: null, closing: null, toasts: [] };
const listeners = new Set<() => void>();
const emit = (next: typeof state) => { state = next; listeners.forEach((l) => l()); };

/** requireText: the person must type exactly this (e.g. a username) before the confirm button unlocks. */
export function confirmDialog(o: { title: string; message: string; confirmLabel?: string; danger?: boolean; requireText?: string }): Promise<boolean> {
  state.confirm?.resolve(false);
  return new Promise((resolve) => emit({ ...state, confirm: { id: ++seq, confirmLabel: "Confirm", danger: false, ...o, resolve } }));
}

/**
 * Every notification in Dev Resolve: top right under the menu, newest at the bottom, at most 4. Each pops in, plays the
 * notification sound (sound: false to skip — e.g. another tab already played it), counts down with a timer bar that
 * pauses while the mouse is over it, then pops out. action = a link button ("Open →").
 */
export function notify(o: { message: string; title?: string; tone?: Tone; action?: { label: string; href: string }; ms?: number; sound?: boolean }) {
  const tone = o.tone ?? "info";
  // The same notification already on screen: don't stack a copy (and don't play the sound again).
  if (state.toasts.some((x) => !x.leaving && x.title === o.title && x.message === o.message)) return;
  const t: Toast = { id: ++seq, tone, title: o.title, message: o.message, action: o.action, ms: o.ms ?? (tone === "error" ? 10_000 : tone === "warn" ? 9_000 : 6_000) };
  const kept = state.toasts.filter((x) => !x.leaving);
  emit({ ...state, toasts: [...kept.slice(-3), t] });
  if (o.sound !== false) chime(tone);
}
function dismiss(id: number) {
  if (!state.toasts.some((x) => x.id === id && !x.leaving)) return;
  emit({ ...state, toasts: state.toasts.map((x) => (x.id === id ? { ...x, leaving: true } : x)) });
  setTimeout(() => emit({ ...state, toasts: state.toasts.filter((x) => x.id !== id) }), 220); // after the pop-out
}

/** Result of an action ({ ok, text }) as a toast that disappears by itself; null is ignored (clearing an old message). */
export function toast(m: { ok: boolean; text: string } | null) {
  if (m?.text) notify({ message: m.text, tone: m.ok ? "ok" : "error" });
}

const subscribe = (l: () => void) => { listeners.add(l); return () => listeners.delete(l); };
const TONE: Record<Tone, { ring: string; icon: string; mark: string; bar: string }> = {
  ok: { ring: "border-emerald-200", icon: "bg-ok", mark: "✓", bar: "bg-ok" },
  error: { ring: "border-red-200", icon: "bg-bad", mark: "!", bar: "bg-bad" },
  warn: { ring: "border-amber-200", icon: "bg-warn", mark: "!", bar: "bg-warn" },
  info: { ring: "border-line", icon: "bg-accent", mark: "i", bar: "bg-accent" },
};

export function DialogHost() {
  const s = useSyncExternalStore(subscribe, () => state, () => state);
  const okRef = useRef<HTMLButtonElement>(null);
  const typeRef = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState({ id: 0, text: "" });
  const c = s.confirm ?? s.closing; // while it animates out, keep showing the dialog that's closing
  const text = typed.id === c?.id ? typed.text : "";
  const locked = !!c?.requireText && text.trim().toLowerCase() !== c.requireText.toLowerCase();
  const close = (ok: boolean) => {
    if (!s.confirm) return;
    const was = s.confirm;
    was.resolve(ok);
    emit({ ...state, confirm: null, closing: was });
    setTimeout(() => { if (state.closing === was) emit({ ...state, closing: null }); }, 200);
  };

  useEffect(() => {
    if (s.confirm) setTimeout(() => (s.confirm!.requireText ? typeRef.current : okRef.current)?.focus(), 30);
  }, [s.confirm]);

  return (
    <>
      {c && (
        <Modal open={!!s.confirm} onClose={() => close(false)} labelledBy="dlg-title" className="max-w-md">
          <div className="rounded-2xl bg-panel p-6 shadow-xl ring-1 ring-line">
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
        </Modal>
      )}
      {/* Top right, just under the menu bar; evenly spaced. */}
      <div className="pointer-events-none fixed right-4 top-[4.75rem] z-[90] flex w-[23rem] max-w-[calc(100vw-2rem)] flex-col gap-2.5" aria-live="polite">
        {s.toasts.map((t) => {
          const k = TONE[t.tone];
          return (
            <div key={t.id} role="status" className={`toast-card pointer-events-auto overflow-hidden rounded-2xl border bg-panel shadow-xl ${k.ring} ${t.leaving ? "toast-out" : "toast-in"}`}>
              <div className="flex gap-3 px-4 pb-3 pt-3.5">
                <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full text-sm font-bold text-white ${k.icon}`}>{k.mark}</span>
                <div className="min-w-0 flex-1">
                  <div className="font-semibold leading-snug">{t.title ?? t.message}</div>
                  {t.title && <div className="mt-0.5 break-words text-sm text-muted">{t.message}</div>}
                  {t.action && <Link href={t.action.href} onClick={() => dismiss(t.id)} className="mt-1.5 inline-block text-sm font-medium text-accent-strong hover:underline">{t.action.label} →</Link>}
                </div>
                <button aria-label="Dismiss" className="-mr-1 h-7 w-7 shrink-0 rounded-md text-lg leading-none text-muted hover:bg-bg hover:text-fg" onClick={() => dismiss(t.id)}>×</button>
              </div>
              {/* The timer: shrinks to nothing, then the notification goes; paused while hovered. */}
              <div className="h-1 bg-bg"><div className={`toast-timer h-full ${k.bar} opacity-70`} style={{ ["--toast-ms" as string]: `${t.ms}ms` }} onAnimationEnd={() => dismiss(t.id)} /></div>
            </div>
          );
        })}
      </div>
    </>
  );
}
