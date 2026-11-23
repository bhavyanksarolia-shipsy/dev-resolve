import "server-only";

/**
 * Runs someone stopped (Stop button, admin stop/dequeue). Kept for the whole life of the run — not just while an
 * AbortController happens to be registered — so a stop that lands during setup (reading the ticket, attachments,
 * app-log login, before the agent starts) is not lost. Without this, the stop freed the one-run-per-ticket lock but
 * the run carried on, and its submit_rca overwrote "failed" and posted an RCA (TKT-118777 #372, 23-Nov-2026).
 *
 * Cleared when the run ends, and when a new chat turn starts on the same investigation id.
 */
const stopped = new Set<number>();

export const markStopped = (id: number) => void stopped.add(id);
export const isStopped = (id: number) => stopped.has(id);
export const clearStopped = (id: number) => void stopped.delete(id);
