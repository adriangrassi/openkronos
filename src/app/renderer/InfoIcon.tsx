// A small round "i" next to a control that shows what the parameter does, from KORG's Parameter Guide (help.json, built from the owner's private copy: no file, no icons).
// It never takes focus from the control beside it with the mouse, swallows the keys it uses, and changes no value.
import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { Row } from "../../core/params/params.ts";
import { helpFor, setHelpData, type Help, type HelpModeArg } from "../../core/pages/help.ts";
import type { HelpData } from "../../core/pages/helpParse.ts";
import { keyOf } from "../../core/pages/view.ts";
import "./InfoIcon.css";

// What the controls below it are: the editor mode and, where the view has one, the tab id.
export const HelpScope = createContext<{ mode: HelpModeArg; tab?: string } | null>(null);

let version = 0;
let started = false;
const subs = new Set<() => void>();
const subscribe = (f: () => void) => {
  subs.add(f);
  if (!started) {
    started = true;
    import("../../generated/help.json").then((m) => {
      setHelpData(m.default as unknown as HelpData);
      version++;
      subs.forEach((s) => s());
    }, () => {});
  }
  return () => void subs.delete(f);
};

export function InfoIcon({ r, label }: { r: Row; label?: string }) {
  const scope = useContext(HelpScope);
  useSyncExternalStore(subscribe, () => version);
  const help = scope ? helpFor(scope.mode, scope.tab, r, label) : null;
  return help ? <Bubble id={keyOf(r)} name={label?.replace(/\s*:\s*$/, "") || r.name} help={help} /> : null;
}

const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();

function Bubble({ id, name, help }: { id: string; name: string; help: Help }) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const uid = useId();
  const open = hover || focus || pinned;
  const close = () => { setHover(false); setFocus(false); setPinned(false); };

  // Below the icon, centred, kept inside the window; above it when there is no room below.
  useLayoutEffect(() => {
    if (!open || !btn.current || !pop.current) return setPos(null);
    const b = btn.current.getBoundingClientRect();
    const p = pop.current.getBoundingClientRect();
    const left = Math.max(6, Math.min(b.left + b.width / 2 - p.width / 2, window.innerWidth - p.width - 6));
    const below = b.bottom + 6;
    setPos({ left, top: Math.max(6, below + p.height > window.innerHeight - 6 ? b.top - 6 - p.height : below) });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(); } };
    const down = (e: PointerEvent) => { if (!btn.current?.contains(e.target as Node) && !pop.current?.contains(e.target as Node)) close(); };
    document.addEventListener("keydown", key, true);
    document.addEventListener("pointerdown", down, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("keydown", key, true);
      document.removeEventListener("pointerdown", down, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  // The popover joins the Kronos view's element so it wears that skin's --k-* variables.
  const host = btn.current?.closest<HTMLElement>(".kv") ?? document.body;
  return (
    <>
      <button
        ref={btn}
        type="button"
        className="info-btn"
        data-testid={`help-${id}`}
        aria-label={`What is ${name}?`}
        aria-expanded={open}
        aria-describedby={open ? uid : undefined}
        onPointerDown={stop}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => { e.stopPropagation(); setPinned((p) => !p); setHover(false); }}
        onDoubleClick={stop}
        onKeyDown={(e) => { if (e.key !== "Tab" && e.key !== "Escape") e.stopPropagation(); }}
        onKeyUp={stop}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onFocus={() => setFocus(true)}
        onBlur={() => setFocus(false)}
      >
        i
      </button>
      {open && createPortal(
        <div ref={pop} id={uid} role="tooltip" className="info-pop" data-testid={`help-pop-${id}`} style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}>
          <p className="info-text">{help.text}</p>
          <p className="info-src">Parameter Guide p.{help.page}</p>
        </div>,
        host,
      )}
    </>
  );
}
