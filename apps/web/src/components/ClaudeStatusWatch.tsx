"use client";
import { useEffect } from "react";
import { notify } from "@/components/Dialog";

interface Limit { who: "main" | "personal" | "server"; label: string; at: string; until: string | null }
interface St { main: string | null; mainDown: boolean; using: "main" | "personal" | "server" | "none"; usingLabel: string | null; restoredAt: string | null; limit: Limit | null; pritunlNobody?: boolean }
const USING = "dr.claude.using", LIMIT = "dr.claude.limit", PRITUNL = "dr.claude.pritunl";
const get = (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch {} };
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
const CONNECTOR = { label: "Open the Connector page", href: "/connector" };

/**
 * Claude pop-ups, only when something changes (never just for opening the app):
 *   switched → "Claude connected through Bifrost" / "… to your personal account" / …
 *   a usage limit hit → which account, and when it resets
 *   nobody connected to Pritunl → a reminder to connect it (again every 30 min while it lasts)
 */
export function ClaudeStatusWatch() {
  useEffect(() => {
    let live = true, busy = false, nobodyStreak = 0;
    const tick = async () => {
      if (busy) return; // the timer, page load and tab focus can fire together — one check at a time
      busy = true;
      try { await check(); } finally { busy = false; }
    };
    const check = async () => {
      const r = await fetch("/api/claude-status", { cache: "no-store" }).catch(() => null);
      if (!r?.ok || !live) return;
      const s: St = await r.json();
      const main = s.main ?? "the main sign-in";

      // Right after a server restart nobody has checked in yet — only remind when it's still true on the next check.
      nobodyStreak = s.pritunlNobody ? nobodyStreak + 1 : 0;
      if (s.pritunlNobody && nobodyStreak >= 2) {
        const last = Number(get(PRITUNL) || 0);
        if (Date.now() - last > 30 * 60_000) {
          set(PRITUNL, String(Date.now()));
          notify({ tone: "warn", title: "Nobody is connected to Pritunl", message: `Claude can't reach ${main} right now. Connect Pritunl (company VPN) on your laptop — it helps everyone's investigations.`, action: CONNECTOR, ms: 12_000 });
        }
      } else if (get(PRITUNL)) set(PRITUNL, "0");

      if (s.limit && get(LIMIT) !== s.limit.at) {
        const first = get(LIMIT) === null && get(USING) === null; // just opened the app: only if it's still in effect
        set(LIMIT, s.limit.at);
        if (!first || !s.limit.until || new Date(s.limit.until).getTime() > Date.now()) {
          const then = s.using === "none" ? "Investigations can't run until then." : s.using !== s.limit.who ? `Switched to ${s.using === "main" ? main : s.using === "personal" ? "your personal account" : "the team's backup login"}.` : "";
          notify({ tone: "error", title: "Claude usage limit reached", message: `On ${s.limit.label}${s.limit.until ? ` — resets at ${time(s.limit.until)}` : ""}. ${then}`.trim() });
        }
      }

      const was = get(USING);
      if (was === s.using) return;
      set(USING, s.using);
      if (was === null) return; // the first reading only records where we are
      if (s.using === "main") notify({ tone: "ok", title: `Claude connected through ${main}` , message: "Investigations are back on the main sign-in." });
      else if (s.using === "personal") notify({ tone: "ok", title: "Claude connected to your personal account", message: `${main} isn't reachable, so your own Claude token is used for now.` });
      else if (s.using === "server") notify({ tone: "ok", title: "Claude connected through the team's backup login", message: `${main} isn't reachable right now.` });
      else notify({ tone: "error", title: "Claude isn't reachable", message: "Add your own Claude token so investigations can carry on.", action: CONNECTOR });
    };
    void tick();
    const t = setInterval(tick, 30_000);
    window.addEventListener("focus", tick);
    return () => { live = false; clearInterval(t); window.removeEventListener("focus", tick); };
  }, []);
  return null;
}
