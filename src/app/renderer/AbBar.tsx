// A/B compare bar: sends a sound's state before and after the edits to the keyboard's edit buffer and loops one phrase over both. Nothing is stored.
import { useEffect, useRef, useState } from "react";
import { categoryLabel, categoryNames, categoryRow, type Engine } from "../../core/pcg/catalog.ts";
import { getEntry } from "../../core/pcg/library.ts";
import { pushCurrentBytes } from "../../core/device/sync.ts";
import { readParam, type ParamTables } from "../../core/params/params.ts";
import { abPlan, AB_CHOICES, nextVariant, type AbChoice, type AbPlan } from "../../core/midi/ab.ts";
import { modeBytes, MidiPlayer, selectBytes, type PlayClock } from "../../core/midi/player.ts";
import type { Workspace } from "./document.ts";
import { describeError, type Link } from "./keyboard.ts";
import "./Audition.css";

export type AbTarget = { key: string; index: number; before: Uint8Array; source: string; origin: "ai" | "guide" | "editor" };
type Side = "A" | "B";

interface Props {
  ws: Workspace;
  link: Link | null;
  tables: ParamTables | null;
  target: AbTarget;
  why: string | null; // why the bar cannot talk to the keyboard right now, if it cannot
  onError: (msg: string | null) => void;
  onClose: () => void;
}

const clock: PlayClock = { now: () => performance.now(), setTimeout: (fn, ms) => window.setTimeout(fn, ms), clearTimeout: (id) => window.clearTimeout(id) };
// shortcut: 300 ms for the keyboard to take the new edit buffer, the same guess Audition uses until timed on the real Kronos
const LEAD_MS = 500;
const SELECT_SETTLE_MS = 600;
const LABEL: Record<Side, string> = { A: "A: before", B: "B: after" };

// Why a launcher button is off; one place so the three buttons and the bar agree.
export function abWhy(link: Link | null, busy: boolean): string | null {
  if (!link) return "Connect the Kronos first";
  if (busy) return "The keyboard link is busy with a transfer";
  if (localStorage.getItem("kronos.live.on") === "0") return "Turn Live on first: A/B sends to the edit buffer the way Live does";
  return null;
}

export const isBlank = (b: Uint8Array): boolean => b.every((x) => x === 0);
export const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

