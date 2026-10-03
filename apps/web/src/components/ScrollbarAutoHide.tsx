"use client";
import { useEffect } from "react";

/**
 * Native scrollbars are hidden everywhere (globals.css) so nothing reserves space. While something scrolls — the
 * page, a column, a menu, a wide table — a thin thumb is drawn over its edge (vertical and/or horizontal) and fades
 * out ~0.9 s after scrolling stops.
 */
export function ScrollbarAutoHide() {
  useEffect(() => {
    const mk = () => { const d = document.createElement("div"); d.className = "sb-thumb"; document.body.appendChild(d); return d; };
    const v = mk(), h = mk();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const last = new WeakMap<Element, { x: number; y: number }>(); // show only the axis that actually moved
    const onScroll = (e: Event) => {
      const el = (e.target === document ? document.documentElement : e.target) as HTMLElement;
      if (!(el instanceof HTMLElement)) return;
      const root = el === document.documentElement;
      const r = root ? { top: 0, left: 0, width: window.innerWidth, height: window.innerHeight } : el.getBoundingClientRect();
      const pad = 2, size = 5;
      const prev = last.get(el);
      last.set(el, { x: el.scrollLeft, y: el.scrollTop });
      const movedY = !prev || prev.y !== el.scrollTop, movedX = !!prev && prev.x !== el.scrollLeft;
      // vertical
      if (movedY && el.scrollHeight > el.clientHeight + 1) {
        const track = r.height - pad * 2;
        const len = Math.max(28, (el.clientHeight / el.scrollHeight) * track);
        const pos = (el.scrollTop / (el.scrollHeight - el.clientHeight)) * (track - len);
        Object.assign(v.style, { top: `${r.top + pad + pos}px`, left: `${r.left + r.width - size - pad}px`, width: `${size}px`, height: `${len}px` });
        v.classList.add("on");
      }
      // horizontal
      if (movedX && el.scrollWidth > el.clientWidth + 1) {
        const track = r.width - pad * 2;
        const len = Math.max(28, (el.clientWidth / el.scrollWidth) * track);
        const pos = (el.scrollLeft / (el.scrollWidth - el.clientWidth)) * (track - len);
        Object.assign(h.style, { left: `${r.left + pad + pos}px`, top: `${r.top + r.height - size - pad}px`, height: `${size}px`, width: `${len}px` });
        h.classList.add("on");
      }
      clearTimeout(timer);
      timer = setTimeout(() => { v.classList.remove("on"); h.classList.remove("on"); }, 900);
    };
    document.addEventListener("scroll", onScroll, { capture: true, passive: true });
    return () => { document.removeEventListener("scroll", onScroll, { capture: true }); clearTimeout(timer); v.remove(); h.remove(); };
  }, []);
  return null;
}
