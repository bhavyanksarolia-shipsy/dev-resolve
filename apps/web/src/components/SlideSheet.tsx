"use client";
import { useEffect, useRef, useState } from "react";

/** Red ← with a "Back · Esc" tooltip (same as the ticket page). */
export function BackArrow({ onClick }: { onClick: () => void }) {
  return (
    <span className="group relative">
      <button type="button" onClick={onClick} aria-label="Back (Esc)"
        className="grid h-7 w-8 place-items-center rounded-md bg-accent text-white shadow-sm transition hover:bg-accent-strong">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
      </button>
      <span role="tooltip" className="pointer-events-none absolute left-0 top-full z-50 mt-1.5 flex items-center gap-1.5 whitespace-nowrap rounded-md bg-fg px-2 py-1 text-[11px] font-medium text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
        Back <kbd className="rounded border border-white/30 bg-white/10 px-1 font-mono text-[10px]">Esc</kbd>
      </span>
    </span>
  );
}

/**
 * A drawer that slides in from the right over the current page (admin forms). ← / Esc / clicking the dimmed area
 * slides it back out. Esc is ignored while typing in a field or when a menu inside is open.
 */
export function SlideSheet({ title, subtitle, onClose, children, wide }: { title: React.ReactNode; subtitle?: React.ReactNode; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const close = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    setClosing(true);
    setTimeout(onClose, 400);
  };
  const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; });
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || (el as HTMLElement).isContentEditable)) { (el as HTMLElement).blur(); return; }
      if (document.querySelector('[role="dialog"]:not([data-ticket-sheet]):not([data-slide-sheet]), [role="menu"], [role="listbox"]')) return;
      closeRef.current();
    };
    document.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; document.removeEventListener("keydown", onKey); };
  }, []);
  return (
    <div className="fixed inset-0 z-40" role="dialog" aria-modal="true" data-slide-sheet>
      <div className={`absolute inset-0 bg-black/20 ${closing ? "sheet-fade-out" : "sheet-fade-in"}`} onClick={close} aria-hidden />
      <div className={`absolute inset-y-0 right-0 w-full ${wide ? "max-w-7xl" : "max-w-3xl"} overflow-y-auto border-l border-line bg-bg shadow-2xl ${closing ? "drawer-out" : "drawer-in"}`}>
        <div className="flex min-h-full flex-col px-4 pt-5 sm:px-6">
          <div className="mb-5 flex items-center gap-3">
            <BackArrow onClick={close} />
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold">{title}</h2>
              {subtitle && <p className="text-xs text-muted">{subtitle}</p>}
            </div>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
