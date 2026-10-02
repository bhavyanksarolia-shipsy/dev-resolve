"use client";
import { useEffect } from "react";

/**
 * Scrollbars everywhere are invisible until something scrolls: the element being scrolled gets `is-scrolling`
 * for a moment (see globals.css), so its thumb shows while you scroll and fades out shortly after.
 */
export function ScrollbarAutoHide() {
  useEffect(() => {
    const timers = new Map<Element, ReturnType<typeof setTimeout>>();
    const onScroll = (e: Event) => {
      const el = e.target === document ? document.documentElement : (e.target as Element);
      if (!(el instanceof Element)) return;
      el.classList.add("is-scrolling");
      clearTimeout(timers.get(el));
      timers.set(el, setTimeout(() => { el.classList.remove("is-scrolling"); timers.delete(el); }, 900));
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => {
      document.removeEventListener("scroll", onScroll, { capture: true });
      timers.forEach((t) => clearTimeout(t));
    };
  }, []);
  return null;
}
