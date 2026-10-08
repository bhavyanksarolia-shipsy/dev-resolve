"use client";
import { useEffect } from "react";
import { usePresence } from "@/components/Motion";

/**
 * A pop-up window: the page dims and the window rises in; closing plays it backwards. Esc or a click outside closes it
 * (unless `locked`, e.g. while saving).
 */
export function Modal({ open, onClose, labelledBy, className = "max-w-lg", locked, children }: {
  open: boolean; onClose: () => void; labelledBy?: string; className?: string; locked?: boolean; children: React.ReactNode;
}) {
  const p = usePresence(open, 180);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !locked) { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, locked, onClose]);
  if (!p.show) return null;
  return (
    <div className={`fixed inset-0 z-50 grid place-items-center p-4 ${open ? "modal-bg-in" : "modal-bg-out"}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget && !locked) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby={labelledBy} className={`w-full ${className} ${open ? "modal-in" : "modal-out"}`}>
        {children}
      </div>
    </div>
  );
}
