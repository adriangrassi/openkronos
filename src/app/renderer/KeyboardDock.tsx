// The dock's on-screen keyboard: 88 keys (A0..C8), mouse and computer-keyboard playing, and the controls.
// Unmounting releases every held note, which is how a tab change or a collapse silences the keys.
import { useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { noteName } from "../../core/ai/intent.ts";
import type { Link } from "./keyboard.ts";
import { coalescedSender, masterVolumeMessage } from "../../core/midi/masterVolume.ts";
import { isHeldIn, midiVersion, subscribeMidi } from "./midi-tap.ts";

export interface DockControls {
  octave: number; // -3..+3
  velocity: number; // computer-keyboard velocity, 1..127
  sustain: boolean;
  mod: number;
  pitch: number; // -8192..8191
  volume: number; // Master Volume as shown, 0..127; the Kronos does not report its own
}

export const START_CONTROLS: DockControls = { octave: 0, velocity: 100, sustain: false, mod: 0, pitch: 0, volume: 127 };
const NEUTRAL = { sustain: false, mod: 0, pitch: 0 };

const LOW = 21;
const HIGH = 108;
const ALL_KEYS = Array.from({ length: HIGH - LOW + 1 }, (_, i) => LOW + i);
const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);
const isBlack = (n: number): boolean => BLACK_PITCH_CLASSES.has(n % 12);
const WHITE_KEYS = ALL_KEYS.filter((n) => !isBlack(n));
const BLACK_KEYS = ALL_KEYS.filter(isBlack);

// Computer keys by physical position (event.code): row one from C3, row two from C4.
const ROW_ONE = ["KeyZ", "KeyS", "KeyX", "KeyD", "KeyC", "KeyV", "KeyG", "KeyB", "KeyH", "KeyN", "KeyJ", "KeyM"];
const ROW_TWO = ["KeyQ", "Digit2", "KeyW", "Digit3", "KeyE", "KeyR", "Digit5", "KeyT", "Digit6", "KeyY", "Digit7", "KeyU"];
const COMPUTER_NOTE = new Map<string, number>([
  ...ROW_ONE.map((code, i): [string, number] => [code, 48 + i]),
  ...ROW_TWO.map((code, i): [string, number] => [code, 60 + i]),
]);

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

// Text fields take the keys; sliders, checkboxes and buttons do not.
function typing(): boolean {
  const t = document.activeElement;
  if (t instanceof HTMLInputElement) return !["range", "checkbox", "button", "radio"].includes(t.type);
  return t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement || (t instanceof HTMLElement && t.isContentEditable);
}

interface Props {
  link: Link | null;
  ctrl: DockControls;
  onCtrl: (patch: Partial<DockControls>) => void;
  globalChannel?: number; // the Global MIDI Channel of the open file, 0..15
  extraChannels?: number[]; // a Combi's timbres on their own channels hear a note only there; notes also go out on these (raw 0..15)
}

