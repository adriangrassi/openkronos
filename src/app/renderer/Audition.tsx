// Audition toggle: with it on, selecting a Program or Combi calls it up on the keyboard and plays a short phrase.
import { useEffect, useRef, useState } from "react";
import type { BankInfo } from "../../core/pcg/library.ts";
import { modeBytes, MidiPlayer, selectBytes, type PlayClock } from "../../core/midi/player.ts";
import { autoPhrase, phrase, type PhraseKind } from "../../core/midi/phrases.ts";
import { describeError, type Link } from "./keyboard.ts";
import "./Audition.css";

interface Props {
  link: Link | null;
  info: BankInfo | null;
  sel: number[];
  name: string;
  onError: (msg: string | null) => void;
  ask: (message: string, okLabel: string, run: () => void | Promise<void>) => void;
}

const clock: PlayClock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id),
};
const DEBOUNCE_MS = 120;
// shortcut: 300 ms for the keyboard to load the sound, a guess until timed on the real Kronos
const LEAD_MS = 300;

export function Audition({ link, info, sel, name, onError, ask }: Props) {
  const [on, setOn] = useState(true); // the owner's choice; it only acts while a keyboard is linked
  const active = on && !!link;
  const [choice, setChoice] = useState<"none" | "auto" | PhraseKind>("none");
  const confirmed = useRef(true); // on by default, so the first-time confirm never applies
  const player = useRef<MidiPlayer | null>(null);
  const timer = useRef(0);
  const lastKind = useRef<string | null>(null);
  const live = useRef({ link, info, sel, name, choice, onError });
  live.current = { link, info, sel, name, choice, onError };

  const playable = !!info && (info.kind === "program" || info.kind === "combi") && sel.length === 1;
  const selection = playable ? `${info.key}/${sel[0]}` : null;

  function silence() {
    window.clearTimeout(timer.current);
    player.current?.stop();
    const l = live.current.link;
    if (!l) return;
    try {
      for (const cc of [64, 123]) l.send(Uint8Array.of(0xb0 | l.channel, cc, 0));
    } catch {
      // the link is already gone; nothing is sounding
    }
  }

  function play() {
    // A busy renderer can run the timer between two quick key presses; wait until the queued input has been handled.
    if ((navigator as { scheduling?: { isInputPending?: () => boolean } }).scheduling?.isInputPending?.()) {
      timer.current = window.setTimeout(play, 20);
      return;
    }
    const { link: l, info: i, sel: s, name: n, choice: c } = live.current;
    if (!l || !i || (i.kind !== "program" && i.kind !== "combi") || s.length !== 1) return;
    try {
      silence();
      if (lastKind.current !== i.kind) l.send(modeBytes(i.kind, l.channel));
      lastKind.current = i.kind;
      for (const b of selectBytes(i.key, s[0], l.channel)) l.send(b);
      if (c === "none") return;
      player.current ??= new MidiPlayer((m) => live.current.link?.send(m), clock);
      const ev = phrase(c === "auto" ? autoPhrase(n) : c, l.channel).map((e) => ({ ...e, ms: e.ms + LEAD_MS }));
      player.current.play(ev, { channel: null });
    } catch (e) {
      live.current.onError(describeError(e));
    }
  }

  useEffect(() => {
    if (!active) return;
    lastKind.current = null;
    const blur = () => silence();
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("blur", blur);
      silence();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Only a change of selection triggers it; turning it on does not touch the keyboard.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (!active || !selection) return;
    silence(); // stop the old phrase at once; the new sound waits out the debounce
    timer.current = window.setTimeout(play, DEBOUNCE_MS);
    return () => window.clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  function toggle() {
    if (active) return setOn(false);
    if (confirmed.current) return setOn(true);
    ask(
      "Audition calls each sound you select up on the keyboard, which replaces its edit buffer. Unsaved edits on the keyboard are lost. Turn it on?",
      "Turn on",
      () => {
        confirmed.current = true;
        setOn(true);
      },
    );
  }

  return (
    <span className="audition">
      <label>
        <input type="checkbox" data-testid="audition-toggle" checked={active} disabled={!link} onChange={toggle} /> Audition
      </label>
      <select data-testid="audition-phrase" aria-label="Audition phrase" value={choice} onChange={(e) => setChoice(e.target.value as "none" | "auto" | PhraseKind)}>
        <option value="none">no sample</option>
        {["auto", "chord", "arpeggio", "bass", "lead", "drums"].map((k) => <option key={k} value={k}>{k}</option>)}
      </select>
    </span>
  );
}
