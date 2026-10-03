"use client";
import { useSyncExternalStore } from "react";

/**
 * The signed-in person's Pod scope (header picker). [] = all Pods. Tickets with no Pod are ALWAYS in scope, so
 * new / untriaged tickets reach everyone. Kept in localStorage for an instant first paint, saved on the server.
 */
let pods: string[] = [];
let loaded = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const KEY = "dr_pods";

function init() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try { pods = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { pods = []; }
  fetch("/api/me/pods", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((d) => {
    if (d && JSON.stringify(d.pods) !== JSON.stringify(pods)) { pods = d.pods; try { localStorage.setItem(KEY, JSON.stringify(pods)); } catch {} emit(); }
  }).catch(() => {});
}

export function setPodScope(next: string[]) {
  pods = next;
  try { localStorage.setItem(KEY, JSON.stringify(pods)); } catch {}
  emit();
  void fetch("/api/me/pods", { method: "POST", body: JSON.stringify({ pods: next }) }).catch(() => {});
}

const EMPTY: string[] = [];
export function usePodScope(): string[] {
  return useSyncExternalStore(
    (l) => { init(); listeners.add(l); return () => listeners.delete(l); },
    () => pods,
    () => EMPTY,
  );
}

/** Is a ticket with this Pod visible under the scope? (no Pod = always) */
export const inPodScope = (scope: string[], pod: string | null | undefined) => !scope.length || !pod || scope.includes(pod);
