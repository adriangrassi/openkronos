import { useEffect, useRef, useState } from "react";
import { closingMessages, MidiRecorder } from "../../core/midi/recorder.ts";
import { MidiPlayer, type PlayClock } from "../../core/midi/player.ts";
import { writeSmf } from "../../core/midi/smfwrite.ts";
import { describeError, type Link } from "./keyboard.ts";
import { subscribeIncoming } from "./midi-tap.ts";
import "./MidiRecorderPanel.css";

const clock: PlayClock = {
  now: () => performance.now(),
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id),
};

type State = "idle" | "armed" | "recording" | "stopped";
const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${(Math.floor(ms / 100) % 600 / 10).toFixed(1).padStart(4, "0")}`;

export function MidiRecorderPanel({ link, canPlay, onError }: { link: Link | null; canPlay: boolean; onError: (m: string | null) => void }) {
  const [state, setState] = useState<State>("idle");
  const [take, setTake] = useState<MidiRecorder | null>(null);
  const [, bump] = useState(0);
  const [message, setMessage] = useState("");
  const rec = useRef<MidiRecorder | null>(null);
  const stateRef = useRef<State>("idle");
  const setSt = (s: State) => {
    stateRef.current = s;
    setState(s);
  };
  const player = useRef<MidiPlayer | null>(null);

  useEffect(() => {
    if (!link) {
      if (stateRef.current === "armed" || stateRef.current === "recording") setSt("stopped");
      return;
    }
    return subscribeIncoming((msg, t) => {
      const r = rec.current;
      if (!r || (stateRef.current !== "armed" && stateRef.current !== "recording")) return;
      if (!r.add(Array.from(msg), t)) return;
      if (r.full) {
        setSt("stopped");
        setMessage("Recording stopped: event limit reached");
      } else setSt("recording");
      bump((n) => n + 1);
    });
  }, [link]);

  useEffect(() => () => player.current?.stop(), []);
  useEffect(() => {
    player.current?.stop();
    player.current = link ? new MidiPlayer((m) => link.send(m), clock) : null;
  }, [link]);

  async function arm() {
    player.current?.stop();
    let max: number | undefined;
    try {
      max = await window.kronos.midiRecordMax();
    } catch (e) {
      onError(describeError(e));
      return;
    }
    const r = new MidiRecorder(max);
    rec.current = r;
    setTake(r);
    setMessage("");
    setSt("armed");
  }

  async function save() {
    if (!take || !take.events.length) return;
    try {
      setMessage(`Saved ${await window.kronos.midiSaveTake(writeSmf(take.events))}`);
    } catch (e) {
      onError(describeError(e));
    }
  }

  function playTake(t: MidiRecorder, l: Link) {
    player.current?.play(t.events, { channel: null, onEnd: () => closingMessages(t.events).forEach((m) => l.send(m)) });
  }

  const live = state === "armed" || state === "recording";
  const has = !!take && take.events.length > 0;
  return (
    <div className="rec" data-testid="recorder">
      <div className="rec-row">
        <button data-testid="recorder-arm" onClick={arm} disabled={!link || live}>Record</button>
        <button data-testid="recorder-stop" onClick={() => setSt("stopped")} disabled={!live}>Stop</button>
        <button data-testid="recorder-play" onClick={() => take && link && playTake(take, link)} disabled={!canPlay || live || !has}>Play Take</button>
        <button data-testid="recorder-save" onClick={save} disabled={live || !has}>Save Take</button>
      </div>
      <div className="rec-row">
        <span className="rec-status" data-testid="recorder-status" data-state={state}>{state === "idle" ? "ready" : state}</span>
        <span data-testid="recorder-length">{fmt(take?.lengthMs ?? 0)}</span>
        <span>notes <span data-testid="recorder-notes">{take?.noteCount ?? 0}</span></span>
      </div>
      <div className="rec-message" data-testid="recorder-message">{message}</div>
    </div>
  );
}
