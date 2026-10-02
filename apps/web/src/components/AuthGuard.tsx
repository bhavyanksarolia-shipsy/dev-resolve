"use client";
import { useEffect } from "react";

/**
 * If the backend ever answers 401 "Sign in required" (session expired, ended by an admin, account disabled),
 * go to the login page — and come back to the same page afterwards. Watches every fetch the app makes.
 */
export function AuthGuard() {
  useEffect(() => {
    const w = window as Window & { __drFetchGuard?: boolean };
    if (w.__drFetchGuard) return;
    w.__drFetchGuard = true;
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const res = await original(input, init);
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url, window.location.origin).pathname;
      if (res.status === 401 && path.startsWith("/api/") && !path.startsWith("/api/auth/") && window.location.pathname !== "/login") {
        const next = window.location.pathname + window.location.search;
        window.location.replace(`/login?next=${encodeURIComponent(next)}`);
      }
      return res;
    };
  }, []);
  return null;
}
