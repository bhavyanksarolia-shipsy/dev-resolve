"use client";
import { useEffect } from "react";
import { toast } from "@/components/Dialog";

interface St { main: string | null; mainDown: boolean; using: "main" | "personal" | "server" | "none"; usingLabel: string | null; restoredAt: string | null }
const KEY = "dr.claude.using";
const get = () => { try { return sessionStorage.getItem(KEY); } catch { return null; } };
const set = (v: string) => { try { sessionStorage.setItem(KEY, v); } catch {} };

/**
 * A short pop-up (top right) when what your investigations reach Claude with changes: "Connected to Bifrost",
 * "Bifrost isn't reachable — using your own Claude token", … Nothing is shown while it stays the same; on opening the app
 * only a problem is mentioned.
 */
export function ClaudeStatusWatch() {
  useEffect(() => {
    let live = true;
    const tick = async () => {
      const r = await fetch("/api/claude-status", { cache: "no-store" }).catch(() => null);
      if (!r?.ok || !live) return;
      const s: St = await r.json();
      const was = get();
      if (was === s.using) return;
      set(s.using);
      const main = s.main ?? "Claude";
      if (s.using === "main") {
        if (was && was !== "main") toast({ ok: true, text: `Claude connected · back on ${main}` });
      } else if (s.using === "personal") {
        toast({ ok: true, text: `${main} isn't reachable — Claude is using your own token for now` });
      } else if (s.using === "server") {
        toast({ ok: true, text: `${main} isn't reachable — Claude is using the team's backup login for now` });
      } else {
        toast({ ok: false, text: `Claude isn't reachable right now — add your own Claude token on the Connector page` });
      }
    };
    void tick();
    const t = setInterval(tick, 30_000);
    window.addEventListener("focus", tick);
    return () => { live = false; clearInterval(t); window.removeEventListener("focus", tick); };
  }, []);
  return null;
}
