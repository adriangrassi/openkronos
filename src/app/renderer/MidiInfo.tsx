import type { MidiAnalysis } from "../../core/midi/analysis.ts";
import { barAtMs } from "../../core/midi/analysis.ts";
import "./MidiInfo.css";

const clock = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// posMs is the song position; the current bar is only marked while the file plays.
export function MidiInfo({ a, posMs, live }: { a: MidiAnalysis; posMs: number; live: boolean }) {
  const cur = live ? barAtMs(a, posMs) : -1;
  const tempos = a.tempoMap.map((t) => Math.round(t.bpm));
  const tempo = [...new Set(tempos)].join(" > ") + " bpm";
  return (
    <div className="mi" data-testid="midiinfo-panel">
      <dl className="mi-grid">
        <dt>Duration</dt><dd data-testid="midiinfo-duration">{clock(a.durationMs)}</dd>
        <dt>Tempo</dt><dd data-testid="midiinfo-tempo">{tempo}</dd>
        <dt>Time</dt><dd data-testid="midiinfo-timesig">{`${a.timeSignature.num}/${a.timeSignature.den}`}</dd>
        <dt>Bars</dt><dd data-testid="midiinfo-bars">{a.bars.length}</dd>
        <dt>Key</dt><dd data-testid="midiinfo-key">{a.key?.name ?? "-"}</dd>
        <dt>Polyphony</dt><dd data-testid="midiinfo-polyphony">{a.peakPolyphony}</dd>
      </dl>
      <div className="mi-chans">
        {a.noteCounts.map((c) => (
          <span key={c.channel} data-testid={`midiinfo-channel-${c.channel}`}>{`Ch ${c.channel + 1}: ${c.notes} notes`}</span>
        ))}
      </div>
      <div className="mi-chords" data-testid="midiinfo-chords">
        {a.bars.map((b) => (
          <span key={b.index} className="mi-chord" data-testid={`midiinfo-chord-${b.index}`} data-current={b.index === cur ? "true" : "false"}>{b.chord ?? "-"}</span>
        ))}
      </div>
    </div>
  );
}
