"use client";
import { useEffect } from "react";

/**
 * If the backend ever answers 401 "Sign in required" (session expired, ended by an admin, account disabled),
 * go to the login page — and come back to the same page afterwards. Watches every fetch the app makes.
 * Also tells the backend how long ago the person last used the page (x-dr-idle-ms), so an open tab's background
 * checks don't keep the session alive: after 12 hours without a click, key or scroll, the next check signs them out.
 */
export function AuthGuard() {
  useEffect(() => {
    const w = window as Window & { __drFetchGuard?: boolean };
    if (w.__drFetchGuard) return;
    w.__drFetchGuard = true;
    let lastUse = Date.now(); // opening a page counts as using it
    const used = () => { lastUse = Date.now(); };
    for (const e of ["pointerdown", "keydown", "wheel", "touchstart", "scroll"]) window.addEventListener(e, used, { passive: true, capture: true });
    let lastMove = 0;
    window.addEventListener("mousemove", () => { if (Date.now() - lastMove > 30_000) { lastMove = Date.now(); used(); } }, { passive: true });
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const target = new URL(url, window.location.origin);
      const path = target.pathname;
      if (target.origin === window.location.origin && path.startsWith("/api/")) {
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        headers.set("x-dr-idle-ms", String(Date.now() - lastUse));
        init = { ...init, headers };
      }
      const res = await original(input, init);
      if (res.status === 401 && path.startsWith("/api/") && !path.startsWith("/api/auth/") && window.location.pathname !== "/login") {
        const next = window.location.pathname + window.location.search;
        window.location.replace(`/login?ended=1&next=${encodeURIComponent(next)}`);
      }
      return res;
    };
  }, []);
  return null;
}
