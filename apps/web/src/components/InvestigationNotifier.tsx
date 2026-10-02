"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BellIcon, BellOffIcon } from "@/components/icons";

interface Finished { id: number; ticket_display: string; ticket_title: string; status: string; confidence: string | null; error: string | null; finished_at: string }

const KEY = "dr.notify.since";
const readSince = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const writeSince = (v: string) => { try { localStorage.setItem(KEY, v); } catch {} };

/**
 * Desktop (Chrome) notification when an investigation finishes. Lives in the layout, so it works on every page
 * while any Dev Resolve tab is open. `since` is shared via localStorage so several tabs don't notify twice.
 */
export function InvestigationNotifier() {
  const router = useRouter();
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  const [running, setRunning] = useState(0);

  useEffect(() => {
    const supported = typeof window !== "undefined" && "Notification" in window;
    const sync = () => setPerm(supported ? Notification.permission : "unsupported");
    const t0 = setTimeout(sync, 0);
    let live = true;
    const tick = async () => {
      try {
        const since = readSince();
        const r = await fetch(`/api/investigations${since ? `?finished_after=${encodeURIComponent(since)}` : ""}`, { cache: "no-store" });
        const d: { now: string; running: number; finished: Finished[] } = await r.json();
        if (!live) return;
        setRunning(d.running);
        if (!since) return writeSince(d.now); // first visit: start from now, don't replay history
        for (const f of d.finished) {
          if (supported && Notification.permission === "granted") {
            const ok = f.status === "draft_ready";
            const n = new Notification(ok ? `RCA ready · ${f.ticket_display}` : `Investigation failed · ${f.ticket_display}`, {
              body: ok ? `${f.ticket_title}\nConfidence: ${f.confidence ?? "?"} — review and post.` : `${f.ticket_title}\n${f.error ?? ""}`,
              tag: `dev-resolve-${f.id}`,
              requireInteraction: true,
            });
            n.onclick = () => { window.focus(); router.push(`/tickets/${f.ticket_display}`); n.close(); };
          }
        }
        writeSince(d.finished.length ? String(d.finished[d.finished.length - 1].finished_at) : d.now);
      } catch {
        /* server restarting — try again next tick */
      }
    };
    tick();
    const t = setInterval(tick, 15000);
    return () => { live = false; clearTimeout(t0); clearInterval(t); };
  }, [router]);

  const iconBtn = "relative grid h-8 w-8 place-items-center rounded-full transition-colors";
  return (
    <div className="flex items-center gap-2 text-xs">
      {running > 0 && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-warn ring-1 ring-amber-200" title="Investigations running now">{running} investigating</span>}
      {perm === "default" && (
        <button onClick={() => Notification.requestPermission().then(setPerm)} title="Turn on notifications — get a Chrome notification when an RCA is ready"
          aria-label="Turn on notifications" className={`${iconBtn} text-muted hover:bg-accent-soft hover:text-accent-strong`}>
          <BellIcon /><span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-warn ring-2 ring-panel" />
        </button>
      )}
      {perm === "granted" && <span title="Notifications on — you'll get a Chrome notification when an RCA is ready" aria-label="Notifications on" className={`${iconBtn} text-accent-strong`}><BellIcon filled /></span>}
      {perm === "denied" && (
        <span title="Notifications blocked — Chrome: click the lock icon in the address bar → Notifications → Allow" aria-label="Notifications blocked" className={`${iconBtn} text-bad`}><BellOffIcon /></span>
      )}
    </div>
  );
}
