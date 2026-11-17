// Pointer handling for the floating AI window: a press on any part that is not interactive moves it, the eight grips (data-dir) resize it.
import { useRef, type MouseEvent, type PointerEvent as RPointerEvent } from "react";
import { clampRect, resizeRect, type Rect } from "../../core/ai/panelRect.ts";

// Things that keep their own behaviour. .ai-text is the words of a message or answer: a press there selects text.
const OWN = "button, a, input, textarea, select, label, summary, [role=slider], [role=separator], .ai-text";
const THRESHOLD = 4; // px a press must travel before it is a move, so a plain click never nudges the window

// A press on a scrollbar (the message area's own, or any inner one) scrolls; it must not move the window.
function onScrollbar(from: HTMLElement, stop: HTMLElement, x: number, y: number): boolean {
  for (let el: HTMLElement | null = from; el; el = el.parentElement) {
    const b = el.getBoundingClientRect(), sw = el.offsetWidth - el.clientWidth, sh = el.offsetHeight - el.clientHeight;
    if ((sw > 4 && x >= b.right - sw) || (sh > 4 && y >= b.bottom - sh)) return true;
    if (el === stop) break;
  }
  return false;
}

export function useAiDrag(rect: Rect, keep: (r: Rect | null) => void) {
  const drag = useRef<{ dir: string; x: number; y: number; r: Rect; live: boolean } | null>(null);
  const end = (e: RPointerEvent<HTMLElement>) => { drag.current = null; delete e.currentTarget.dataset.dragging; };
  return {
    onPointerDown: (e: RPointerEvent<HTMLElement>) => {
      if (e.button !== 0) return;
      const t = e.target as HTMLElement;
      const dir = t.dataset.dir ?? (t.closest(OWN) || onScrollbar(t, e.currentTarget, e.clientX, e.clientY) ? null : "move");
      if (!dir) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drag.current = { dir, x: e.clientX, y: e.clientY, r: rect, live: dir !== "move" };
    },
    onPointerMove: (e: RPointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y, vw = window.innerWidth, vh = window.innerHeight;
      if (!d.live) {
        if (Math.hypot(dx, dy) < THRESHOLD) return;
        d.live = true;
        e.currentTarget.dataset.dragging = "1";
      }
      keep(d.dir === "move" ? clampRect({ ...d.r, x: d.r.x + dx, y: d.r.y + dy }, vw, vh) : resizeRect(d.r, d.dir, dx, dy, vw, vh));
    },
    onPointerUp: end,
    onPointerCancel: end,
    onDoubleClick: (e: MouseEvent<HTMLElement>) => { const t = e.target as HTMLElement; if (!t.closest(OWN) && !onScrollbar(t, e.currentTarget, e.clientX, e.clientY)) keep(null); },
  };
}
