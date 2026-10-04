"use client";
import { useEffect, useState } from "react";
import { Workspace } from "./Workspace";

/**
 * A ticket as a sheet that slides up over the Tickets table. The table stays mounted (and still) underneath, so
 * Back slides the sheet down and you're exactly where you were — same filters, scroll and data.
 */
export function TicketSheet({ ticketId, onClosed }: { ticketId: string; onClosed: () => void }) {
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    const y = window.scrollY; // where the table was — put back after closing (navigation would reset it)
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden"; // the table behind doesn't scroll while the sheet is open
    return () => {
      document.body.style.overflow = prev;
      const restore = () => window.scrollTo({ top: y, behavior: "instant" as ScrollBehavior });
      requestAnimationFrame(restore);
      setTimeout(restore, 60);
      setTimeout(restore, 200);
    };
  }, []);
  const close = () => {
    if (closing) return;
    setClosing(true);
    setTimeout(onClosed, 400); // let the slide-down play
  };
  return (
    <div className="fixed inset-0 z-20" role="dialog" aria-modal="true" aria-label={ticketId}>
      <div className={`absolute inset-0 bg-black/20 ${closing ? "sheet-fade-out" : "sheet-fade-in"}`} onClick={close} aria-hidden />
      <div className={`absolute inset-x-0 bottom-0 top-[3.6rem] overflow-y-auto rounded-t-2xl border-t border-line bg-bg px-4 pb-6 pt-5 shadow-2xl sm:px-6 ${closing ? "sheet-down" : "sheet-up"}`}>
        <Workspace ticketId={ticketId} onClose={close} />
      </div>
    </div>
  );
}
