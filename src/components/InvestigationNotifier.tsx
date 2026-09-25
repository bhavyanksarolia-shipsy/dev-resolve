"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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

  return (
    <div className="ml-auto flex items-center gap-3 text-xs">
      {running > 0 && <span className="text-warn">● {running} investigating</span>}
      {perm === "default" && (
        <button onClick={() => Notification.requestPermission().then(setPerm)} className="rounded-md border border-line px-2 py-1 text-muted hover:text-fg">
          🔔 Enable notifications
        </button>
      )}
      {perm === "granted" && <span className="text-muted">🔔 notifications on</span>}
      {perm === "denied" && <span className="text-bad" title="Chrome: click the lock icon in the address bar → Notifications → Allow">🔕 notifications blocked</span>}
    </div>
  );
}
