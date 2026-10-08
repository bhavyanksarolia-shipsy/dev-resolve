"use client";
import { useEffect, useState } from "react";

interface Entry { id: number; ticket: string | null; by: string; kind: "investigation" | "chat"; position?: number; waitMin?: number; mine: boolean }
interface Queue { max: number; perPerson: number; running: Entry[]; waiting: Entry[] }

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`;

/** "Waiting in line — 3rd, about 6 min": shown on an investigation that hasn't started yet. Disappears once it starts. */
export function QueueNotice({ invId }: { invId: number }) {
  const [q, setQ] = useState<Queue | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => fetch("/api/queue", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => live && setQ(d)).catch(() => {});
    load();
    const t = setInterval(load, 10_000);
    return () => { live = false; clearInterval(t); };
  }, [invId]);
  const me = q?.waiting.find((w) => w.id === invId);
  if (!q || !me) return null;
  const mineRunning = q.running.filter((r) => r.by === me.by).length;
  return (
    <div className="mb-4 flex items-start gap-3 rounded-xl bg-sky-50 px-4 py-3 text-sm ring-1 ring-sky-200">
      <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-sky-600 text-xs font-semibold text-white">{me.position}</span>
      <div className="min-w-0">
        <div className="font-semibold text-sky-800">
          Waiting in line — {me.position === 1 ? "next up" : `${ordinal(me.position!)} in line`}, about {me.waitMin} min
        </div>
        <div className="text-xs text-sky-900/70">
          {q.running.length} running now (at most {q.max} at once{mineRunning >= q.perPerson ? `; ${me.by} already has ${mineRunning} running — others get a turn first` : ""}).
          {" "}It starts by itself — you can leave this page; you&apos;ll get a notification with a sound when it&apos;s done.
        </div>
      </div>
    </div>
  );
}
