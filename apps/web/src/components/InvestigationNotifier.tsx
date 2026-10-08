"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BellIcon, BellOffIcon } from "@/components/icons";
import { notify } from "@/components/Dialog";
import { chime, setSoundOn, soundOn, unlockAudio } from "@/lib/sound";
import { usePresence } from "@/components/Motion";

interface Event { kind: "investigation" | "chat"; id: number; ticket_display: string; ticket_title: string; ok: boolean; confidence: string | null; error: string | null; at: string }
interface Feed { now: string; running: number; waiting: number; mine: { running: number; waiting: number }; events: Event[] }
interface Toast { key: string; ok: boolean; title: string; body: string; href: string }
/** Shown with the app's one notification style (Dialog.tsx notify): top right, timer bar, sound. */
const show = (x: Toast, sound = true) => notify({ title: x.title, message: x.body, tone: x.ok ? "ok" : "error", action: { label: "Open", href: x.href }, ms: x.ok ? 15_000 : 20_000, sound });

const KEY = "dr.notify.since";
const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} };

function describe(e: Event): Toast {
  const what = e.kind === "chat" ? "Chat reply" : "RCA";
  return {
    key: `${e.kind}-${e.id}-${e.at}`, ok: e.ok, href: `/tickets/${e.ticket_display}`,
    title: e.ok ? `${what} ready · ${e.ticket_display}` : `${e.kind === "chat" ? "Chat reply" : "Investigation"} failed · ${e.ticket_display}`,
    body: e.ok ? `${e.ticket_title}${e.kind === "investigation" ? ` · confidence ${e.confidence ?? "?"} — review and post` : ""}` : `${e.ticket_title}${e.error ? ` — ${e.error.slice(0, 140)}` : ""}`,
  };
}

/**
 * Tells you when YOUR investigation or chat reply is done — three ways, so it works even when the laptop's notifications
 * for Chrome are switched off: a pop-up on the page, a short sound, and a desktop notification (if allowed). Lives in
 * the header, so it works on every page while any Dev Resolve tab is open; one tab picks each event up (shared `since`)
 * and tells the other tabs, so nothing shows twice.
 */
export function InvestigationNotifier() {
  const router = useRouter();
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  const [feed, setFeed] = useState<Pick<Feed, "running" | "waiting" | "mine">>({ running: 0, waiting: 0, mine: { running: 0, waiting: 0 } });
  const [menu, setMenu] = useState(false);
  const pres = usePresence(menu); // opens and closes smoothly
  const [sound, setSound] = useState(true);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supported = "Notification" in window;
    const t0 = setTimeout(() => { setPerm(supported ? Notification.permission : "unsupported"); setSound(soundOn()); }, 0);
    // Other Dev Resolve tabs show it too, without playing the sound again.
    const channel = "BroadcastChannel" in window ? new BroadcastChannel("dev-resolve-notify") : null;
    if (channel) channel.onmessage = (m) => (m.data as Toast[]).forEach((x) => show(x, false));
    let live = true;
    const tick = async () => {
      try {
        const since = get(KEY);
        const r = await fetch(`/api/investigations${since ? `?since=${encodeURIComponent(since)}` : ""}`, { cache: "no-store" });
        if (!r.ok) return;
        const d: Feed = await r.json();
        if (!live) return;
        setFeed({ running: d.running, waiting: d.waiting, mine: d.mine });
        if (!since || get(KEY) !== since) { if (!since) set(KEY, d.now); return; } // first visit, or another tab got these
        set(KEY, d.events.length ? d.events[d.events.length - 1].at : d.now);
        if (!d.events.length) return;
        const list = d.events.map(describe);
        list.forEach((x, i) => show(x, i === 0)); channel?.postMessage(list);
        if (supported && Notification.permission === "granted") {
          for (const x of list) {
            const n = new Notification(x.title, { body: x.body, tag: `dev-resolve-${x.key}`, requireInteraction: true });
            n.onclick = () => { window.focus(); router.push(x.href); n.close(); };
          }
        }
      } catch { /* server restarting — next tick */ }
    };
    tick();
    const t = setInterval(tick, 10_000);
    const now = () => { void tick(); setTimeout(() => void tick(), 1500); };
    window.addEventListener("investigations-changed", now);
    return () => {
      live = false; clearTimeout(t0); clearInterval(t); channel?.close();
      window.removeEventListener("investigations-changed", now);
    };
  }, [router]);

  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [menu]);

  const test = () => {
    unlockAudio();
    const x: Toast = { key: `test-${Date.now()}`, ok: true, title: "Test · notifications work", body: "This is what you'll see when your RCA or chat reply is ready.", href: "/tickets" };
    setTimeout(() => show(x), 50);
    if ("Notification" in window && Notification.permission === "granted") new Notification(x.title, { body: x.body, tag: x.key });
  };
  const toggleSound = () => { const next = !sound; setSound(next); setSoundOn(next); if (next) { unlockAudio(); setTimeout(() => chime("ok"), 50); } };

  const iconBtn = "relative grid h-8 w-8 place-items-center rounded-full transition-colors";
  const { running, waiting, mine } = feed;
  return (
    <div ref={box} className="relative flex items-center gap-2 text-xs">
      {(running > 0 || waiting > 0) && (
        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-warn ring-1 ring-amber-200"
          title={`Everyone: ${running} running, ${waiting} waiting in line. Yours: ${mine.running} running, ${mine.waiting} waiting.`}>
          {running} investigating{waiting > 0 ? ` · ${waiting} waiting` : ""}
        </span>
      )}
      <button onClick={() => setMenu((m) => !m)} aria-label="Notifications" aria-expanded={menu}
        className={`${iconBtn} ${perm === "denied" ? "text-bad" : perm === "granted" ? "text-accent-strong" : "text-muted"} hover:bg-accent-soft`}>
        {perm === "denied" ? <BellOffIcon /> : <BellIcon filled={perm === "granted"} />}
        {perm === "default" && <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-warn ring-2 ring-panel" />}
      </button>
      {pres.show && (
        <div className={`absolute right-0 top-10 z-50 w-80 space-y-3 rounded-xl border border-line bg-panel p-4 text-sm text-fg shadow-xl ${pres.cls}`}>
          <div className="font-semibold">Notifications</div>
          <div className="flex items-center justify-between gap-2">
            <span>Desktop notifications</span>
            {perm === "granted" ? <span className="text-xs text-ok">on</span>
              : perm === "denied" ? <span className="text-xs text-bad">blocked</span>
              : perm === "unsupported" ? <span className="text-xs text-muted">not available</span>
              : <button className="rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white" onClick={() => Notification.requestPermission().then(setPerm)}>Turn on</button>}
          </div>
          {perm === "denied" && <p className="text-xs text-muted">Chrome: click the icon left of the address bar → <b>Notifications → Allow</b>, then reload.</p>}
          <div className="flex items-center justify-between gap-2">
            <span>Sound</span>
            <button role="switch" aria-checked={sound} onClick={toggleSound} className={`relative h-5 w-9 rounded-full transition-colors ${sound ? "bg-accent" : "bg-line"}`}>
              <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${sound ? "left-[18px]" : "left-0.5"}`} />
            </button>
          </div>
          <button onClick={test} className="w-full rounded-lg border border-line px-3 py-1.5 text-xs font-medium hover:border-accent">Send a test notification</button>
        </div>
      )}
    </div>
  );
}
