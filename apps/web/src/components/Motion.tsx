"use client";
import { useEffect, useState } from "react";

/**
 * Smooth open / close for every drop-down in Dev Resolve.
 *   usePresence(open) — for menus: stays mounted while it animates out. Put `p.cls` on the menu and render it while `p.show`.
 *   <Collapse open>   — for sections that open in place: slides open and shut (content kept while closing).
 */
export function usePresence(open: boolean, ms = 150) {
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) { const t = setTimeout(() => setShown(true), 0); return () => clearTimeout(t); }
    const t = setTimeout(() => setShown(false), ms);
    return () => clearTimeout(t);
  }, [open, ms]);
  return { show: open || shown, cls: open ? "pop-in" : "pop-out" };
}

export function Collapse({ open, children, className = "" }: { open: boolean; children: React.ReactNode; className?: string }) {
  const [mounted, setMounted] = useState(open);
  const [expanded, setExpanded] = useState(open);
  useEffect(() => {
    if (open) {
      const a = setTimeout(() => setMounted(true), 0);
      const b = setTimeout(() => setExpanded(true), 20); // after mounting, so the height can animate up from 0
      return () => { clearTimeout(a); clearTimeout(b); };
    }
    const a = setTimeout(() => setExpanded(false), 0);
    const b = setTimeout(() => setMounted(false), 260);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, [open]);
  if (!open && !mounted) return null;
  return (
    <div className={`grid transition-[grid-template-rows,opacity] duration-[240ms] ease-out ${open && expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"} ${className}`}>
      <div className="min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
