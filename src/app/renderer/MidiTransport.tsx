import { memo, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { PlayEvent } from "../../core/midi/player.ts";
import { DEFAULT_LEVEL } from "../../core/midi/levels.ts";
import "./MidiTransport.css";

export interface TransportChannel {
  channel: number;
  name: string;
  notes: number;
}

export interface TransportState {
  tempo: number; // percent
  transpose: number;
  loop: boolean;
  muted: number[]; // 0-based file channels
  solo: number[];
}

interface Props {
  events: PlayEvent[];
  channels: TransportChannel[];
  durationMs: number;
  pos: number;
  live: boolean; // a song from the file is playing
  getMs: () => number;
  onTick: (ms: number) => void;
  onSeek: (ms: number) => void;
  state: TransportState;
  onChange: (patch: Partial<TransportState>) => void;
  levels?: { values: Record<number, number>; onLevel: (channel: number, value: number) => void; onReset: () => void }; // shown in each track mode only
}

const clock = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}`;
const toggle = (list: number[], ch: number) => (list.includes(ch) ? list.filter((c) => c !== ch) : [...list, ch]);

interface Note {
  ms: number;
  end: number;
  note: number;
  channel: number;
}

function notesOf(events: PlayEvent[]): Note[] {
  const open = new Map<number, Note>();
  const out: Note[] = [];
  for (const { ms, data } of events) {
    const kind = data[0] & 0xf0;
    const key = (data[0] & 15) * 128 + data[1];
    if (kind === 0x90 && data[2] > 0) {
      const n = { ms, end: ms, note: data[1], channel: data[0] & 15 };
      open.set(key, n);
      out.push(n);
    } else if (kind === 0x80 || kind === 0x90) {
      const n = open.get(key);
      if (n) n.end = ms;
      open.delete(key);
    }
  }
  return out;
}

const W = 1200;
const H = 120;

// The note layer is drawn once to an offscreen canvas and copied; only the playhead element moves afterwards.
const Roll = memo(function Roll({ events, durationMs, onSeek, playhead }: { events: PlayEvent[]; durationMs: number; onSeek: (ms: number) => void; playhead: RefObject<HTMLDivElement | null> }) {
  const notes = useMemo(() => notesOf(events), [events]);
  const canvas = useRef<HTMLCanvasElement>(null);
  const draws = useRef(0);
  useEffect(() => {
    const view = canvas.current;
    const ctx = view?.getContext("2d");
    if (!view || !ctx) return;
    const off = document.createElement("canvas");
    off.width = W;
    off.height = H;
    const o = off.getContext("2d");
    if (!o) return;
    let lo = 127;
    let hi = 0;
    for (const n of notes) {
      lo = Math.min(lo, n.note);
      hi = Math.max(hi, n.note);
    }
    const rows = Math.max(12, hi - lo + 1);
    const rh = H / rows;
    const style = getComputedStyle(view);
    const warm = style.getPropertyValue("--accent").trim() || "#d9822b";
    const dim = style.getPropertyValue("--text").trim() || "#cccccc";
    const dur = Math.max(1, durationMs);
    for (const n of notes) {
      o.fillStyle = n.channel === 9 ? dim : warm;
      o.fillRect((n.ms / dur) * W, H - (n.note - lo + 1) * rh, Math.max(1, ((n.end - n.ms) / dur) * W), Math.max(1, rh - 0.5));
    }
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(off, 0, 0);
    draws.current += 1;
    view.setAttribute("data-draws", String(draws.current));
  }, [notes, durationMs]);
  return (
    <div className="mt-roll" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); onSeek(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * durationMs); }}>
      <canvas ref={canvas} width={W} height={H} data-testid="playerpro-roll" data-notes={notes.length} />
      <div ref={playhead} className="mt-playhead" data-testid="playerpro-playhead" data-ms="0" />
    </div>
  );
});

function NumberBox({ id, label, value, min, max, onCommit }: { id: string; label: string; value: number; min: number; max: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const v = Number(draft);
    const next = draft.trim() === "" || !Number.isFinite(v) ? value : Math.min(max, Math.max(min, Math.round(v)));
    setDraft(String(next));
    onCommit(next);
  };
  return (
    <label>
      {label}{" "}
      <input type="number" data-testid={id} value={draft} min={min} max={max} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && commit()} />
    </label>
  );
}

export function MidiTransport({ events, channels, durationMs, pos, live, getMs, onTick, onSeek, state, onChange, levels }: Props) {
  const head = useRef<HTMLDivElement>(null);
  const place = (ms: number) => {
    const h = head.current;
    if (!h) return;
    h.style.left = `${(ms / Math.max(1, durationMs)) * 100}%`;
    h.setAttribute("data-ms", String(Math.round(ms)));
  };
  useEffect(() => place(pos), [pos, durationMs]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!live) return;
    let raf = 0;
    let last = -1e9;
    const tick = () => {
      const ms = getMs();
      place(ms);
      if (Math.abs(ms - last) >= 100) {
        last = ms;
        onTick(ms);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [live]); // eslint-disable-line react-hooks/exhaustive-deps
  const end = Math.round(durationMs);
  return (
    <div className="mt" data-testid="playerpro-transport" data-playing={live ? "true" : "false"}>
      <div className="mt-row">
        <span className="mt-time" data-testid="playerpro-time-cur">{clock(pos)}</span>
        <input type="range" aria-label="Song position" data-testid="playerpro-pos" min={0} max={end} value={Math.min(end, Math.round(pos))} onChange={(e) => onSeek(Number(e.target.value))} />
        <span className="mt-time" data-testid="playerpro-time-total">{clock(end)}</span>
      </div>
      <div className="mt-row">
        <label><input type="checkbox" data-testid="playerpro-loop" checked={state.loop} onChange={(e) => onChange({ loop: e.target.checked })} /> Loop</label>
        <NumberBox id="playerpro-tempo" label="Tempo %" value={state.tempo} min={25} max={200} onCommit={(tempo) => onChange({ tempo })} />
        <NumberBox id="playerpro-transpose" label="Transpose" value={state.transpose} min={-24} max={24} onCommit={(transpose) => onChange({ transpose })} />
      </div>
      <Roll events={events} durationMs={durationMs} onSeek={onSeek} playhead={head} />
      {levels && <button data-testid="levels-reset" onClick={levels.onReset}>Reset levels</button>}
      <div className="mt-chans">
        {channels.map((c) => {
          const n = c.channel + 1;
          const level = levels?.values[c.channel] ?? DEFAULT_LEVEL;
          return (
            <div className="mt-chan" key={c.channel}>
              <span>Ch {n}</span>
              <span data-testid={`playerpro-chan-${n}-name`}>{c.name || `Ch ${n}`}</span>
              <span data-testid={`playerpro-chan-${n}-notes`}>{c.notes}</span>
              <button data-testid={`playerpro-chan-${n}-mute`} aria-pressed={state.muted.includes(c.channel)} onClick={() => onChange({ muted: toggle(state.muted, c.channel) })}>Mute</button>
              <button data-testid={`playerpro-chan-${n}-solo`} aria-pressed={state.solo.includes(c.channel)} onClick={() => onChange({ solo: toggle(state.solo, c.channel) })}>Solo</button>
              {levels && (
                <>
                  <input type="range" min={0} max={127} data-testid={`level-${c.channel}`} aria-label={`Level, channel ${n}`} value={level} onChange={(e) => levels.onLevel(c.channel, Number(e.target.value))} />
                  <span data-testid={`level-value-${c.channel}`}>{level}</span>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