export function KeyboardDock({ link, ctrl, onCtrl, globalChannel = 0, extraChannels }: Props) {
  useSyncExternalStore(subscribeMidi, midiVersion);
  const linkRef = useRef(link);
  linkRef.current = link;
  const ctrlRef = useRef(ctrl);
  ctrlRef.current = ctrl;
  const onCtrlRef = useRef(onCtrl);
  onCtrlRef.current = onCtrl;
  const gchRef = useRef(globalChannel);
  gchRef.current = globalChannel;
  const extraRef = useRef(extraChannels);
  extraRef.current = extraChannels;
  const noteOn = (l: Link, status: number, n: number, v: number) => { for (const ch of new Set([l.channel, ...(extraRef.current ?? [])])) l.send(Uint8Array.from([status | ch, n, v])); };
  // 7-bit UI value v to 14-bit v*129, so 0 -> 0 and 127 -> 16383 exactly.
  const volumeSend = useRef(coalescedSender((v) => { linkRef.current?.send(masterVolumeMessage(v * 129, gchRef.current)); if (gchRef.current !== 0x7f) linkRef.current?.send(masterVolumeMessage(v * 129, 0x7f)); }));
  useEffect(() => () => volumeSend.current.flush(), []);
  // Source (mouse, or a computer key code) to the note it holds.
  const held = useRef(new Map<string, number>());
  const [down, setDown] = useState<number[]>([]);

  const sounding = (n: number): boolean => [...held.current.values()].includes(n);
  const refresh = () => setDown([...new Set(held.current.values())]);

  // A note already sounding from another source is not sent twice.
  function press(l: Link, src: string, n: number, vel: number): void {
    if (n < 0 || n > 127 || held.current.has(src)) return;
    const already = sounding(n);
    held.current.set(src, n);
    if (!already) noteOn(l, 0x90, n, vel);
    refresh();
  }

  function release(l: Link, src: string): void {
    const n = held.current.get(src);
    if (n === undefined) return;
    held.current.delete(src);
    if (!sounding(n)) noteOn(l, 0x80, n, 0);
    refresh();
  }

  function releaseAll(l: Link): void {
    for (const src of [...held.current.keys()]) release(l, src);
  }

  function sendControls(l: Link, c: Pick<DockControls, "sustain" | "mod" | "pitch">): void {
    l.send(Uint8Array.from([0xb0 | l.channel, 64, c.sustain ? 127 : 0]));
    l.send(Uint8Array.from([0xb0 | l.channel, 1, c.mod]));
    const u = c.pitch + 8192;
    l.send(Uint8Array.from([0xe0 | l.channel, u & 0x7f, u >> 7]));
  }

  // Silences the keyboard: releases held notes and puts sustain, mod and pitch back to neutral, on the wire and in the controls.
  // shortcut: a tab change also resets mod and pitch (the keys unmount), upgrade by keeping them in the parent store.
  function silence(l: Link): void {
    releaseAll(l);
    const c = ctrlRef.current;
    if (!c.sustain && !c.mod && !c.pitch) return;
    sendControls(l, NEUTRAL);
    ctrlRef.current = { ...c, ...NEUTRAL };
    onCtrlRef.current(NEUTRAL);
  }

  // Runs on a link change and on unmount. A new link gets the controls as the UI shows them.
  useEffect(() => {
    if (!link) return;
    const c = ctrlRef.current;
    if (c.sustain || c.mod || c.pitch) sendControls(link, c);
    return () => silence(link);
  }, [link]);

  // Handlers read the link and controls through refs, so they are attached once.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Ctrl, Meta and Alt chords (Ctrl+Z, Ctrl+- zoom) are the app's or the OS's, not notes.
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || typing()) return;
      if (e.code === "Minus" || e.code === "Equal") {
        const next = clamp(ctrlRef.current.octave + (e.code === "Equal" ? 1 : -1), -3, 3);
        ctrlRef.current = { ...ctrlRef.current, octave: next };
        onCtrl({ octave: next });
        return;
      }
      const base = COMPUTER_NOTE.get(e.code);
      const l = linkRef.current;
      if (base === undefined || !l) return;
      press(l, e.code, base + 12 * ctrlRef.current.octave, ctrlRef.current.velocity);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const l = linkRef.current;
      if (l && COMPUTER_NOTE.has(e.code)) release(l, e.code);
    };
    const onPointerUp = () => {
      const l = linkRef.current;
      if (l) release(l, "mouse");
    };
    const onBlur = () => {
      const l = linkRef.current;
      if (l) silence(l);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  // The pitch wheel springs back to centre when released, as on a hardware keyboard.
  function springPitch(): void {
    const l = linkRef.current;
    if (ctrlRef.current.pitch === 0) return;
    ctrlRef.current = { ...ctrlRef.current, pitch: 0 };
    onCtrl({ pitch: 0 });
    if (l) l.send(Uint8Array.from([0xe0 | l.channel, 0, 0x40]));
  }

  function sendCc(cc: number, v: number): void {
    const l = linkRef.current;
    if (l) l.send(Uint8Array.from([0xb0 | l.channel, cc, v]));
  }

  // Lower on the key is harder: velocity 1 at the top edge, 127 at the bottom.
  function mouseDown(e: ReactPointerEvent<HTMLButtonElement>, n: number): void {
    // Shift-click names the key for whichever text box was being typed in (the AI prompt); it does not play.
    if (e.shiftKey) { window.dispatchEvent(new CustomEvent("kronos-key-name", { detail: { name: noteName(n), note: n } })); return; }
    const l = linkRef.current;
    if (!l) return;
    const r = e.currentTarget.getBoundingClientRect();
    const f = clamp((e.clientY - r.top) / r.height, 0, 1);
    press(l, "mouse", n, clamp(Math.round(1 + 126 * f), 1, 127));
  }

  const keyEl = (n: number, style?: CSSProperties) => (
    <button
      key={n}
      type="button"
      tabIndex={-1}
      className={`dock-key ${isBlack(n) ? "black" : "white"}`}
      style={style}
      data-testid={`dock-key-${n}`}
      data-lit={isHeldIn(n) ? "1" : "0"}
      data-down={down.includes(n) ? "1" : "0"}
      aria-label={`key ${n}`}
      onPointerDown={(e) => mouseDown(e, n)}
    />
  );

  // A black key sits on the seam to its right-hand neighbour's left edge, using whole-key percentages.
  const whiteWidth = 100 / WHITE_KEYS.length;
  const blackStyle = (n: number): CSSProperties => {
    const whitesBelow = WHITE_KEYS.filter((w) => w < n).length;
    return { left: `${whitesBelow * whiteWidth - whiteWidth * 0.3}%`, width: `${whiteWidth * 0.6}%` };
  };

  const octave = ctrl.octave > 0 ? `+${ctrl.octave}` : String(ctrl.octave);

  return (
    <div className="kd">
      <div className="kd-controls">
        <button
          type="button"
          data-testid="dock-sustain"
          aria-pressed={ctrl.sustain}
          onClick={() => {
            const on = !ctrl.sustain;
            onCtrl({ sustain: on });
            sendCc(64, on ? 127 : 0);
          }}
        >
          Sustain
        </button>
        <label>
          Velocity
          <input type="range" data-testid="dock-velocity" min={1} max={127} value={ctrl.velocity} onChange={(e) => onCtrl({ velocity: Number(e.target.value) })} />
        </label>
        <label>
          Mod
          <input
            type="range"
            data-testid="dock-mod"
            min={0}
            max={127}
            value={ctrl.mod}
            onChange={(e) => {
              const v = Number(e.target.value);
              onCtrl({ mod: v });
              sendCc(1, v);
            }}
          />
        </label>
        <label>
          Pitch
          <input
            type="range"
            data-testid="dock-pitch"
            min={-8192}
            max={8191}
            value={ctrl.pitch}
            onPointerUp={springPitch}
            onPointerCancel={springPitch}
            onChange={(e) => {
              const v = Number(e.target.value);
              onCtrl({ pitch: v });
              const l = linkRef.current;
              const u = v + 8192;
              if (l) l.send(Uint8Array.from([0xe0 | l.channel, u & 0x7f, u >> 7]));
            }}
          />
        </label>
        <label title={link ? "Sets the master level; the Kronos does not report its current level" : "Connect the Kronos first"}>
          Volume
          <input
            type="range"
            data-testid="dock-volume"
            min={0}
            max={127}
            value={ctrl.volume}
            disabled={!link}
            onPointerUp={() => volumeSend.current.flush()}
            onChange={(e) => {
              const v = Number(e.target.value);
              onCtrl({ volume: v });
              volumeSend.current.set(v);
            }}
          />
          <span data-testid="dock-volume-value">{ctrl.volume}</span>
        </label>
        <span className="kd-octave">
          Octave <span data-testid="dock-octave">{octave}</span>
        </span>
      </div>
      <div className="kd-keys">
        {WHITE_KEYS.map((n) => keyEl(n))}
        {BLACK_KEYS.map((n) => keyEl(n, blackStyle(n)))}
      </div>
    </div>
  );
}
