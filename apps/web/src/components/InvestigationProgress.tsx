"use client";
import { useEffect, useState } from "react";
import { Markdown } from "@/components/Markdown";
import { hidePaths } from "@/components/labels";

interface Step { seq: number; kind: string; tool: string | null; output: string | null; created_at: string }

/** Which stage of the work a tool belongs to (works with the member view, where only tool names are sent). */
const PHASES = [
  { id: "read", label: "Reading the ticket", tools: [] as string[],
    lines: ["Reading the ticket and its emails…", "Looking at the screenshots and attachments…", "Picking out order, trip and invoice numbers…"] },
  { id: "logs", label: "Searching the logs", tools: ["search_logs", "SearchIndexTool", "CountTool", "ListIndexTool", "IndexMappingTool", "list_log_types", "login", "MsearchTool"],
    lines: ["Combing through the logs…", "Following the request trail…", "Lining up timestamps…", "Looking for the first error…"] },
  { id: "db", label: "Checking the database", tools: ["metabase_query", "metabase_tables"],
    lines: ["Checking the current state of the data…", "Cross-checking records in the database…", "Confirming what's still broken…"] },
  { id: "code", label: "Reading the code", tools: ["code_search", "code_read"],
    lines: ["Reading the code behind it…", "Finding the exact rule that fired…"] },
  { id: "past", label: "Comparing with past tickets", tools: ["similar_cases"],
    lines: ["Comparing with similar past tickets…"] },
  { id: "write", label: "Writing the RCA", tools: ["submit_rca", "propose_knowledge"],
    lines: ["Writing up the root cause…", "Adding the evidence and current status…"] },
];
const shortTool = (t: string | null) => (t || "").split("__").pop() || "";
const phaseOf = (tool: string | null) => PHASES.findIndex((p) => p.tools.includes(shortTool(tool)));

export function InvestigationProgress({ steps, startedAt }: { steps: Step[]; startedAt?: string }) {
  const calls = steps.filter((s) => s.kind === "tool_call");
  const latest = calls.length ? phaseOf(calls[calls.length - 1].tool) : -1;
  const current = latest < 0 ? 0 : latest;
  const reached = new Set([0, ...calls.map((c) => phaseOf(c.tool)).filter((i) => i >= 0)]);
  const counts = { logs: 0, db: 0, code: 0 };
  for (const c of calls) { const p = PHASES[phaseOf(c.tool)]?.id; if (p === "logs" || p === "db" || p === "code") counts[p]++; }
  const narration = [...steps].reverse().find((s) => s.kind === "text" && s.output?.trim())?.output;

  const [tick, setTick] = useState(0);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const t = setInterval(() => { setTick((n) => n + 1); setNow(Date.now()); }, 1000);
    return () => clearInterval(t);
  }, []);
  const lines = PHASES[current].lines;
  const headline = lines[Math.floor(tick / 4) % lines.length];
  const secs = startedAt && now ? Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000)) : tick;
  const elapsed = secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)} min ${String(secs % 60).padStart(2, "0")}s`;

  return (
    <div className="card overflow-hidden">
      <div className="relative bg-gradient-to-br from-[#0f5132] via-[#15803d] to-[#22a35a] px-5 py-5 text-white">
        <div className="ip-shimmer pointer-events-none absolute inset-0" aria-hidden />
        <div className="relative flex items-center gap-4">
          <div className="relative grid h-12 w-12 shrink-0 place-items-center" aria-hidden>
            <span className="ip-ring absolute inset-0 rounded-full border-2 border-white/40" />
            <span className="ip-ring absolute inset-0 rounded-full border-2 border-white/40" style={{ animationDelay: "1s" }} />
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium uppercase tracking-wide text-white/70">Investigating · {elapsed}</div>
            <div key={headline} className="ip-fade text-lg font-semibold">{headline}</div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 p-5 sm:grid-cols-[1fr_1.2fr]">
        <ol className="space-y-2.5 text-sm">
          {PHASES.map((p, i) => {
            const done = reached.has(i) && i !== current, now = i === current;
            return (
              <li key={p.id} className={`flex items-center gap-3 ${!reached.has(i) && !now ? "text-muted" : ""}`}>
                <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${now ? "bg-accent text-white" : done ? "bg-accent-soft text-accent-strong" : "bg-bg text-muted ring-1 ring-line"}`}>
                  {now ? <span className="ip-dot h-2 w-2 rounded-full bg-white" /> : done ? "✓" : i + 1}
                </span>
                <span className={now ? "font-medium" : ""}>{p.label}</span>
              </li>
            );
          })}
        </ol>
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 text-xs">
            {([[counts.logs, "log search", "log searches"], [counts.db, "database check", "database checks"], [counts.code, "code read", "code reads"]] as const).map(([n, one, many]) => (
              <span key={one} className="rounded-full bg-bg px-2.5 py-1 ring-1 ring-line"><b className="tabular-nums">{n}</b> {n === 1 ? one : many}</span>
            ))}
          </div>
          {narration && (
            <div className="rounded-xl bg-accent-soft/60 px-4 py-3 text-sm ring-1 ring-emerald-200">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-accent-strong">Latest from the agent</div>
              <div className="line-clamp-4"><Markdown compact>{hidePaths(narration)}</Markdown></div>
            </div>
          )}
          <p className="text-xs text-muted">This usually takes a few minutes. You can leave this page — you&apos;ll get a notification when the RCA is ready.</p>
        </div>
      </div>
    </div>
  );
}
