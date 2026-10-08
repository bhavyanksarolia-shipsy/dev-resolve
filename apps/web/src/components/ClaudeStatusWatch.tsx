"use client";
import { useEffect } from "react";
import { toast } from "@/components/Dialog";

interface Limit { who: "main" | "personal" | "server"; label: string; at: string; until: string | null }
interface St { main: string | null; mainDown: boolean; using: "main" | "personal" | "server" | "none"; usingLabel: string | null; restoredAt: string | null; limit: Limit | null }
const USING = "dr.claude.using", LIMIT = "dr.claude.limit";
const get = (k: string) => { try { return sessionStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string) => { try { sessionStorage.setItem(k, v); } catch {} };
const time = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

/**
 * Short pop-ups (top right), only when something changes — never just for opening the app:
 *   switched → "Claude connected through Bifrost" / "Claude connected to your personal account" / …
 *   a usage limit hit → a red one saying which account and when it resets.
 */
export function ClaudeStatusWatch() {
  useEffect(() => {
    let live = true;
    const tick = async () => {
      const r = await fetch("/api/claude-status", { cache: "no-store" }).catch(() => null);
      if (!r?.ok || !live) return;
      const s: St = await r.json();
      const main = s.main ?? "the main sign-in";

      // A usage limit — once per limit.
      if (s.limit && get(LIMIT) !== s.limit.at) {
        const first = get(LIMIT) === null && get(USING) === null; // just opened the app: only if it's still in effect
        set(LIMIT, s.limit.at);
        const inEffect = !s.limit.until || new Date(s.limit.until).getTime() > Date.now();
        if (!first || inEffect) {
          const reset = s.limit.until ? ` — resets at ${time(s.limit.until)}` : "";
          const then = s.using === "none" ? " Investigations can't run until then." : s.using !== s.limit.who ? ` Switched to ${s.using === "main" ? main : s.using === "personal" ? "your personal account" : "the team's backup login"}.` : "";
          toast({ ok: false, text: `Claude usage limit reached on ${s.limit.label}${reset}.${then}` });
        }
      }

      // A switch — the first reading only records where we are.
      const was = get(USING);
      if (was === s.using) return;
      set(USING, s.using);
      if (was === null) return;
      if (s.using === "main") toast({ ok: true, text: `Claude connected through ${main}` });
      else if (s.using === "personal") toast({ ok: true, text: "Claude connected to your personal account" });
      else if (s.using === "server") toast({ ok: true, text: "Claude connected through the team's backup login" });
      else toast({ ok: false, text: "Claude isn't reachable right now — add your own Claude token on the Connector page" });
    };
    void tick();
    const t = setInterval(tick, 30_000);
    window.addEventListener("focus", tick);
    return () => { live = false; clearInterval(t); window.removeEventListener("focus", tick); };
  }, []);
  return null;
}