export function AbBar({ ws, link, tables, target, why, onError, onClose }: Props) {
  const { key, index, before } = target;
  const [loaded, setLoaded] = useState<Side | null>(null);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [choice, setChoice] = useState<AbChoice>("auto");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [plan, setPlan] = useState<AbPlan | null>(null);
  const player = useRef<MidiPlayer | null>(null);
  const timer = useRef(0);
  const touched = useRef(false); // something was sent to the edit buffer, so it must be put back
  const closed = useRef(false);
  const live = useRef({ link, why, loop });
  live.current = { link, why, loop };
  const kind = ws.info(key).kind === "combi" ? "combi" : "program";
  const off = why !== null || loading;

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

  // B is always the document as it is now, read at send time, so edits made while the bar is open are heard.
  async function load(s: Side): Promise<boolean> {
    const l = live.current.link;
    if (!l) return false;
    silence();
    setLoading(true);
    try {
      if (!touched.current) {
        l.send(modeBytes(kind, l.channel));
        for (const b of selectBytes(key, index, l.channel)) l.send(b);
      }
      const first = !touched.current;
      touched.current = true;
      if (first) await new Promise((r) => window.setTimeout(r, SELECT_SETTLE_MS)); // the select reloads the stored program and would overwrite the dump
      await pushCurrentBytes(l.client, ws.file, key, s === "A" ? before : getEntry(ws.file, key, index));
      setLoaded(s);
      if (err) onError(null);
      setErr("");
      return true;
    } catch (e) {
      const m = describeError(e);
      setErr(m);
      onError(m);
      return false;
    } finally {
      setLoading(false);
    }
  }

  function begin(p: AbPlan, pos: number) {
    player.current ??= new MidiPlayer((m) => live.current.link?.send(m), clock);
    setPlaying(true);
    timer.current = window.setTimeout(() => player.current?.play(p.events, { channel: null, tempo: p.tempo, loop: live.current.loop, startMs: pos, onEnd: () => setPlaying(false) }), LEAD_MS);
  }

  // Each press from stopped rotates to the next variant; A and B share the plan made here.
  function fresh(c: AbChoice): AbPlan {
    const l = live.current.link!;
    const cur = getEntry(ws.file, key, index);
    const info = ws.info(key);
    const engine: Engine | null = kind === "combi" ? null : info.type === "hd1" ? "HD-1" : "EXi";
    let category = "";
    if (tables) category = categoryLabel(categoryNames(ws.file, tables, kind), readParam(cur, categoryRow(tables, kind, engine)));
    const again = plan !== null && (c === "auto" || plan.kind === c);
    const p = abPlan({ name: ws.nameOf(key, index), category, engine, kind: c, channel: l.channel, variant: again ? nextVariant(plan.variant) : undefined });
    setPlan(p);
    return p;
  }

  async function play(c: AbChoice = choice) {
    if (off || !live.current.link) return;
    const p = fresh(c);
    if (!(await load(loaded ?? "A"))) return setPlaying(false);
    begin(p, 0);
  }

  async function press(s: Side) {
    if (off || (s === loaded && !playing)) return;
    const pos = playing ? (player.current?.positionMs() ?? 0) : 0;
    if (!(await load(s))) return setPlaying(false);
    if (playing && plan) begin(plan, pos);
  }

  function stop() {
    silence();
    setPlaying(false);
  }

  // Puts the document's current state back, so the keyboard matches the screen. Failures show the normal error text.
  async function restore() {
    const l = live.current.link;
    if (!touched.current || !l || live.current.why !== null) return;
    try {
      await pushCurrentBytes(l.client, ws.file, key, getEntry(ws.file, key, index));
    } catch (e) {
      onError(`${describeError(e)} The keyboard may not match the screen: open the sound again.`);
    }
  }

  async function close() {
    silence();
    setPlaying(false);
    closed.current = true;
    await restore();
    onClose();
  }

  // Leaving the sound or the app drops the bar without close(): same cleanup.
  useEffect(() => () => {
    silence();
    if (!closed.current) void restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // A transfer or a lost link ends the phrase; nothing else is sent.
  useEffect(() => {
    if (why !== null) stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [why]);
  useEffect(() => player.current?.setLoop(loop), [loop]);

  return (
    <section className="ab-bar" data-testid="ab-bar" aria-label="Compare before and after">
      <div className="ab-head">
        <strong>Compare A/B</strong>
        <span className="muted ab-name" data-testid="ab-name">{ws.nameOf(key, index)}</span>
        <button type="button" data-testid="ab-close" onClick={() => void close()} aria-label="Close compare bar">Close</button>
      </div>
      <div className="ab-sides" role="group" aria-label="Sound to hear">
        {(["A", "B"] as Side[]).map((s) => (
          <button key={s} type="button" className="ab-side" data-testid={`ab-${s.toLowerCase()}`} aria-pressed={loaded === s} disabled={off} title={why ?? undefined} onClick={() => void press(s)}>
            {LABEL[s]}
          </button>
        ))}
      </div>
      <div className="audition ab-row">
        <select data-testid="ab-phrase" aria-label="Phrase" value={choice} onChange={(e) => { const c = e.target.value as AbChoice; setChoice(c); if (playing) void play(c); }}>
          {AB_CHOICES.map((k) => <option key={k} value={k}>{k === "auto" ? "Auto" : k === "arpeggio" ? "Arp" : k[0].toUpperCase() + k.slice(1)}</option>)}
        </select>
        <button type="button" className="primary" data-testid="ab-play" disabled={off} title={why ?? undefined} onClick={() => void play()}>Play</button>
        <button type="button" data-testid="ab-stop" disabled={!playing} onClick={stop}>Stop</button>
        <label><input type="checkbox" data-testid="ab-loop" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> Loop</label>
      </div>
      <p className="ab-status" data-testid="ab-now" role="status">Now hearing: {loaded ? LABEL[loaded].replace(": ", " ") : "nothing sent yet"}</p>
      {plan && <p className="ab-status" data-testid="ab-kind" data-kind={plan.kind} data-variant={plan.variant}>Phrase: {plan.kind}{plan.variant ? ", sample figure" : ", short"}; the same for A and B</p>}
      <p className="ab-status muted" data-testid="ab-source">A is {target.source}. B is what you have now.</p>
      <p className="ab-status ab-note" data-testid="ab-note">Audition only: nothing is stored on the keyboard</p>
      {why && <p className="ab-status" data-testid="ab-why">{why}</p>}
      {err && <p className="ab-status ab-err" role="alert">{err}</p>}
    </section>
  );
}
