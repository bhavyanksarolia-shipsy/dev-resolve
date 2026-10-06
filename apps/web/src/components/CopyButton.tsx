"use client";
import { useEffect, useRef, useState } from "react";

/**
 * Copy to clipboard, the same everywhere: a black tooltip says "Copy" on hover and "Copied" after a click (it stays a
 * moment, even without hovering). `text` can be a function, e.g. to fetch a secret only when someone copies it.
 */
export function CopyButton({ text, label = "Copy", className = "", children }: {
  text: string | (() => string | null | Promise<string | null>);
  label?: string; className?: string; children?: React.ReactNode;
}) {
  const [state, setState] = useState<"" | "copied" | "failed">("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const copy = async () => {
    let ok = false;
    try {
      const value = typeof text === "function" ? await text() : text;
      if (value) { await navigator.clipboard.writeText(value); ok = true; }
    } catch { /* blocked by the browser */ }
    setState(ok ? "copied" : "failed");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState(""), 1500);
  };
  const tip = state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy" : "Copy";
  return (
    <span className="group/copy relative inline-flex">
      <button type="button" onClick={copy} aria-label={label}
        className={className || "grid h-6 w-6 shrink-0 place-items-center rounded-md text-muted hover:bg-accent-soft hover:text-accent-strong"}>
        {children ?? (state === "copied"
          ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
          : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></svg>)}
      </button>
      <span role="status" aria-live="polite"
        className={`pointer-events-none absolute bottom-full left-1/2 z-[80] mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-neutral-900 px-2 py-1 text-[11px] font-medium text-white shadow-lg transition-opacity duration-150
          ${state ? "opacity-100" : "opacity-0 group-hover/copy:opacity-100 group-has-[:focus-visible]/copy:opacity-100"}`}>
        {tip}
        <span className="absolute left-1/2 top-full -translate-x-1/2 border-4 border-transparent border-t-neutral-900" aria-hidden />
      </span>
    </span>
  );
}
