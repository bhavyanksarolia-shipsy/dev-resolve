import "server-only";
import { getConnectionProjects } from "./config";

/**
 * Metabase query limits per person and Metabase (our own 120/hour, or Metabase itself refusing). While one is in
 * effect, investigations and chat replies that need that Metabase don't run — they'd only make Claude retry and wait.
 * Short per-minute limits never get here: the Metabase tool waits those out by itself (no Claude tokens spent).
 */
interface Limit { until: number; message: string }
const g = globalThis as unknown as { drMbLimits?: Map<string, Limit> };
const limits = (g.drMbLimits ??= new Map<string, Limit>());
const key = (user: string | null | undefined, project: string) => `${user || ""}|${project}`;

export function noteMetabaseLimit(user: string | null | undefined, project: string, until: number, message: string) {
  limits.set(key(user, project), { until, message });
  console.warn(`[metabase] query limit reached (${project}) until ${new Date(until).toISOString()}`);
}

/** The limit in effect for this person and Metabase, if any. */
export function metabaseLimit(user: string | null | undefined, project: string | null | undefined): (Limit & { minutes: number; at: string }) | null {
  if (!project) return null;
  const l = limits.get(key(user, project));
  if (!l || l.until <= Date.now()) return null;
  return { ...l, minutes: Math.max(1, Math.round((l.until - Date.now()) / 60_000)),
    at: new Date(l.until).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" }) };
}

/** How people know this Metabase ("Bi Neo", "QC"). */
export const metabaseName = (project: string) => getConnectionProjects()[project]?.metabase?.display_name || project;

/** "…limit reached for QC — it resets at 4:30 pm (in 25 min). Start it again after that." */
export function metabaseLimitError(user: string | null | undefined, project: string | null | undefined, what: string, name?: string) {
  const l = metabaseLimit(user, project);
  return l ? `Your Metabase query limit for ${name || project} is reached — it resets at ${l.at} (in ${l.minutes} min). ${what} after that.` : null;
}

/** Read the Metabase tool's "METABASE_LIMIT_UNTIL=<epoch> project=<p> — <message>" line, if the output has one. */
export function parseMetabaseLimit(out: string): { until: number; project: string; message: string } | null {
  const m = out.match(/METABASE_LIMIT_UNTIL=(\d+) project=(\S+) — ([^\n]+)/);
  return m ? { until: Number(m[1]) * 1000, project: m[2], message: m[3] } : null;
}
