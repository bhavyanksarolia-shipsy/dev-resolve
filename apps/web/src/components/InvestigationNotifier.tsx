"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BellIcon, BellOffIcon } from "@/components/icons";

interface Event { kind: "investigation" | "chat"; id: number; ticket_display: string; ticket_title: string; ok: boolean; confidence: string | null; error: string | null; at: string }
interface Feed { now: string; running: number; waiting: number; mine: { running: number; waiting: number }; events: Event[] }
interface Toast { key: string; ok: boolean; title: string; body: string; href: string }

const KEY = "dr.notify.since", SOUND = "dr.notify.sound";
const get = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} };

// ── sound: a short chime made in the browser (no file); needs one click on the page first (browser rule) ──────────────
let audio: AudioContext | null = null;
const unlockAudio = () => {
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
  } catch { /* no audio */ }
};
function chime(ok: boolean) {
  if (get(SOUND) === "off" || !audio || audio.state !== "running") return;
  const notes = ok ? [660, 880] : [440, 330];
  notes.forEach((f, i) => {
    const o = audio!.createOscillator(), g = audio!.createGain(), t = audio!.currentTime + i * 0.16;
    o.type = "sine"; o.frequency.value = f;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g).connect(audio!.destination); o.start(t); o.stop(t + 0.4);
  });
}

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
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [menu, setMenu] = useState(false);
  const [sound, setSound] = useState(true);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const supported = "Notification" in window;
    const t0 = setTimeout(() => { setPerm(supported ? Notification.permission : "unsupported"); setSound(get(SOUND) !== "off"); }, 0);
    for (const e of ["pointerdown", "keydown"]) window.addEventListener(e, unlockAudio, { capture: true });
    const channel = "BroadcastChannel" in window ? new BroadcastChannel("dev-resolve-notify") : null;
    const show = (list: Toast[]) => {
      setToasts((cur) => [...cur.filter((c) => !list.some((x) => x.key === c.key)), ...list].slice(-4));
      for (const x of list) setTimeout(() => setToasts((cur) => cur.filter((c) => c.key !== x.key)), x.ok ? 20_000 : 40_000);
    };
    if (channel) channel.onmessage = (m) => show(m.data as Toast[]);
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
        show(list); channel?.postMessage(list);
        chime(list.every((x) => x.ok));
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
      for (const e of ["pointerdown", "keydown"]) window.removeEventListener(e, unlockAudio, { capture: true });
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
    setToasts((cur) => [...cur, x].slice(-4));
    setTimeout(() => setToasts((cur) => cur.filter((c) => c.key !== x.key)), 8000);
    setTimeout(() => chime(true), 50);
    if ("Notification" in window && Notification.permission === "granted") new Notification(x.title, { body: x.body, tag: x.key });
  };
  const toggleSound = () => { const next = !sound; setSound(next); set(SOUND, next ? "on" : "off"); if (next) { unlockAudio(); setTimeout(() => chime(true), 50); } };

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
      {menu && (
        <div className="absolute right-0 top-10 z-50 w-80 space-y-3 rounded-xl border border-line bg-panel p-4 text-sm text-fg shadow-xl">
          <div className="font-semibold">Notifications</div>
          <p className="text-xs text-muted">When your investigation or chat reply is done you get a pop-up on this page and a sound — and a desktop notification if it&apos;s allowed.</p>
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
          <p className="text-[11px] leading-snug text-muted">No desktop pop-up in the test? Your Mac may be blocking Chrome: <b>System Settings → Notifications → Google Chrome → Allow notifications</b>. The pop-up on this page and the sound work either way.</p>
        </div>
      )}
      {/* In-page pop-ups: shown even when the laptop's notifications are off. */}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[90] flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-2" aria-live="polite">
        {toasts.map((x) => (
          <div key={x.key} className={`pointer-events-auto flex gap-3 rounded-xl border bg-panel p-3 shadow-xl ${x.ok ? "border-emerald-200" : "border-red-200"}`}>
            <span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs text-white ${x.ok ? "bg-ok" : "bg-bad"}`}>{x.ok ? "✓" : "!"}</span>
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{x.title}</div>
              <div className="line-clamp-2 text-xs text-muted">{x.body}</div>
              <button onClick={() => { router.push(x.href); setToasts((c) => c.filter((t) => t.key !== x.key)); }} className="mt-1.5 text-xs font-medium text-accent-strong hover:underline">Open →</button>
            </div>
            <button onClick={() => setToasts((c) => c.filter((t) => t.key !== x.key))} aria-label="Dismiss" className="h-6 w-6 shrink-0 rounded text-muted hover:bg-bg">×</button>
          </div>
        ))}
      </div>
    </div>
  );
}
